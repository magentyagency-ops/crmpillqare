import type { MeetingSource, MeetingType, Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { env } from "./env";
import { logActivity } from "./activity";
import { notify } from "./notifications";
import { advanceDealTo, findOpenDealForContact, refreshDealNextAction } from "./deals";
import { contactDisplayName, MEETING_TYPE_LABELS } from "./labels";
import { addDaysTz, dayKey, formatDate, formatDateTime, formatTime } from "./dates";
import { getSettings } from "./settings";
import { composeEmail } from "./email/render";
import { buildTemplateVars, meetingManageUrl } from "./email/vars";
import { buildIcs } from "./email/ics";
import { enqueueJob } from "./jobs";

export type CreateMeetingInput = {
  title: string;
  type: MeetingType;
  startAt: Date;
  endAt: Date;
  organizerId: string;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  location?: string | null;
  videoUrl?: string | null;
  description?: string | null;
  bookingNotes?: string | null;
  attendees?: { email: string; name?: string | null }[];
  source?: MeetingSource;
  createdById?: string | null;
  /** Envoyer l'email de confirmation au contact (défaut : oui) */
  sendConfirmation?: boolean;
};

export class MeetingConflictError extends Error {
  constructor() {
    super("Ce créneau n'est plus disponible.");
    this.name = "MeetingConflictError";
  }
}

/** Vérifie qu'aucun RDV du CRM ne chevauche le créneau (verrou par organisateur dans la transaction). */
async function assertNoOverlap(tx: Prisma.TransactionClient, organizerId: string, startAt: Date, endAt: Date, excludeId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting:${organizerId}`}))`;
  const overlap = await tx.meeting.findFirst({
    where: {
      organizerId,
      status: "SCHEDULED",
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (overlap) throw new MeetingConflictError();
}

export async function createMeeting(input: CreateMeetingInput, opts: { checkConflict?: boolean } = {}) {
  if (input.endAt <= input.startAt) throw new Error("L'heure de fin doit être après l'heure de début.");
  let dealId = input.dealId ?? null;
  let companyId = input.companyId ?? null;
  if (input.contactId) {
    const contact = await db.contact.findUnique({ where: { id: input.contactId }, select: { companyId: true } });
    companyId = companyId ?? contact?.companyId ?? null;
    if (!dealId) dealId = (await findOpenDealForContact(input.contactId))?.id ?? null;
  }

  const meeting = await db.$transaction(async (tx) => {
    if (opts.checkConflict) await assertNoOverlap(tx, input.organizerId, input.startAt, input.endAt);
    return tx.meeting.create({
      data: {
        title: input.title.slice(0, 200),
        type: input.type,
        startAt: input.startAt,
        endAt: input.endAt,
        organizerId: input.organizerId,
        contactId: input.contactId ?? null,
        dealId,
        companyId,
        location: input.location ?? null,
        videoUrl: input.videoUrl ?? null,
        description: input.description ?? null,
        bookingNotes: input.bookingNotes ?? null,
        attendees: input.attendees?.length ? input.attendees : undefined,
        source: input.source ?? "MANUAL",
      },
    });
  });

  await logActivity({
    type: "MEETING_BOOKED",
    title: `RDV planifié : ${meeting.title}`,
    body: `${MEETING_TYPE_LABELS[meeting.type]} — ${formatDateTime(meeting.startAt)}${meeting.source === "BOOKING" ? " (réservé en ligne par le contact)" : ""}`,
    contactId: meeting.contactId,
    companyId: meeting.companyId,
    dealId: meeting.dealId,
    userId: input.createdById ?? (meeting.source === "BOOKING" ? null : input.organizerId),
    meetingId: meeting.id,
  });

  if (meeting.contactId) {
    const { onMeetingBooked } = await import("./sequences/engine");
    await onMeetingBooked(meeting.contactId);
  }
  if (meeting.dealId) {
    await advanceDealTo(meeting.dealId, "MEETING", { userId: input.createdById ?? null });
    await refreshDealNextAction(meeting.dealId);
  }

  // Google Agenda (lien Meet) avant la confirmation, pour l'inclure dans l'email
  let synced = meeting;
  try {
    const { pushMeetingToGoogle } = await import("./google/calendar");
    synced = (await pushMeetingToGoogle(meeting.id)) ?? meeting;
  } catch (error) {
    console.error("[meetings] Synchronisation Google impossible :", error instanceof Error ? error.message : error);
    await enqueueJob("calendar.pushMeeting", { meetingId: meeting.id }, { runAt: new Date(Date.now() + 60_000) });
  }

  // Sans lien Meet généré : salle de visio permanente du commercial, si renseignée
  if (synced.type === "VIDEO" && !synced.videoUrl) {
    const organizer = await db.user.findUnique({ where: { id: synced.organizerId }, select: { videoRoomUrl: true } });
    if (organizer?.videoRoomUrl) synced = await db.meeting.update({ where: { id: synced.id }, data: { videoUrl: organizer.videoRoomUrl } });
  }

  if (input.sendConfirmation !== false && meeting.contactId) {
    try {
      await sendMeetingEmail(synced.id, "confirmation");
    } catch (error) {
      console.error("[meetings] Confirmation non envoyée :", error instanceof Error ? error.message : error);
      await enqueueJob("meeting.email", { meetingId: meeting.id, kind: "confirmation" }, { runAt: new Date(Date.now() + 5 * 60_000) });
    }
  }
  return synced;
}

export async function rescheduleMeeting(meetingId: string, startAt: Date, endAt: Date, opts: { byUserId?: string | null; notifyContact?: boolean; checkConflict?: boolean } = {}) {
  const meeting = await db.$transaction(async (tx) => {
    const current = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    if (opts.checkConflict) await assertNoOverlap(tx, current.organizerId, startAt, endAt, meetingId);
    return tx.meeting.update({
      where: { id: meetingId },
      data: { startAt, endAt, status: "SCHEDULED", reminder24hSentAt: null, reminder1hSentAt: null, cancelledAt: null, cancelReason: null },
    });
  });
  await logActivity({
    type: "MEETING_BOOKED",
    title: `RDV déplacé : ${meeting.title}`,
    body: `Nouvelle date : ${formatDateTime(startAt)}`,
    contactId: meeting.contactId,
    dealId: meeting.dealId,
    userId: opts.byUserId ?? null,
    meetingId: meeting.id,
  });
  try {
    const { pushMeetingToGoogle } = await import("./google/calendar");
    await pushMeetingToGoogle(meeting.id);
  } catch (error) {
    console.error("[meetings]", error);
    await enqueueJob("calendar.pushMeeting", { meetingId: meeting.id });
  }
  if (opts.notifyContact !== false && meeting.contactId) {
    await sendMeetingEmail(meeting.id, "rescheduled").catch((e) => console.error("[meetings]", e));
  }
  if (meeting.dealId) await refreshDealNextAction(meeting.dealId);
  return meeting;
}

export async function cancelMeeting(meetingId: string, opts: { reason?: string | null; byContact?: boolean; byUserId?: string | null; notifyContact?: boolean } = {}) {
  const meeting = await db.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
  });
  if (meeting.status === "CANCELLED") return meeting;
  const updated = await db.meeting.update({
    where: { id: meetingId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: opts.reason ?? null },
  });
  await logActivity({
    type: "MEETING_CANCELLED",
    title: `RDV annulé : ${meeting.title}`,
    body: [opts.byContact ? "Annulé par le contact." : null, opts.reason].filter(Boolean).join(" ") || null,
    contactId: meeting.contactId,
    dealId: meeting.dealId,
    userId: opts.byUserId ?? null,
    meetingId,
  });
  try {
    const { pushMeetingToGoogle } = await import("./google/calendar");
    await pushMeetingToGoogle(meetingId);
  } catch (error) {
    console.error("[meetings]", error);
  }
  if (opts.byContact) {
    await notify({
      userId: meeting.organizerId,
      type: "MEETING_CANCELLED",
      title: `RDV annulé par ${contactDisplayName(meeting.contact)}`,
      body: `${formatDateTime(meeting.startAt)}${opts.reason ? ` — « ${opts.reason} »` : ""}`,
      link: meeting.contactId ? `/contacts/${meeting.contactId}` : "/agenda",
    });
    const { createTask } = await import("./tasks");
    await createTask({
      title: `Reprogrammer le RDV avec ${contactDisplayName(meeting.contact)}`,
      type: "CALL",
      priority: "HIGH",
      source: "BOOKING",
      dueAt: new Date(),
      assigneeId: meeting.organizerId,
      contactId: meeting.contactId,
      dealId: meeting.dealId,
      meetingId,
    });
  }
  if (opts.notifyContact !== false && meeting.contactId) {
    await sendMeetingEmail(meetingId, "cancelled").catch((e) => console.error("[meetings]", e));
  }
  if (meeting.dealId) await refreshDealNextAction(meeting.dealId);
  return updated;
}

export async function setMeetingOutcome(meetingId: string, outcome: "COMPLETED" | "NO_SHOW", userId: string | null) {
  const meeting = await db.meeting.update({
    where: { id: meetingId },
    data: { status: outcome, completedAt: outcome === "COMPLETED" ? new Date() : null },
    include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
  });
  await logActivity({
    type: "MEETING",
    title: outcome === "COMPLETED" ? `RDV réalisé : ${meeting.title}` : `Absent au RDV : ${meeting.title}`,
    contactId: meeting.contactId,
    dealId: meeting.dealId,
    userId,
    meetingId,
    occurredAt: meeting.startAt,
  });
  if (outcome === "NO_SHOW") {
    const { createTask } = await import("./tasks");
    await createTask({
      title: `Relancer ${contactDisplayName(meeting.contact)} (absent au RDV)`,
      type: "CALL",
      priority: "HIGH",
      source: "SYSTEM",
      dueAt: new Date(),
      assigneeId: meeting.organizerId,
      contactId: meeting.contactId,
      dealId: meeting.dealId,
      meetingId,
    });
    await db.task.updateMany({ where: { meetingId, type: "MEETING_REPORT", status: "OPEN" }, data: { status: "CANCELLED" } });
  }
  if (meeting.dealId) await refreshDealNextAction(meeting.dealId);
  return meeting;
}

// ───────────── Emails liés aux RDV ─────────────

type MeetingEmailKind = "confirmation" | "rescheduled" | "cancelled" | "reminder24h" | "reminder1h";

const MEETING_EMAILS: Record<MeetingEmailKind, { subject: string; intro: string }> = {
  confirmation: {
    subject: "Confirmation de votre rendez-vous avec {{org.name}} — {{meeting.dateTime}}",
    intro: "Votre rendez-vous avec {{user.fullName}} ({{org.name}}) est confirmé :",
  },
  rescheduled: {
    subject: "Votre rendez-vous avec {{org.name}} a été déplacé — {{meeting.dateTime}}",
    intro: "Votre rendez-vous avec {{user.fullName}} ({{org.name}}) a été déplacé. Voici le nouveau créneau :",
  },
  cancelled: {
    subject: "Annulation de votre rendez-vous avec {{org.name}}",
    intro: "Votre rendez-vous prévu le {{meeting.dateTime}} avec {{user.fullName}} est annulé.",
  },
  reminder24h: {
    subject: "Rappel : votre rendez-vous avec {{org.name}} {{meeting.relativeDay}} à {{meeting.time}}",
    intro: "Petit rappel : vous avez rendez-vous {{meeting.relativeDay}} avec {{user.fullName}} ({{org.name}}).",
  },
  reminder1h: {
    subject: "Votre rendez-vous avec {{org.name}} commence à {{meeting.time}}",
    intro: "Votre rendez-vous avec {{user.fullName}} commence dans une heure.",
  },
};

export async function sendMeetingEmail(meetingId: string, kind: MeetingEmailKind) {
  const meeting = await db.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      contact: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
      organizer: { select: { id: true, email: true, firstName: true, lastName: true, signature: true } },
    },
  });
  if (!meeting.contact?.email) return null;
  const baseVars = await buildTemplateVars({ contactId: meeting.contactId, dealId: meeting.dealId, userId: meeting.organizerId, meetingId });
  // « aujourd'hui » / « demain » / « le jeudi 8 octobre » selon le moment réel de l'envoi
  const today = dayKey(new Date());
  const meetingDay = dayKey(meeting.startAt);
  const relativeDay = meetingDay === today ? "aujourd'hui" : meetingDay === dayKey(addDaysTz(new Date(), 1)) ? "demain" : `le ${formatDate(meeting.startAt, "EEEE d MMMM")}`;
  const vars = { ...baseVars, meeting: { ...((baseVars as { meeting?: Record<string, unknown> }).meeting ?? {}), relativeDay } };
  const tpl = MEETING_EMAILS[kind];
  const durationMin = Math.round((meeting.endAt.getTime() - meeting.startAt.getTime()) / 60_000);
  const details: string[] = [];
  if (kind !== "cancelled") {
    details.push(`📅 ${formatDate(meeting.startAt, "EEEE d MMMM yyyy")} à ${formatTime(meeting.startAt)} (heure de Paris) — ${durationMin} min`);
    if (meeting.type === "VIDEO") details.push(meeting.videoUrl ? `💻 Visio : ${meeting.videoUrl}` : "💻 Visio : le lien vous sera communiqué avant le rendez-vous.");
    if (meeting.type === "PHONE") details.push(`📞 Par téléphone${meeting.contact.phone ? ` : nous vous appellerons au ${meeting.contact.phone}` : ""}`);
    if (meeting.type === "IN_PERSON") details.push(`📍 Lieu : ${meeting.location ?? "à confirmer"}`);
  }
  const manage = kind === "cancelled" ? "" : `\n\nBesoin de modifier ou d'annuler ? ${meetingManageUrl(meeting.manageToken)}`;
  const outro =
    kind === "cancelled"
      ? `\n\nVous pouvez reprendre un rendez-vous à tout moment : {{bookingLink}}`
      : "\n\nÀ très bientôt,";
  const body = `{{contact.greeting}}\n\n${tpl.intro}\n\n${details.join("\n")}${manage}${outro}`;
  const composed = composeEmail({ subject: tpl.subject, body, vars, signature: meeting.organizer.signature ?? `${meeting.organizer.firstName} ${meeting.organizer.lastName}` });

  // Invitation calendrier (.ics) : envoyée par le CRM seulement si Google Agenda ne gère pas déjà l'invitation du contact
  const attachments =
    (kind === "confirmation" || kind === "rescheduled" || kind === "cancelled") && !meeting.googleEventId
      ? [
          {
            filename: "rendez-vous.ics",
            contentType: "text/calendar; charset=utf-8",
            content: buildIcs({
              uid: meeting.icalUid ?? `${meeting.id}@pillqare-crm`,
              start: meeting.startAt,
              end: meeting.endAt,
              summary: meeting.title,
              description: [meeting.videoUrl ? `Visio : ${meeting.videoUrl}` : null, `Gérer le RDV : ${meetingManageUrl(meeting.manageToken)}`].filter(Boolean).join("\n"),
              location: meeting.type === "IN_PERSON" ? meeting.location : meeting.videoUrl,
              url: meeting.videoUrl,
              organizer: { email: meeting.organizer.email, name: `${meeting.organizer.firstName} ${meeting.organizer.lastName}` },
              attendees: [{ email: meeting.contact.email, name: contactDisplayName(meeting.contact) }],
              method: kind === "cancelled" ? "CANCEL" : "PUBLISH",
              sequence: kind === "confirmation" ? 0 : Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 1000),
              cancelled: kind === "cancelled",
            }),
          },
        ]
      : undefined;

  const { sendEmail } = await import("./email/send");
  const sent = await sendEmail({
    senderId: meeting.organizerId,
    to: [meeting.contact.email],
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    contactId: meeting.contactId,
    dealId: meeting.dealId,
    isAutomated: true,
    attachments,
    skipActivity: kind === "reminder1h" || kind === "reminder24h",
  });
  const stamp = new Date();
  if (kind === "confirmation" || kind === "rescheduled") await db.meeting.update({ where: { id: meetingId }, data: { confirmationSentAt: stamp } });
  if (kind === "reminder24h") await db.meeting.update({ where: { id: meetingId }, data: { reminder24hSentAt: stamp } });
  if (kind === "reminder1h") await db.meeting.update({ where: { id: meetingId }, data: { reminder1hSentAt: stamp } });
  return sent;
}

/** Rappels automatiques aux contacts (24 h et 1 h avant) + notification au commercial. */
export async function processMeetingReminders(): Promise<number> {
  const settings = await getSettings("meetings");
  const now = Date.now();
  let count = 0;
  if (settings.reminder24h) {
    const candidates = await db.meeting.findMany({
      where: {
        status: "SCHEDULED",
        reminder24hSentAt: null,
        contactId: { not: null },
        startAt: { gt: new Date(now + 3 * 3600_000), lte: new Date(now + 24 * 3600_000) },
      },
      select: { id: true, startAt: true, createdAt: true },
      take: 100,
    });
    // Inutile si le RDV a été pris moins de 20 h avant son début (la confirmation vient d'être envoyée)
    const due = candidates.filter((m) => m.startAt.getTime() - m.createdAt.getTime() >= 20 * 3600_000);
    for (const m of due) {
      const claimed = await db.meeting.updateMany({ where: { id: m.id, reminder24hSentAt: null }, data: { reminder24hSentAt: new Date() } });
      if (!claimed.count) continue;
      try {
        await sendMeetingEmail(m.id, "reminder24h");
        count++;
      } catch (error) {
        console.error("[meetings] rappel 24 h :", error instanceof Error ? error.message : error);
      }
    }
  }
  if (settings.reminder1h) {
    const due = await db.meeting.findMany({
      where: {
        status: "SCHEDULED",
        reminder1hSentAt: null,
        contactId: { not: null },
        startAt: { gt: new Date(now + 10 * 60_000), lte: new Date(now + 65 * 60_000) },
        createdAt: { lt: new Date(now - 2 * 3600_000) },
      },
      select: { id: true, organizerId: true, title: true, startAt: true, contactId: true },
      take: 50,
    });
    for (const m of due) {
      const claimed = await db.meeting.updateMany({ where: { id: m.id, reminder1hSentAt: null }, data: { reminder1hSentAt: new Date() } });
      if (!claimed.count) continue;
      try {
        await sendMeetingEmail(m.id, "reminder1h");
        count++;
      } catch (error) {
        console.error("[meetings] rappel 1 h :", error instanceof Error ? error.message : error);
      }
      await notify({
        userId: m.organizerId,
        type: "MEETING_REMINDER",
        title: `RDV à ${formatTime(m.startAt)} : ${m.title}`,
        body: "Pensez à lancer l'assistant IA pour obtenir le compte rendu automatiquement.",
        link: `/agenda/${m.id}`,
      });
    }
  }
  return count;
}

/**
 * Après chaque RDV : passage en « réalisé », tâche de compte rendu et récupération automatique
 * de la transcription Google Meet (CR généré par l'IA, à valider par le commercial).
 */
export async function processEndedMeetings(): Promise<number> {
  const settings = await getSettings("meetings");
  const ended = await db.meeting.findMany({
    where: { status: "SCHEDULED", endAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    include: {
      contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
      aiSessions: { select: { id: true } },
    },
    take: 50,
  });
  for (const m of ended) {
    await db.meeting.update({ where: { id: m.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await logActivity({
      type: "MEETING",
      title: `RDV réalisé : ${m.title}`,
      contactId: m.contactId,
      dealId: m.dealId,
      userId: m.organizerId,
      meetingId: m.id,
      occurredAt: m.startAt,
    });
    if (settings.reportTask && m.aiSessions.length === 0 && !m.reportTaskCreatedAt) {
      const { createTask } = await import("./tasks");
      await createTask({
        title: `Compte rendu du RDV avec ${contactDisplayName(m.contact)}`,
        description: "Lancez l'assistant IA (enregistrement, import audio ou notes) pour générer le compte rendu, puis validez-le.",
        type: "MEETING_REPORT",
        priority: "HIGH",
        source: "SYSTEM",
        dueAt: new Date(),
        assigneeId: m.organizerId,
        contactId: m.contactId,
        dealId: m.dealId,
        meetingId: m.id,
      });
      await db.meeting.update({ where: { id: m.id }, data: { reportTaskCreatedAt: new Date() } });
    }
    if (settings.autoReportFromMeet && env.google.meetTranscripts && m.videoUrl?.includes("meet.google.com") && m.aiSessions.length === 0) {
      await enqueueJob("meet.fetchTranscript", { meetingId: m.id, attempt: 1 }, { runAt: new Date(Date.now() + 10 * 60_000), dedupeKey: `meet:${m.id}` });
    }
    if (m.dealId) await refreshDealNextAction(m.dealId);
  }
  return ended.length;
}
