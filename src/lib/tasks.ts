import type { NextActionType, TaskPriority, TaskSource, TaskType } from "@/generated/prisma/enums";
import { db } from "./db";
import { logActivity } from "./activity";
import { enqueueJob } from "./jobs";
import { refreshDealNextAction } from "./deals";
import { TASK_TYPE_LABELS } from "./labels";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  type?: TaskType;
  priority?: TaskPriority;
  source?: TaskSource;
  dueAt?: Date | null;
  hasTime?: boolean;
  assigneeId: string;
  createdById?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  meetingId?: string | null;
  orderId?: string | null;
  trialId?: string | null;
  stepRunId?: string | null;
};

export const NEXT_ACTION_TO_TASK_TYPE: Record<NextActionType, TaskType> = {
  CALL: "CALL",
  EMAIL: "EMAIL",
  MEETING: "MEETING_PREP",
  FOLLOW_UP: "FOLLOW_UP",
  QUOTE: "QUOTE",
  DEMO: "MEETING_PREP",
  TASK: "TODO",
};

export function taskTypeToNextAction(type: TaskType): NextActionType {
  switch (type) {
    case "CALL":
    case "CALLBACK":
      return "CALL";
    case "EMAIL":
      return "EMAIL";
    case "FOLLOW_UP":
      return "FOLLOW_UP";
    case "MEETING_PREP":
      return "MEETING";
    case "QUOTE":
      return "QUOTE";
    default:
      return "TASK";
  }
}

export async function createTask(input: CreateTaskInput) {
  let companyId = input.companyId ?? null;
  let contactId = input.contactId ?? null;
  if (input.dealId && (!contactId || !companyId)) {
    const deal = await db.deal.findUnique({ where: { id: input.dealId }, select: { contactId: true, companyId: true } });
    contactId = contactId ?? deal?.contactId ?? null;
    companyId = companyId ?? deal?.companyId ?? null;
  }
  if (contactId && !companyId) {
    const c = await db.contact.findUnique({ where: { id: contactId }, select: { companyId: true } });
    companyId = c?.companyId ?? null;
  }
  const task = await db.task.create({
    data: {
      title: input.title.slice(0, 300),
      description: input.description ?? null,
      type: input.type ?? "TODO",
      priority: input.priority ?? "NORMAL",
      source: input.source ?? "MANUAL",
      dueAt: input.dueAt ?? null,
      hasTime: input.hasTime ?? false,
      assigneeId: input.assigneeId,
      createdById: input.createdById ?? null,
      contactId,
      companyId,
      dealId: input.dealId ?? null,
      meetingId: input.meetingId ?? null,
      orderId: input.orderId ?? null,
      trialId: input.trialId ?? null,
      stepRunId: input.stepRunId ?? null,
    },
  });
  if (task.dealId) await refreshDealNextAction(task.dealId);
  if (task.hasTime && task.dueAt) await enqueueJob("calendar.syncTask", { taskId: task.id });
  return task;
}

export async function completeTask(taskId: string, userId: string | null, opts: { note?: string | null } = {}) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { checkpoint: true } });
  if (!task) throw new Error("Tâche introuvable.");
  if (task.status === "DONE") return task;
  const now = new Date();
  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      status: "DONE",
      completedAt: now,
      description: opts.note ? [task.description, `Résultat : ${opts.note}`].filter(Boolean).join("\n\n") : task.description,
    },
  });

  if (task.contactId || task.dealId || task.companyId) {
    await logActivity({
      type: "TASK_COMPLETED",
      title: `${TASK_TYPE_LABELS[task.type]} : ${task.title}`,
      body: opts.note ?? null,
      contactId: task.contactId,
      companyId: task.companyId,
      dealId: task.dealId,
      userId,
      trialId: task.trialId,
      orderId: task.orderId,
    });
  }

  // Étape de relance automatique (appel / tâche) réalisée
  if (task.stepRunId) {
    await db.sequenceStepRun.updateMany({
      where: { id: task.stepRunId, status: "TASK_OPEN" },
      data: { status: "DONE", executedAt: now },
    });
  }
  // Jalon d'essai / pilote
  if (task.checkpoint && !task.checkpoint.doneAt) {
    await db.trialCheckpoint.update({ where: { id: task.checkpoint.id }, data: { doneAt: now } });
  }
  // Suivi après-achat
  if (task.orderId) {
    if (task.type === "INSTALLATION") await db.order.update({ where: { id: task.orderId }, data: { installationDoneAt: now } });
    if (task.type === "ONBOARDING") await db.order.update({ where: { id: task.orderId }, data: { onboardingDoneAt: now } });
  }
  if (task.dealId) await refreshDealNextAction(task.dealId);
  if (task.googleEventId) await enqueueJob("calendar.syncTask", { taskId: task.id });
  return updated;
}

export async function reopenTask(taskId: string) {
  const task = await db.task.update({ where: { id: taskId }, data: { status: "OPEN", completedAt: null } });
  if (task.stepRunId) {
    await db.sequenceStepRun.updateMany({ where: { id: task.stepRunId, status: "DONE" }, data: { status: "TASK_OPEN" } });
  }
  if (task.dealId) await refreshDealNextAction(task.dealId);
  if (task.hasTime) await enqueueJob("calendar.syncTask", { taskId: task.id });
  return task;
}

export async function cancelTask(taskId: string) {
  const task = await db.task.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
  if (task.stepRunId) {
    await db.sequenceStepRun.updateMany({ where: { id: task.stepRunId, status: "TASK_OPEN" }, data: { status: "SKIPPED" } });
  }
  if (task.dealId) await refreshDealNextAction(task.dealId);
  if (task.googleEventId) await enqueueJob("calendar.syncTask", { taskId: task.id });
  return task;
}

export async function rescheduleTask(taskId: string, dueAt: Date, hasTime: boolean) {
  const task = await db.task.update({ where: { id: taskId }, data: { dueAt, hasTime, reminderSentAt: null } });
  if (task.dealId) await refreshDealNextAction(task.dealId);
  if (task.hasTime || task.googleEventId) await enqueueJob("calendar.syncTask", { taskId: task.id });
  return task;
}
