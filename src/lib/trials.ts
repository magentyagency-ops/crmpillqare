import type { TrialStatus } from "@/generated/prisma/enums";
import { db } from "./db";
import { logActivity } from "./activity";
import { createTask, completeTask } from "./tasks";
import { refreshDealNextAction } from "./deals";
import { TRIAL_STATUS_LABELS } from "./labels";
import { notifyManagers } from "./notifications";

export type TrialItemInput = {
  productId?: string | null;
  name: string;
  quantity: number;
  serialNumbers?: string | null;
  returnExpected?: boolean;
  notes?: string | null;
};

export type CheckpointInput = { title: string; dueAt: Date; notes?: string | null };

export type TrialInput = {
  title: string;
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  ownerId: string;
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string | null;
  participants?: number | null;
  objectives?: string | null;
  successCriteria?: string | null;
  items?: TrialItemInput[];
  checkpoints?: CheckpointInput[];
};

async function checkpointTask(trial: { id: string; title: string; ownerId: string; contactId: string | null; companyId: string | null; dealId: string | null }, cp: { id: string; title: string; dueAt: Date }) {
  const task = await createTask({
    title: `${cp.title} — essai « ${trial.title} »`,
    type: "TRIAL",
    source: "SYSTEM",
    dueAt: cp.dueAt,
    hasTime: false,
    assigneeId: trial.ownerId,
    contactId: trial.contactId,
    companyId: trial.companyId,
    dealId: trial.dealId,
    trialId: trial.id,
  });
  await db.trialCheckpoint.update({ where: { id: cp.id }, data: { taskId: task.id } });
}

export async function createTrial(input: TrialInput, byUserId: string) {
  let companyId = input.companyId ?? null;
  let contactId = input.contactId ?? null;
  if (input.dealId) {
    const deal = await db.deal.findUnique({ where: { id: input.dealId }, select: { contactId: true, companyId: true } });
    contactId = contactId ?? deal?.contactId ?? null;
    companyId = companyId ?? deal?.companyId ?? null;
  }
  const trial = await db.trial.create({
    data: {
      title: input.title,
      dealId: input.dealId ?? null,
      companyId,
      contactId,
      ownerId: input.ownerId,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      location: input.location ?? null,
      participants: input.participants ?? null,
      objectives: input.objectives ?? null,
      successCriteria: input.successCriteria ?? null,
      items: {
        create: (input.items ?? []).map((i) => ({
          productId: i.productId ?? null,
          name: i.name,
          quantity: i.quantity,
          serialNumbers: i.serialNumbers ?? null,
          returnExpected: i.returnExpected ?? true,
          notes: i.notes ?? null,
        })),
      },
      checkpoints: { create: (input.checkpoints ?? []).map((c) => ({ title: c.title, dueAt: c.dueAt, notes: c.notes ?? null })) },
    },
    include: { checkpoints: true },
  });
  for (const cp of trial.checkpoints) await checkpointTask(trial, cp);
  await logActivity({
    type: "TRIAL_EVENT",
    title: `Essai / pilote créé : ${trial.title}`,
    body: input.startDate ? `Du ${input.startDate.toLocaleDateString("fr-FR")}${input.endDate ? ` au ${input.endDate.toLocaleDateString("fr-FR")}` : ""}` : null,
    contactId,
    companyId,
    dealId: input.dealId ?? null,
    userId: byUserId,
    trialId: trial.id,
  });
  if (trial.dealId) await refreshDealNextAction(trial.dealId);
  return trial;
}

export async function setTrialStatus(trialId: string, status: TrialStatus, byUserId: string) {
  const trial = await db.trial.findUniqueOrThrow({ where: { id: trialId } });
  if (trial.status === status) return trial;
  const now = new Date();
  const data: Parameters<typeof db.trial.update>[0]["data"] = { status };
  if (status === "IN_PROGRESS" && !trial.startDate) data.startDate = now;
  if (status === "CONVERTED") data.convertedAt = now;
  if ((status === "ENDED" || status === "CONVERTED") && !trial.endDate) data.endDate = now;
  const updated = await db.trial.update({ where: { id: trialId }, data });

  if (status === "EQUIPMENT_SENT") {
    await db.trialItem.updateMany({ where: { trialId, shippedAt: null }, data: { shippedAt: now } });
  }
  if (status === "IN_PROGRESS" && trial.contactId) {
    const { autoEnroll } = await import("./sequences/engine");
    await autoEnroll("TRIAL_STARTED", { contactId: trial.contactId, dealId: trial.dealId, trialId, ownerId: trial.ownerId });
  }
  if (status === "ENDED" || status === "CANCELLED" || status === "CONVERTED") {
    const { stopEnrollment } = await import("./sequences/engine");
    const active = await db.sequenceEnrollment.findMany({ where: { trialId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } });
    for (const e of active) await stopEnrollment(e.id, "MANUAL");
    if (status === "CANCELLED") {
      await db.task.updateMany({ where: { trialId, status: "OPEN" }, data: { status: "CANCELLED" } });
    }
    // Retour du matériel prêté
    const toReturn = await db.trialItem.findMany({ where: { trialId, returnExpected: true, returnedAt: null, shippedAt: { not: null } } });
    if (toReturn.length && status !== "CONVERTED") {
      await createTask({
        title: `Récupérer le matériel prêté — essai « ${trial.title} »`,
        description: toReturn.map((i) => `${i.quantity} × ${i.name}${i.serialNumbers ? ` (n° ${i.serialNumbers})` : ""}`).join("\n"),
        type: "TRIAL",
        source: "SYSTEM",
        dueAt: new Date(now.getTime() + 3 * 86_400_000),
        assigneeId: trial.ownerId,
        contactId: trial.contactId,
        companyId: trial.companyId,
        dealId: trial.dealId,
        trialId,
      });
    }
  }
  if (status === "CONVERTED") {
    await notifyManagers({ type: "SYSTEM", title: `🎉 Essai converti : ${trial.title}`, link: `/essais/${trialId}` });
  }
  await logActivity({
    type: "TRIAL_EVENT",
    title: `Essai « ${trial.title} » : ${TRIAL_STATUS_LABELS[trial.status]} → ${TRIAL_STATUS_LABELS[status]}`,
    contactId: trial.contactId,
    companyId: trial.companyId,
    dealId: trial.dealId,
    userId: byUserId,
    trialId,
  });
  if (trial.dealId) await refreshDealNextAction(trial.dealId);
  return updated;
}

export async function addCheckpoint(trialId: string, input: CheckpointInput) {
  const trial = await db.trial.findUniqueOrThrow({ where: { id: trialId } });
  const cp = await db.trialCheckpoint.create({ data: { trialId, title: input.title, dueAt: input.dueAt, notes: input.notes ?? null } });
  await checkpointTask(trial, cp);
  return cp;
}

export async function completeCheckpoint(checkpointId: string, userId: string, notes?: string | null) {
  const cp = await db.trialCheckpoint.findUniqueOrThrow({ where: { id: checkpointId } });
  await db.trialCheckpoint.update({ where: { id: checkpointId }, data: { doneAt: new Date(), notes: notes ?? cp.notes } });
  if (cp.taskId) await completeTask(cp.taskId, userId, { note: notes ?? null });
}

export async function deleteCheckpoint(checkpointId: string) {
  const cp = await db.trialCheckpoint.findUniqueOrThrow({ where: { id: checkpointId } });
  if (cp.taskId) await db.task.updateMany({ where: { id: cp.taskId, status: "OPEN" }, data: { status: "CANCELLED" } });
  await db.trialCheckpoint.delete({ where: { id: checkpointId } });
}

/** Prochaine échéance d'un essai : jalon ouvert, fin d'essai, ou retour de matériel attendu. */
export function trialNextDeadline(trial: {
  status: TrialStatus;
  endDate: Date | null;
  checkpoints: { title: string; dueAt: Date; doneAt: Date | null }[];
  items: { returnExpected: boolean; returnedAt: Date | null; shippedAt: Date | null }[];
}): { at: Date; label: string } | null {
  const candidates: { at: Date; label: string }[] = [];
  for (const c of trial.checkpoints) if (!c.doneAt) candidates.push({ at: c.dueAt, label: c.title });
  const active = ["PLANNED", "EQUIPMENT_SENT", "IN_PROGRESS", "EVALUATION"].includes(trial.status);
  if (active && trial.endDate) candidates.push({ at: trial.endDate, label: "Fin de l'essai" });
  if (["ENDED", "CANCELLED"].includes(trial.status) && trial.items.some((i) => i.returnExpected && i.shippedAt && !i.returnedAt)) {
    candidates.push({ at: trial.endDate ?? new Date(), label: "Retour du matériel" });
  }
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] ?? null;
}
