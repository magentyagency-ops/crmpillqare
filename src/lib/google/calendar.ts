import type { GoogleAccount, Meeting, Task } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { contactDisplayName, MEETING_TYPE_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import { normalizeEmail } from "@/lib/normalize";
import { GoogleApiError, googleFetch } from "./oauth";

const API = "https://www.googleapis.com/calendar/v3";

export type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }[];
  organizer?: { email?: string; self?: boolean };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  extendedProperties?: { private?: Record<string, string> };
  iCalUID?: string;
  transparency?: string;
};

function eventVideoUrl(e: GoogleEvent): string | null {
  return e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
}

function calendarPath(account: GoogleAccount) {
  return `${API}/calendars/${encodeURIComponent(account.calendarId || "primary")}/events`;
}

type MeetingForEvent = Meeting & {
  contact: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  company: { name: string } | null;
};

function meetingEventBody(meeting: MeetingForEvent, opts: { createConference: boolean }) {
  const attendees = new Map<string, { email: string; displayName?: string }>();
  if (meeting.contact?.email) {
    attendees.set(meeting.contact.email.toLowerCase(), { email: meeting.contact.email, displayName: contactDisplayName(meeting.contact) });
  }
  for (const a of (meeting.attendees as { email: string; name?: string }[] | null) ?? []) {
    if (a?.email) attendees.set(a.email.toLowerCase(), { email: a.email, displayName: a.name });
  }
  const descriptionParts = [
    meeting.description,
    meeting.bookingNotes ? `Message du contact :\n${meeting.bookingNotes}` : null,
    meeting.contact?.phone ? `Téléphone : ${meeting.contact.phone}` : null,
    `Fiche CRM : ${env.appUrl}/agenda/${meeting.id}`,
  ].filter(Boolean);
  const body: Record<string, unknown> = {
    summary: meeting.title,
    description: descriptionParts.join("\n\n"),
    location: meeting.type === "IN_PERSON" ? (meeting.location ?? undefined) : meeting.type === "PHONE" ? (meeting.location ?? meeting.contact?.phone ?? undefined) : undefined,
    start: { dateTime: meeting.startAt.toISOString(), timeZone: env.timezone },
    end: { dateTime: meeting.endAt.toISOString(), timeZone: env.timezone },
    attendees: [...attendees.values()],
    extendedProperties: { private: { pqMeetingId: meeting.id } },
    reminders: { useDefault: true },
    guestsCanModify: false,
  };
  if (opts.createConference && meeting.type === "VIDEO" && !meeting.videoUrl) {
    body.conferenceData = {
      createRequest: { requestId: `pq-${meeting.id}-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  return body;
}

/** Crée ou met à jour l'événement Google Agenda du RDV (avec lien Google Meet pour les visios). */
export async function pushMeetingToGoogle(meetingId: string, opts: { notifyAttendees?: boolean } = {}) {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: {
      contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
      company: { select: { name: true } },
      organizer: { include: { googleAccount: true } },
    },
  });
  if (!meeting) return null;
  const account = meeting.organizer.googleAccount;
  if (!account || account.status === "DISCONNECTED") return null;
  const sendUpdates = opts.notifyAttendees === false ? "none" : "all";

  if (meeting.status === "CANCELLED") {
    if (meeting.googleEventId) {
      try {
        await googleFetch(account, `${calendarPath(account)}/${encodeURIComponent(meeting.googleEventId)}?sendUpdates=${sendUpdates}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
      }
    }
    return null;
  }

  const body = meetingEventBody(meeting, { createConference: true });
  let event: GoogleEvent;
  if (meeting.googleEventId) {
    try {
      event = await googleFetch<GoogleEvent>(
        account,
        `${calendarPath(account)}/${encodeURIComponent(meeting.googleEventId)}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`,
        { method: "PATCH", json: body },
      );
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) {
        event = await googleFetch<GoogleEvent>(account, `${calendarPath(account)}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`, { method: "POST", json: body });
      } else throw error;
    }
  } else {
    // Même identifiant iCalendar que les invitations éventuellement envoyées par le CRM : pas de doublon chez le contact
    event = await googleFetch<GoogleEvent>(account, `${calendarPath(account)}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`, {
      method: "POST",
      json: { ...body, iCalUID: meeting.icalUid ?? `${meeting.id}@pillqare-crm` },
    });
  }
  const videoUrl = eventVideoUrl(event);
  return db.meeting.update({
    where: { id: meeting.id },
    data: {
      googleEventId: event.id,
      googleCalendarId: account.calendarId,
      icalUid: event.iCalUID ?? meeting.icalUid,
      ...(videoUrl && !meeting.videoUrl ? { videoUrl } : {}),
    },
  });
}

/** Plages occupées dans Google Agenda (pour la prise de RDV en ligne). */
export async function googleBusyIntervals(account: GoogleAccount, timeMin: Date, timeMax: Date): Promise<{ start: Date; end: Date }[]> {
  const res = await googleFetch<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(
    account,
    `${API}/freeBusy`,
    {
      method: "POST",
      json: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: account.calendarId || "primary" }] },
    },
  );
  const cal = Object.values(res.calendars ?? {})[0];
  return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/** Bloc dans Google Agenda pour une tâche planifiée (appel, relance…) — option du commercial. */
export async function syncTaskToGoogle(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { include: { googleAccount: true } },
      contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });
  if (!task) return;
  const account = task.assignee.googleAccount;
  const wanted = task.status === "OPEN" && task.hasTime && task.dueAt && task.assignee.syncTasksToCalendar;
  if (!account || account.status === "DISCONNECTED") return;

  if (!wanted) {
    if (task.googleEventId) {
      try {
        await googleFetch(account, `${calendarPath(account)}/${encodeURIComponent(task.googleEventId)}?sendUpdates=none`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
      }
      await db.task.update({ where: { id: task.id }, data: { googleEventId: null } });
    }
    return;
  }
  const icon = task.type === "CALL" || task.type === "CALLBACK" ? "📞" : task.type === "EMAIL" ? "✉️" : "✅";
  const start = task.dueAt!;
  const body = {
    summary: `${icon} ${task.title}`,
    description: [
      TASK_TYPE_LABELS[task.type],
      task.contact ? `Contact : ${contactDisplayName(task.contact)}${task.contact.phone ? ` — ${task.contact.phone}` : ""}` : null,
      task.description,
      `${env.appUrl}/taches?task=${task.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: start.toISOString(), timeZone: env.timezone },
    end: { dateTime: new Date(start.getTime() + 15 * 60_000).toISOString(), timeZone: env.timezone },
    transparency: "transparent",
    extendedProperties: { private: { pqTaskId: task.id } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
  };
  let event: GoogleEvent;
  if (task.googleEventId) {
    try {
      event = await googleFetch<GoogleEvent>(account, `${calendarPath(account)}/${encodeURIComponent(task.googleEventId)}?sendUpdates=none`, {
        method: "PATCH",
        json: body,
      });
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) {
        event = await googleFetch<GoogleEvent>(account, `${calendarPath(account)}?sendUpdates=none`, { method: "POST", json: body });
      } else throw error;
    }
  } else {
    event = await googleFetch<GoogleEvent>(account, `${calendarPath(account)}?sendUpdates=none`, { method: "POST", json: body });
  }
  if (event.id !== task.googleEventId) await db.task.update({ where: { id: task.id }, data: { googleEventId: event.id } });
}

/**
 * Synchronisation incrémentale Google Agenda → CRM :
 * - RDV créés par le CRM : déplacements / annulations répercutés
 * - Nouveaux événements avec un contact du CRM comme invité : RDV créé automatiquement
 * - Blocs de tâches déplacés : échéance mise à jour
 */
export async function syncGoogleCalendar(account: GoogleAccount): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  let pageToken: string | undefined;
  let syncToken = account.calendarSyncToken ?? undefined;
  let nextSyncToken: string | undefined;
  const user = await db.user.findUniqueOrThrow({ where: { id: account.userId }, select: { id: true, email: true } });
  const selfEmails = new Set([user.email.toLowerCase(), account.email.toLowerCase()]);

  for (let page = 0; page < 30; page++) {
    const params = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    if (syncToken) params.set("syncToken", syncToken);
    else {
      params.set("timeMin", new Date(Date.now() - 30 * 86_400_000).toISOString());
      params.set("showDeleted", "true");
    }
    if (pageToken) params.set("pageToken", pageToken);
    let res: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      res = await googleFetch(account, `${calendarPath(account)}?${params}`);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 410) {
        // Jeton de synchronisation expiré : resynchronisation complète
        syncToken = undefined;
        pageToken = undefined;
        await db.googleAccount.update({ where: { id: account.id }, data: { calendarSyncToken: null } });
        continue;
      }
      throw error;
    }
    for (const event of res.items ?? []) {
      const r = await applyGoogleEvent(event, user.id, selfEmails);
      if (r === "created") created++;
      if (r === "updated") updated++;
    }
    pageToken = res.nextPageToken;
    nextSyncToken = res.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }
  await db.googleAccount.update({
    where: { id: account.id },
    data: { calendarSyncToken: nextSyncToken ?? account.calendarSyncToken, calendarLastSyncAt: new Date(), status: "ACTIVE", lastError: null },
  });
  return { created, updated };
}

async function applyGoogleEvent(event: GoogleEvent, userId: string, selfEmails: Set<string>): Promise<"created" | "updated" | "skipped"> {
  const priv = event.extendedProperties?.private ?? {};
  const cancelled = event.status === "cancelled";

  // Bloc de tâche
  if (priv.pqTaskId) {
    const task = await db.task.findUnique({ where: { id: priv.pqTaskId } });
    if (!task) return "skipped";
    if (cancelled) {
      if (task.googleEventId === event.id) await db.task.update({ where: { id: task.id }, data: { googleEventId: null } });
      return "updated";
    }
    const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    if (start && task.status === "OPEN" && (!task.dueAt || Math.abs(task.dueAt.getTime() - start.getTime()) > 60_000)) {
      await db.task.update({ where: { id: task.id }, data: { dueAt: start, hasTime: true, reminderSentAt: null } });
      if (task.dealId) {
        const { refreshDealNextAction } = await import("@/lib/deals");
        await refreshDealNextAction(task.dealId);
      }
      return "updated";
    }
    return "skipped";
  }

  const existing = priv.pqMeetingId
    ? await db.meeting.findUnique({ where: { id: priv.pqMeetingId } })
    : await db.meeting.findFirst({ where: { googleEventId: event.id, organizerId: userId } });

  if (existing) {
    if (cancelled) {
      if (existing.status === "SCHEDULED") {
        await db.meeting.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Annulé dans Google Agenda" } });
        await logActivity({
          type: "MEETING_CANCELLED",
          title: `RDV annulé : ${existing.title}`,
          body: "Annulé depuis Google Agenda.",
          contactId: existing.contactId,
          dealId: existing.dealId,
          meetingId: existing.id,
        });
        if (existing.dealId) {
          const { refreshDealNextAction } = await import("@/lib/deals");
          await refreshDealNextAction(existing.dealId);
        }
      }
      return "updated";
    }
    if (!event.start?.dateTime || !event.end?.dateTime) return "skipped";
    const startAt = new Date(event.start.dateTime);
    const endAt = new Date(event.end.dateTime);
    const videoUrl = eventVideoUrl(event);
    const moved = existing.startAt.getTime() !== startAt.getTime() || existing.endAt.getTime() !== endAt.getTime();
    if (moved || (videoUrl && videoUrl !== existing.videoUrl) || existing.googleEventId !== event.id) {
      await db.meeting.update({
        where: { id: existing.id },
        data: {
          startAt,
          endAt,
          googleEventId: event.id,
          ...(videoUrl ? { videoUrl } : {}),
          ...(moved ? { reminder24hSentAt: null, reminder1hSentAt: null } : {}),
        },
      });
      if (existing.dealId) {
        const { refreshDealNextAction } = await import("@/lib/deals");
        await refreshDealNextAction(existing.dealId);
      }
      return "updated";
    }
    return "skipped";
  }

  if (cancelled || !event.start?.dateTime || !event.end?.dateTime) return "skipped";
  // Nouvel événement externe : on ne l'importe que s'il concerne un contact du CRM
  const guestEmails = (event.attendees ?? [])
    .map((a) => normalizeEmail(a.email))
    .filter((e): e is string => Boolean(e) && !selfEmails.has(e!));
  if (guestEmails.length === 0) return "skipped";
  const contact = await db.contact.findFirst({ where: { emailNormalized: { in: guestEmails }, archivedAt: null } });
  if (!contact) return "skipped";
  const { findOpenDealForContact, advanceDealTo, refreshDealNextAction } = await import("@/lib/deals");
  const deal = await findOpenDealForContact(contact.id);
  const videoUrl = eventVideoUrl(event);
  const meeting = await db.meeting.create({
    data: {
      title: event.summary?.slice(0, 200) || `RDV avec ${contactDisplayName(contact)}`,
      description: event.description?.slice(0, 5000) ?? null,
      type: videoUrl ? "VIDEO" : event.location ? "IN_PERSON" : "PHONE",
      status: new Date(event.end.dateTime) < new Date() ? "COMPLETED" : "SCHEDULED",
      source: "GOOGLE",
      startAt: new Date(event.start.dateTime),
      endAt: new Date(event.end.dateTime),
      location: event.location ?? null,
      videoUrl,
      organizerId: userId,
      contactId: contact.id,
      companyId: contact.companyId,
      dealId: deal?.id ?? null,
      attendees: (event.attendees ?? []).filter((a) => a.email && !selfEmails.has(a.email.toLowerCase())).map((a) => ({ email: a.email!, name: a.displayName ?? null })),
      googleEventId: event.id,
      icalUid: event.iCalUID ?? null,
      // Les invités ont déjà reçu l'invitation Google : pas de confirmation CRM en double
      confirmationSentAt: new Date(),
    },
  });
  await logActivity({
    type: "MEETING_BOOKED",
    title: `RDV planifié (Google Agenda) : ${meeting.title}`,
    body: `${MEETING_TYPE_LABELS[meeting.type]} le ${meeting.startAt.toLocaleString("fr-FR", { timeZone: env.timezone })}`,
    contactId: contact.id,
    dealId: deal?.id ?? null,
    userId,
    meetingId: meeting.id,
  });
  if (deal) {
    await advanceDealTo(deal.id, "MEETING", { userId });
    await refreshDealNextAction(deal.id);
  }
  return "created";
}

export async function getGoogleAccountForUser(userId: string) {
  return db.googleAccount.findUnique({ where: { userId } });
}

export type { Task };
