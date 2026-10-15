"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { addCheckpoint, completeCheckpoint, createTrial, deleteCheckpoint, setTrialStatus } from "@/lib/trials";
import { logActivity } from "@/lib/activity";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalInt, optionalString } from "@/lib/validation";
import { TRIAL_RESULT_LABELS } from "@/lib/labels";

async function assertCheckpointAccess(user: Awaited<ReturnType<typeof assertUser>>, checkpointId: string) {
  const cp = await db.trialCheckpoint.findUniqueOrThrow({ where: { id: checkpointId }, select: { trial: { select: { ownerId: true } } } });
  await assertCanEdit(user, cp.trial.ownerId);
}

const itemSchema = z.object({
  productId: optionalString,
  name: z.string().trim().min(1, "Désignation du matériel obligatoire"),
  quantity: z.coerce.number().int().min(1),
  serialNumbers: optionalString,
  returnExpected: z.boolean().default(true),
});

const trialSchema = z.object({
  title: z.string().trim().min(1, "Titre obligatoire"),
  dealId: optionalString,
  contactId: optionalString,
  companyId: optionalString,
  ownerId: optionalString,
  startDate: optionalString,
  endDate: optionalString,
  location: optionalString,
  participants: optionalInt,
  objectives: optionalString,
  successCriteria: optionalString,
  items: z.array(itemSchema).default([]),
  checkpoints: z.array(z.object({ title: z.string().trim().min(1), dueAt: z.string().min(1) })).default([]),
});

export async function createTrialAction(input: z.input<typeof trialSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = trialSchema.parse(input);
    if (!data.dealId && !data.contactId && !data.companyId) throw new UserError("Rattachez l'essai à un dossier, un contact ou une organisation.");
    const start = parseDateTimeLocal(data.startDate, user.timezone);
    const end = parseDateTimeLocal(data.endDate, user.timezone);
    if (start && end && end < start) throw new UserError("La date de fin doit être après la date de début.");
    const trial = await createTrial(
      {
        ...data,
        ownerId: data.ownerId ?? user.id,
        startDate: start,
        endDate: end,
        checkpoints: data.checkpoints.map((c) => ({ title: c.title, dueAt: parseDateTimeLocal(c.dueAt, user.timezone)! })),
      },
      user.id,
    );
    return { id: trial.id };
  }, "Essai créé");
}

const updateSchema = trialSchema.omit({ items: true, checkpoints: true, dealId: true, contactId: true, companyId: true });

export async function updateTrialAction(id: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const trial = await db.trial.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, trial.ownerId);
    const data = updateSchema.parse(input);
    await db.trial.update({
      where: { id },
      data: {
        title: data.title,
        ownerId: data.ownerId ?? trial.ownerId,
        startDate: parseDateTimeLocal(data.startDate, user.timezone),
        endDate: parseDateTimeLocal(data.endDate, user.timezone),
        location: data.location,
        participants: data.participants,
        objectives: data.objectives,
        successCriteria: data.successCriteria,
      },
    });
  }, "Essai mis à jour");
}

export async function setTrialStatusAction(id: string, status: "PLANNED" | "EQUIPMENT_SENT" | "IN_PROGRESS" | "EVALUATION" | "CONVERTED" | "ENDED" | "CANCELLED"): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const trial = await db.trial.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, trial.ownerId);
    await setTrialStatus(id, status, user.id);
  }, "Statut mis à jour");
}

export async function saveTrialFeedbackAction(id: string, input: { feedback: string | null; rating: number | null; result: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const trial = await db.trial.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, trial.ownerId);
    await db.trial.update({ where: { id }, data: { feedback: input.feedback, rating: input.rating, result: input.result } });
    await logActivity({
      type: "TRIAL_EVENT",
      title: `Retour d'essai enregistré${input.result ? ` : ${TRIAL_RESULT_LABELS[input.result]}` : ""}${input.rating ? ` (${input.rating}/5)` : ""}`,
      body: input.feedback,
      contactId: trial.contactId,
      companyId: trial.companyId,
      dealId: trial.dealId,
      userId: user.id,
      trialId: id,
    });
  }, "Retour enregistré");
}

export async function addTrialItemAction(trialId: string, input: z.input<typeof itemSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const trial = await db.trial.findUniqueOrThrow({ where: { id: trialId } });
    await assertCanEdit(user, trial.ownerId);
    const data = itemSchema.parse(input);
    await db.trialItem.create({ data: { trialId, ...data } });
  }, "Matériel ajouté");
}

export async function updateTrialItemAction(
  itemId: string,
  input: { serialNumbers?: string | null; trackingNumber?: string | null; shipped?: boolean; delivered?: boolean; returned?: boolean; returnedQuantity?: number | null; notes?: string | null },
): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const item = await db.trialItem.findUniqueOrThrow({ where: { id: itemId }, include: { trial: true } });
    await assertCanEdit(user, item.trial.ownerId);
    const now = new Date();
    await db.trialItem.update({
      where: { id: itemId },
      data: {
        ...(input.serialNumbers !== undefined ? { serialNumbers: input.serialNumbers } : {}),
        ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.shipped !== undefined ? { shippedAt: input.shipped ? (item.shippedAt ?? now) : null } : {}),
        ...(input.delivered !== undefined ? { deliveredAt: input.delivered ? (item.deliveredAt ?? now) : null } : {}),
        ...(input.returned !== undefined ? { returnedAt: input.returned ? (item.returnedAt ?? now) : null, returnedQuantity: input.returned ? (input.returnedQuantity ?? item.quantity) : null } : {}),
      },
    });
    const event = input.returned ? "retourné" : input.delivered ? "livré" : input.shipped ? "expédié" : null;
    if (event) {
      await logActivity({
        type: "TRIAL_EVENT",
        title: `Matériel ${event} : ${item.quantity} × ${item.name}`,
        body: input.trackingNumber ? `Suivi : ${input.trackingNumber}` : null,
        contactId: item.trial.contactId,
        companyId: item.trial.companyId,
        dealId: item.trial.dealId,
        userId: user.id,
        trialId: item.trialId,
      });
    }
  }, "Matériel mis à jour");
}

export async function deleteTrialItemAction(itemId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const item = await db.trialItem.findUniqueOrThrow({ where: { id: itemId }, include: { trial: true } });
    await assertCanEdit(user, item.trial.ownerId);
    await db.trialItem.delete({ where: { id: itemId } });
  }, "Matériel retiré");
}

export async function addCheckpointAction(trialId: string, title: string, dueAt: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const trial = await db.trial.findUniqueOrThrow({ where: { id: trialId } });
    await assertCanEdit(user, trial.ownerId);
    const due = parseDateTimeLocal(dueAt, user.timezone);
    if (!title.trim() || !due) throw new UserError("Intitulé et date obligatoires.");
    await addCheckpoint(trialId, { title: title.trim(), dueAt: due });
  }, "Jalon ajouté (tâche créée)");
}

export async function completeCheckpointAction(checkpointId: string, notes?: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await assertCheckpointAccess(user, checkpointId);
    await completeCheckpoint(checkpointId, user.id, notes ?? null);
  }, "Jalon terminé");
}

export async function deleteCheckpointAction(checkpointId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await assertCheckpointAccess(user, checkpointId);
    await deleteCheckpoint(checkpointId);
  }, "Jalon supprimé");
}
