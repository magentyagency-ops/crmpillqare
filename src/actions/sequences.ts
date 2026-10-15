"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertRole, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import {
  approveStepRun,
  enroll,
  pauseEnrollment,
  resumeEnrollment,
  runStepNow,
  skipStepRun,
  stopEnrollment,
  updateStepRunContent,
} from "@/lib/sequences/engine";
import { renderTemplate } from "@/lib/email/render";
import { buildTemplateVars } from "@/lib/email/vars";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalString } from "@/lib/validation";

async function assertEnrollmentAccess(enrollmentId: string) {
  const user = await assertUser();
  const e = await db.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  await assertCanEdit(user, e.ownerId);
  return { user, enrollment: e };
}

async function assertRunAccess(runId: string) {
  const run = await db.sequenceStepRun.findUniqueOrThrow({ where: { id: runId }, select: { enrollmentId: true } });
  return assertEnrollmentAccess(run.enrollmentId);
}

export async function enrollAction(input: { sequenceId: string; contactId: string; dealId?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const contact = await db.contact.findUniqueOrThrow({ where: { id: input.contactId }, select: { ownerId: true, doNotContact: true } });
    let ownerId = contact.ownerId ?? user.id;
    if (input.dealId) ownerId = (await db.deal.findUniqueOrThrow({ where: { id: input.dealId }, select: { ownerId: true } })).ownerId;
    await assertCanEdit(user, ownerId);
    const res = await enroll({ sequenceId: input.sequenceId, contactId: input.contactId, dealId: input.dealId ?? null, ownerId });
    if (!res) throw new UserError("Cette séquence est inactive ou vide.");
  }, "Relances programmées");
}

export async function stopEnrollmentAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertEnrollmentAccess(id);
    await stopEnrollment(id, "MANUAL");
  }, "Relances arrêtées");
}

export async function pauseEnrollmentAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertEnrollmentAccess(id);
    await pauseEnrollment(id);
  }, "Relances en pause");
}

export async function resumeEnrollmentAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertEnrollmentAccess(id);
    await resumeEnrollment(id);
  }, "Relances reprises");
}

/** Aperçu personnalisé d'une relance (validation avant envoi). */
export async function previewStepRunAction(runId: string): Promise<ActionResult<{ subject: string; body: string; to: string | null; rawSubject: string; rawBody: string }>> {
  return runAction(async () => {
    await assertRunAccess(runId);
    const run = await db.sequenceStepRun.findUniqueOrThrow({
      where: { id: runId },
      include: { step: true, enrollment: { include: { contact: { select: { email: true } } } } },
    });
    const vars = await buildTemplateVars({
      contactId: run.enrollment.contactId,
      dealId: run.enrollment.dealId,
      userId: run.enrollment.ownerId,
      orderId: run.enrollment.orderId,
      quoteId: run.enrollment.quoteId,
    });
    const rawSubject = run.subjectOverride ?? run.step.subject ?? "";
    const rawBody = run.bodyOverride ?? run.step.body ?? "";
    return {
      subject: rawSubject ? renderTemplate(rawSubject, vars) : "(réponse dans le fil du premier email)",
      body: renderTemplate(rawBody, vars),
      to: run.enrollment.contact.email,
      rawSubject,
      rawBody,
    };
  });
}

export async function approveStepAction(runId: string, edits: { subject?: string | null; body?: string | null } = {}): Promise<ActionResult> {
  return runAction(async () => {
    await assertRunAccess(runId);
    const run = await approveStepRun(runId, edits);
    if (run.status === "FAILED") throw new UserError(run.error ?? "L'envoi a échoué.");
    if (run.status === "SCHEDULED") throw new UserError(`Envoi reporté : ${run.error ?? "erreur temporaire"}. Nouvel essai automatique.`);
  }, "Relance envoyée");
}

export async function skipStepAction(runId: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRunAccess(runId);
    await skipStepRun(runId);
  }, "Relance ignorée");
}

export async function runStepNowAction(runId: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRunAccess(runId);
    await runStepNow(runId);
  }, "Relance exécutée");
}

export async function updateStepRunAction(runId: string, input: { subject?: string | null; body?: string | null; scheduledAt?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    const { user } = await assertRunAccess(runId);
    await updateStepRunContent(runId, {
      subject: input.subject,
      body: input.body,
      scheduledAt: input.scheduledAt ? parseDateTimeLocal(input.scheduledAt, user.timezone) : null,
    });
  }, "Relance modifiée");
}

// ───────────── Gestion des scénarios (managers) ─────────────

const stepSchema = z.object({
  type: z.enum(["EMAIL", "CALL", "TASK"]),
  delayDays: z.coerce.number().int().min(0).max(365),
  delayHours: z.coerce.number().int().min(0).max(23).default(0),
  delayMinutes: z.coerce.number().int().min(0).max(59).default(0),
  sendTime: optionalString,
  subject: optionalString,
  body: optionalString,
  taskTitle: optionalString,
  taskDescription: optionalString,
  requiresApproval: z.boolean().default(false),
  aiPersonalize: z.boolean().default(false),
});

const sequenceSchema = z.object({
  id: optionalString,
  name: z.string().trim().min(1, "Nom obligatoire"),
  description: optionalString,
  active: z.boolean().default(true),
  trigger: z.enum(["STAGE_ENTERED", "WEB_FORM", "ORDER_PAID", "QUOTE_SENT", "TRIAL_STARTED", "MANUAL"]),
  triggerStage: z.enum(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"]).nullish(),
  contactKind: z.enum(["B2B", "B2C"]).nullish(),
  segmentIds: z.array(z.string()).default([]),
  priority: z.coerce.number().int().default(0),
  stopOnReply: z.boolean().default(true),
  stopOnStageChange: z.boolean().default(true),
  stopOnMeetingBooked: z.boolean().default(true),
  businessHoursOnly: z.boolean().default(true),
  steps: z.array(stepSchema).min(1, "Ajoutez au moins une étape"),
});

export async function saveSequenceAction(input: z.input<typeof sequenceSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const data = sequenceSchema.parse(input);
    if (data.trigger === "STAGE_ENTERED" && !data.triggerStage) throw new UserError("Choisissez l'étape qui déclenche la séquence.");
    data.steps.forEach((s, i) => {
      if (s.type === "EMAIL" && !s.body) throw new UserError(`Étape ${i + 1} : le contenu de l'email est vide.`);
      if (s.type === "EMAIL" && i === 0 && !s.subject) throw new UserError("Le premier email doit avoir un objet.");
      if (s.sendTime && !/^\d{1,2}:\d{2}$/.test(s.sendTime)) throw new UserError(`Étape ${i + 1} : heure d'envoi invalide (HH:mm).`);
    });
    const base = {
      name: data.name,
      description: data.description,
      active: data.active,
      trigger: data.trigger,
      triggerStage: data.trigger === "STAGE_ENTERED" ? (data.triggerStage ?? null) : null,
      contactKind: data.contactKind ?? null,
      segmentIds: data.segmentIds,
      priority: data.priority,
      stopOnReply: data.stopOnReply,
      stopOnStageChange: data.stopOnStageChange,
      stopOnMeetingBooked: data.stopOnMeetingBooked,
      businessHoursOnly: data.businessHoursOnly,
    };
    const steps = data.steps.map((s, i) => ({ ...s, position: i + 1 }));
    if (data.id) {
      const id = data.id;
      const existing = await db.sequence.findUniqueOrThrow({ where: { id }, include: { steps: { where: { archivedAt: null }, orderBy: { position: "asc" } } } });
      await db.$transaction(async (tx) => {
        await tx.sequence.update({ where: { id }, data: base });
        // Positions temporaires hors plage pour respecter l'unicité (sequenceId, position) pendant la réorganisation
        const maxPosition = (await tx.sequenceStep.aggregate({ where: { sequenceId: id }, _max: { position: true } }))._max.position ?? 0;
        const temp = maxPosition + 1000;
        // Les étapes existantes sont mises à jour (les relances déjà planifiées suivent le nouveau contenu)
        for (const [i, s] of steps.entries()) {
          const current = existing.steps[i];
          if (current) await tx.sequenceStep.update({ where: { id: current.id }, data: { ...s, position: temp + i } });
          else await tx.sequenceStep.create({ data: { ...s, position: temp + i, sequenceId: id } });
        }
        // Étapes retirées : relances à venir annulées ; l'étape est archivée si elle a un historique, supprimée sinon
        let archived = 0;
        for (const extra of existing.steps.slice(steps.length)) {
          await tx.sequenceStepRun.updateMany({ where: { stepId: extra.id, status: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED", error: "Étape supprimée du scénario" } });
          const history = await tx.sequenceStepRun.count({ where: { stepId: extra.id } });
          if (history) await tx.sequenceStep.update({ where: { id: extra.id }, data: { archivedAt: new Date(), position: temp + steps.length + 1000 + archived++ } });
          else await tx.sequenceStep.delete({ where: { id: extra.id } });
        }
        const all = await tx.sequenceStep.findMany({ where: { sequenceId: id, archivedAt: null }, orderBy: { position: "asc" } });
        for (const [i, s] of all.entries()) await tx.sequenceStep.update({ where: { id: s.id }, data: { position: i + 1 } });
      });
      return { id };
    }
    const created = await db.sequence.create({ data: { ...base, steps: { create: steps } } });
    return { id: created.id };
  }, "Scénario enregistré");
}

export async function toggleSequenceAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    await db.sequence.update({ where: { id }, data: { active } });
  }, active ? "Scénario activé" : "Scénario désactivé (les relances en cours continuent)");
}

export async function deleteSequenceAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const active = await db.sequenceEnrollment.count({ where: { sequenceId: id, status: { in: ["ACTIVE", "PAUSED"] } } });
    if (active) throw new UserError(`${active} relance(s) en cours utilisent ce scénario : désactivez-le plutôt que de le supprimer.`);
    await db.sequence.delete({ where: { id } });
  }, "Scénario supprimé");
}

export async function listSequencesForEnrollment() {
  await assertUser();
  return db.sequence.findMany({ where: { active: true, createdByAssistant: false }, orderBy: { name: "asc" }, select: { id: true, name: true, trigger: true } });
}
