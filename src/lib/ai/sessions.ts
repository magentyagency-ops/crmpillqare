import type { AiSessionKind, DealStage, TranscriptSource } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { addBusinessDaysTz, clampToBusinessWindow, dayKey, zonedDateTime } from "@/lib/dates";
import { AI_KIND_LABELS, contactDisplayName, STAGE_LABELS } from "@/lib/labels";
import { composeEmail } from "@/lib/email/render";
import { aiAvailable, generateReport, type MeetingReport } from "./report";
import { transcribeAudio, transcriptionAvailable } from "./transcription";

export type CreateSessionInput = {
  kind: AiSessionKind;
  userId: string;
  contactId?: string | null;
  dealId?: string | null;
  meetingId?: string | null;
  title?: string | null;
  source?: TranscriptSource;
  consentConfirmed?: boolean;
  transcript?: string | null;
};

export async function createAiSession(input: CreateSessionInput) {
  let contactId = input.contactId ?? null;
  let dealId = input.dealId ?? null;
  let title = input.title ?? null;
  if (input.meetingId) {
    const m = await db.meeting.findUnique({ where: { id: input.meetingId }, select: { contactId: true, dealId: true, title: true } });
    contactId = contactId ?? m?.contactId ?? null;
    dealId = dealId ?? m?.dealId ?? null;
    title = title ?? m?.title ?? null;
  }
  if (contactId && !dealId) {
    const { findOpenDealForContact } = await import("@/lib/deals");
    dealId = (await findOpenDealForContact(contactId))?.id ?? null;
  }
  if (!title && contactId) {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true, email: true, phone: true } });
    title = `${AI_KIND_LABELS[input.kind]} — ${contactDisplayName(c)}`;
  }
  return db.aiSession.create({
    data: {
      kind: input.kind,
      userId: input.userId,
      contactId,
      dealId,
      meetingId: input.meetingId ?? null,
      title: title ?? AI_KIND_LABELS[input.kind],
      transcriptSource: input.source ?? "LIVE",
      consentConfirmed: input.consentConfirmed ?? false,
      transcript: input.transcript ?? null,
      status: input.source === "PASTE" || input.source === "GOOGLE_MEET" ? "TRANSCRIBING" : input.source === "UPLOAD" ? "TRANSCRIBING" : "RECORDING",
    },
  });
}

/** Segment audio enregistré pendant l'échange (≈ 20 s) : transcrit immédiatement. Idempotent par index. */
export async function addAudioSegment(sessionId: string, index: number, audio: Buffer, mime: string, meta: { offsetMs?: number; durationMs?: number } = {}) {
  const session = await db.aiSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true, language: true } });
  if (!["RECORDING", "TRANSCRIBING"].includes(session.status)) throw new Error("La session n'accepte plus d'enregistrement.");
  const existing = await db.transcriptSegment.findUnique({ where: { sessionId_index: { sessionId, index } } });
  if (existing?.status === "DONE") return existing;
  const segment =
    existing ??
    (await db.transcriptSegment.create({ data: { sessionId, index, offsetMs: meta.offsetMs ?? null, durationMs: meta.durationMs ?? null } }));
  try {
    const result = await transcribeAudio(audio, mime, session.language);
    return db.transcriptSegment.update({ where: { id: segment.id }, data: { text: result.text, status: "DONE", error: null } });
  } catch (error) {
    return db.transcriptSegment.update({
      where: { id: segment.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : String(error) },
    });
  }
}

/** Segment de texte reconnu par le navigateur (reconnaissance vocale intégrée, sans clé API). */
export async function addTextSegment(sessionId: string, index: number, text: string, meta: { offsetMs?: number } = {}) {
  return db.transcriptSegment.upsert({
    where: { sessionId_index: { sessionId, index } },
    create: { sessionId, index, text: text.slice(0, 20000), status: "DONE", offsetMs: meta.offsetMs ?? null },
    update: { text: text.slice(0, 20000), status: "DONE", error: null },
  });
}

export async function assembleTranscript(sessionId: string): Promise<string> {
  const segments = await db.transcriptSegment.findMany({ where: { sessionId, status: "DONE" }, orderBy: { index: "asc" }, select: { text: true } });
  return segments
    .map((s) => (s.text ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Fin de l'enregistrement : assemblage de la transcription puis génération automatique du CR. */
export async function finalizeSession(sessionId: string, opts: { durationSec?: number | null; extraNotes?: string | null } = {}) {
  const session = await db.aiSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (session.status === "VALIDATED") return session;
  await db.aiSession.update({
    where: { id: sessionId },
    data: { status: "TRANSCRIBING", endedAt: session.endedAt ?? new Date(), durationSec: opts.durationSec ?? session.durationSec },
  });
  // Les segments en échec sont signalés (l'audio n'est pas conservé)
  let transcript = session.transcriptSource === "LIVE" ? await assembleTranscript(sessionId) : (session.transcript ?? "");
  if (opts.extraNotes?.trim()) transcript = `${transcript}\n\nNotes du commercial :\n${opts.extraNotes.trim()}`.trim();
  await db.aiSession.update({ where: { id: sessionId }, data: { transcript } });
  if (!transcript.trim()) {
    return db.aiSession.update({
      where: { id: sessionId },
      data: { status: "FAILED", error: "Aucune parole n'a été transcrite. Vérifiez le micro ou importez l'enregistrement." },
    });
  }
  if (!aiAvailable()) {
    return db.aiSession.update({
      where: { id: sessionId },
      data: { status: "READY", error: "IA non configurée : complétez le compte rendu manuellement à partir de la transcription." },
    });
  }
  await generateReport(sessionId);
  return db.aiSession.findUniqueOrThrow({ where: { id: sessionId } });
}

/** Import d'un enregistrement audio complet (appel, visio, RDV physique enregistré sur téléphone). */
export async function transcribeUpload(sessionId: string, audio: Buffer, mime: string) {
  if (!transcriptionAvailable()) throw new Error("Aucun service de transcription configuré pour l'import de fichiers audio.");
  const session = await db.aiSession.findUniqueOrThrow({ where: { id: sessionId } });
  await db.aiSession.update({ where: { id: sessionId }, data: { status: "TRANSCRIBING", error: null } });
  try {
    const result = await transcribeAudio(audio, mime, session.language);
    await db.aiSession.update({ where: { id: sessionId }, data: { transcript: result.text } });
  } catch (error) {
    await db.aiSession.update({ where: { id: sessionId }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

/** Récupère la transcription Google Meet d'un RDV terminé et génère le CR automatiquement. */
export async function importMeetTranscript(meetingId: string): Promise<"done" | "pending" | "unavailable"> {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { organizer: { include: { googleAccount: true } }, aiSessions: { select: { id: true } } },
  });
  if (!meeting || !meeting.videoUrl || !meeting.organizer.googleAccount) return "unavailable";
  if (meeting.aiSessions.length) return "done";
  const { fetchMeetTranscript } = await import("@/lib/google/meet");
  const res = await fetchMeetTranscript(meeting.organizer.googleAccount, meeting.videoUrl, meeting.startAt);
  await db.meeting.update({ where: { id: meetingId }, data: { meetTranscriptCheckedAt: new Date() } });
  if (res.status !== "ready") return res.status;
  const session = await createAiSession({
    kind: "VIDEO",
    userId: meeting.organizerId,
    contactId: meeting.contactId,
    dealId: meeting.dealId,
    meetingId,
    source: "GOOGLE_MEET",
    transcript: res.text,
  });
  await db.aiSession.update({ where: { id: session.id }, data: { durationSec: res.durationSec, startedAt: res.startedAt ?? meeting.startAt, endedAt: meeting.endAt } });
  if (aiAvailable()) {
    await generateReport(session.id);
  } else {
    await db.aiSession.update({ where: { id: session.id }, data: { status: "READY" } });
  }
  // La tâche « compte rendu » devient « valider le compte rendu »
  await db.task.updateMany({
    where: { meetingId, type: "MEETING_REPORT", status: "OPEN" },
    data: { title: `Valider le compte rendu IA du RDV « ${meeting.title} »`, description: `Compte rendu généré automatiquement depuis Google Meet : /assistant/${session.id}` },
  });
  return "done";
}

export type ValidateReportInput = {
  summary: string;
  report: MeetingReport;
  /** Indices des prochaines actions (côté commercial) à transformer en tâches */
  createTasks: { title: string; type: MeetingReport["nextActions"][number]["type"]; dueAt: Date }[];
  followUp: { send: boolean; to: string[]; subject: string; body: string } | null;
  dealStage?: DealStage | null;
  lostReasonId?: string | null;
};

function reportToText(summary: string, r: MeetingReport): string {
  const parts = [summary.trim()];
  const list = (title: string, items: string[]) => {
    if (items.length) parts.push(`${title} :\n${items.map((i) => `• ${i}`).join("\n")}`);
  };
  list("Points clés", r.keyPoints);
  list("Besoins", r.needs);
  list(
    "Objections",
    r.objections.map((o) => `${o.objection}${o.response ? ` → ${o.response}` : ""}${o.resolved ? " (levée)" : ""}`),
  );
  list("Prochaines actions", r.nextActions.map((a) => `${a.title} (${a.owner})`));
  const facts = [
    r.budget ? `Budget : ${r.budget}` : null,
    r.timeline ? `Calendrier : ${r.timeline}` : null,
    r.quantities ? `Volumes : ${r.quantities}` : null,
    r.decisionMakers.length ? `Décideurs : ${r.decisionMakers.join(", ")}` : null,
    r.competitors.length ? `Concurrence / existant : ${r.competitors.join(", ")}` : null,
    `Intérêt : ${r.interestLevel}/5`,
  ].filter(Boolean);
  parts.push(facts.join("\n"));
  list("Points de vigilance", r.risks);
  return parts.join("\n\n");
}

const ACTION_TO_TASK = { CALL: "CALL", EMAIL: "EMAIL", MEETING: "MEETING_PREP", QUOTE: "QUOTE", TRIAL: "TRIAL", TASK: "TODO" } as const;

/** Validation par le commercial : CR sur la fiche, tâches, email de suivi, étape du dossier. */
export async function validateReport(sessionId: string, userId: string, input: ValidateReportInput) {
  const session = await db.aiSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { user: { select: { signature: true, firstName: true, lastName: true, timezone: true } } },
  });
  if (session.status === "VALIDATED") throw new Error("Ce compte rendu a déjà été validé.");
  const body = reportToText(input.summary, input.report);

  await db.aiSession.update({
    where: { id: sessionId },
    data: {
      status: "VALIDATED",
      summary: input.summary,
      report: input.report,
      validatedAt: new Date(),
      validatedById: userId,
      followUpSubject: input.followUp?.subject ?? session.followUpSubject,
      followUpBody: input.followUp?.body ?? session.followUpBody,
      followUpTo: input.followUp?.to.join(", ") ?? session.followUpTo,
    },
  });

  await logActivity({
    type: "MEETING_REPORT",
    title: `Compte rendu — ${session.title}`,
    body,
    contactId: session.contactId,
    dealId: session.dealId,
    userId,
    meetingId: session.meetingId,
    aiSessionId: sessionId,
    occurredAt: session.startedAt,
    metadata: { interestLevel: input.report.interestLevel, sentiment: input.report.sentiment },
  });

  const { createTask } = await import("@/lib/tasks");
  for (const t of input.createTasks) {
    await createTask({
      title: t.title,
      type: ACTION_TO_TASK[t.type] ?? "TODO",
      source: "AI",
      dueAt: t.dueAt,
      hasTime: false,
      assigneeId: userId,
      contactId: session.contactId,
      dealId: session.dealId,
      meetingId: session.meetingId,
      description: `Issue du compte rendu « ${session.title} ».`,
    });
  }

  if (input.followUp?.send && input.followUp.to.length) {
    const composed = composeEmail({ subject: input.followUp.subject, body: input.followUp.body, signature: session.user.signature ?? `${session.user.firstName} ${session.user.lastName}` });
    const { sendEmail } = await import("@/lib/email/send");
    const email = await sendEmail({
      senderId: userId,
      to: input.followUp.to,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
      contactId: session.contactId,
      dealId: session.dealId,
    });
    await db.aiSession.update({ where: { id: sessionId }, data: { followUpSentAt: new Date(), followUpEmailId: email.id } });
  }

  if (session.dealId && input.dealStage) {
    const { changeDealStage } = await import("@/lib/deals");
    const deal = await db.deal.findUnique({ where: { id: session.dealId }, select: { stage: true } });
    if (deal && deal.stage !== input.dealStage) {
      await changeDealStage(session.dealId, input.dealStage, {
        userId,
        lostReasonId: input.lostReasonId ?? null,
        note: `Suite au compte rendu « ${session.title} » (${STAGE_LABELS[input.dealStage]})`,
      });
    }
  }

  if (session.meetingId) {
    await db.meeting.updateMany({ where: { id: session.meetingId, status: "SCHEDULED" }, data: { status: "COMPLETED", completedAt: new Date() } });
    const reportTasks = await db.task.findMany({ where: { meetingId: session.meetingId, type: "MEETING_REPORT", status: "OPEN" }, select: { id: true } });
    const { completeTask } = await import("@/lib/tasks");
    for (const t of reportTasks) await completeTask(t.id, userId, { note: "Compte rendu validé" });
  }
  if (session.contactId && session.kind === "CALL") {
    await logActivity({
      type: "CALL",
      title: `Appel avec suivi IA — ${session.title}`,
      body: input.summary.slice(0, 500),
      contactId: session.contactId,
      dealId: session.dealId,
      userId,
      callDirection: "OUTBOUND",
      callOutcome: "REACHED",
      callDurationSec: session.durationSec,
      aiSessionId: sessionId,
      occurredAt: session.startedAt,
    });
  }
  return db.aiSession.findUniqueOrThrow({ where: { id: sessionId } });
}

/** Date d'échéance d'une action proposée par l'IA (jours ouvrés, 9 h 30). */
export function dueDateFromDays(days: number | null, tz?: string | null): Date {
  const base = addBusinessDaysTz(new Date(), Math.max(1, days ?? 2), tz);
  return clampToBusinessWindow(zonedDateTime(dayKey(base, tz), "09:30", tz), { tz });
}
