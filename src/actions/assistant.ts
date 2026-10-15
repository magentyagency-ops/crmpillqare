"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertUser, isManager } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { addTextSegment, createAiSession, finalizeSession, validateReport } from "@/lib/ai/sessions";
import { generateReport, MeetingReportSchema } from "@/lib/ai/report";
import { parseDateTimeLocal } from "@/lib/dates";
import { enqueueJob } from "@/lib/jobs";

async function assertSessionAccess(sessionId: string) {
  const user = await assertUser();
  const session = await db.aiSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (session.userId !== user.id && !isManager(user)) throw new UserError("Cette session appartient à un autre commercial.");
  return { user, session };
}

/**
 * Lance une tâche longue après la réponse HTTP. Si le processus s'arrête en cours de route,
 * le planificateur reprend les sessions bloquées (voir recoverStuckSessions).
 */
function runInBackground(label: string, fn: () => Promise<unknown>) {
  after(async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[assistant] ${label} :`, error instanceof Error ? error.message : error);
    }
  });
}

const createSchema = z.object({
  kind: z.enum(["CALL", "VIDEO", "IN_PERSON"]),
  contactId: z.string().nullish(),
  dealId: z.string().nullish(),
  meetingId: z.string().nullish(),
  source: z.enum(["LIVE", "UPLOAD", "PASTE"]),
  consent: z.boolean(),
  transcript: z.string().nullish(),
  title: z.string().nullish(),
});

export async function createAiSessionAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = createSchema.parse(input);
    if (data.source !== "PASTE" && !data.consent) {
      throw new UserError("Confirmez que votre interlocuteur est informé de l'enregistrement.");
    }
    if (data.source === "PASTE" && (data.transcript ?? "").trim().length < 40) {
      throw new UserError("Collez une transcription ou des notes un peu plus détaillées (40 caractères minimum).");
    }
    const session = await createAiSession({
      kind: data.kind,
      userId: user.id,
      contactId: data.contactId ?? null,
      dealId: data.dealId ?? null,
      meetingId: data.meetingId ?? null,
      title: data.title ?? null,
      source: data.source,
      consentConfirmed: data.consent,
      transcript: data.source === "PASTE" ? data.transcript!.trim() : null,
    });
    if (data.source === "PASTE") {
      await db.aiSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });
      runInBackground("analyse", () => finalizeSession(session.id));
    }
    return { id: session.id };
  });
}

export async function addTextSegmentAction(sessionId: string, index: number, text: string, offsetMs?: number): Promise<ActionResult> {
  return runAction(async () => {
    await assertSessionAccess(sessionId);
    if (!text.trim()) return;
    await addTextSegment(sessionId, index, text.trim(), { offsetMs });
  });
}

export async function finalizeSessionAction(sessionId: string, opts: { durationSec?: number | null; extraNotes?: string | null } = {}): Promise<ActionResult> {
  return runAction(async () => {
    const { session } = await assertSessionAccess(sessionId);
    if (session.status === "VALIDATED") throw new UserError("Session déjà validée.");
    await db.aiSession.update({
      where: { id: sessionId },
      data: { status: "TRANSCRIBING", endedAt: session.endedAt ?? new Date(), durationSec: opts.durationSec ?? session.durationSec },
    });
    runInBackground("analyse", async () => {
      // Laisse le temps aux derniers segments audio d'être transcrits
      for (let i = 0; i < 20; i++) {
        const pending = await db.transcriptSegment.count({ where: { sessionId, status: "PENDING" } });
        if (!pending) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await finalizeSession(sessionId, opts);
    });
  });
}

export async function regenerateReportAction(sessionId: string, transcript?: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const { session } = await assertSessionAccess(sessionId);
    if (session.status === "VALIDATED") throw new UserError("Ce compte rendu est déjà validé.");
    if (transcript !== undefined && transcript !== null) {
      await db.aiSession.update({ where: { id: sessionId }, data: { transcript: transcript.trim() } });
    }
    await db.aiSession.update({ where: { id: sessionId }, data: { status: "ANALYZING", error: null } });
    runInBackground("génération du CR", () => generateReport(sessionId));
  }, "Analyse relancée");
}

/** Saisie manuelle du compte rendu quand l'IA n'est pas disponible. */
export async function saveManualReportAction(sessionId: string, summary: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertSessionAccess(sessionId);
    await db.aiSession.update({ where: { id: sessionId }, data: { summary, status: "READY", error: null } });
  });
}

const validateSchema = z.object({
  summary: z.string().trim().min(1, "Le résumé est obligatoire."),
  report: MeetingReportSchema,
  tasks: z.array(z.object({ title: z.string().trim().min(1), type: z.enum(["CALL", "EMAIL", "MEETING", "QUOTE", "TRIAL", "TASK"]), dueAt: z.string().min(1) })),
  followUp: z
    .object({ send: z.boolean(), to: z.string(), subject: z.string(), body: z.string() })
    .nullable(),
  dealStage: z.enum(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"]).nullish(),
  lostReasonId: z.string().nullish(),
});

export async function validateReportAction(sessionId: string, input: z.input<typeof validateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const { user } = await assertSessionAccess(sessionId);
    const data = validateSchema.parse(input);
    if (data.dealStage === "LOST" && !data.lostReasonId) throw new UserError("Indiquez le motif de refus.");
    const to = (data.followUp?.to ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (data.followUp?.send && to.length === 0) throw new UserError("Adresse du destinataire de l'email de suivi invalide.");
    if (data.followUp?.send && (!data.followUp.subject.trim() || !data.followUp.body.trim())) throw new UserError("L'email de suivi est incomplet.");
    await validateReport(sessionId, user.id, {
      summary: data.summary,
      report: data.report,
      createTasks: data.tasks.map((t) => ({ title: t.title, type: t.type, dueAt: parseDateTimeLocal(t.dueAt, user.timezone) ?? new Date() })),
      followUp: data.followUp ? { send: data.followUp.send, to, subject: data.followUp.subject, body: data.followUp.body } : null,
      dealStage: data.dealStage ?? null,
      lostReasonId: data.lostReasonId ?? null,
    });
  }, "Compte rendu validé et enregistré sur la fiche");
}

export async function deleteAiSessionAction(sessionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { session } = await assertSessionAccess(sessionId);
    if (session.status === "VALIDATED") throw new UserError("Un compte rendu validé ne peut pas être supprimé (il figure dans l'historique).");
    await db.aiSession.delete({ where: { id: sessionId } });
  }, "Session supprimée");
}

export async function getSessionLiveAction(sessionId: string) {
  await assertSessionAccess(sessionId);
  const [session, segments] = await Promise.all([
    db.aiSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true, error: true } }),
    db.transcriptSegment.findMany({ where: { sessionId }, orderBy: { index: "asc" }, select: { index: true, text: true, status: true, error: true } }),
  ]);
  return { ...session, segments };
}

/** Sessions bloquées (processus interrompu pendant l'analyse) : reprise automatique. */
export async function recoverSessionAction(sessionId: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertSessionAccess(sessionId);
    await enqueueJob("ai.finalize", { sessionId }, { dedupeKey: `ai-recover:${sessionId}:${Date.now()}` });
  }, "Reprise de l'analyse programmée");
}
