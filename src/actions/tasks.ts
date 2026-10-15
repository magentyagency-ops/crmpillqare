"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser, isManager } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { cancelTask, completeTask, createTask, reopenTask, rescheduleTask } from "@/lib/tasks";
import { refreshDealNextAction } from "@/lib/deals";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalString } from "@/lib/validation";
import { enqueueJob } from "@/lib/jobs";

const TYPES = ["CALL", "EMAIL", "FOLLOW_UP", "CALLBACK", "MEETING_PREP", "MEETING_REPORT", "QUOTE", "INSTALLATION", "ONBOARDING", "SATISFACTION", "TRIAL", "TODO"] as const;

const taskSchema = z.object({
  title: z.string().trim().min(1, "Titre obligatoire"),
  description: optionalString,
  type: z.enum(TYPES).default("TODO"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueAt: optionalString,
  assigneeId: optionalString,
  contactId: optionalString,
  dealId: optionalString,
  companyId: optionalString,
  meetingId: optionalString,
  trialId: optionalString,
  orderId: optionalString,
});

export async function createTaskAction(input: z.input<typeof taskSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = taskSchema.parse(input);
    const assigneeId = data.assigneeId ?? user.id;
    if (assigneeId !== user.id && !isManager(user)) {
      const target = await db.user.findUnique({ where: { id: assigneeId }, select: { active: true } });
      if (!target?.active) throw new UserError("Utilisateur assigné invalide.");
    }
    const task = await createTask({
      ...data,
      dueAt: parseDateTimeLocal(data.dueAt, user.timezone),
      hasTime: Boolean(data.dueAt?.includes("T")),
      assigneeId,
      createdById: user.id,
      source: "MANUAL",
    });
    if (assigneeId !== user.id) {
      const { notify } = await import("@/lib/notifications");
      await notify({ userId: assigneeId, type: "TASK_DUE", title: `Nouvelle tâche : ${task.title}`, link: `/taches?task=${task.id}` });
    }
    return { id: task.id };
  }, "Tâche créée");
}

export async function updateTaskAction(id: string, input: z.input<typeof taskSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    const data = taskSchema.parse(input);
    const dueAt = parseDateTimeLocal(data.dueAt, user.timezone);
    const updated = await db.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        type: data.type,
        priority: data.priority,
        dueAt,
        hasTime: Boolean(data.dueAt?.includes("T")),
        assigneeId: data.assigneeId ?? task.assigneeId,
        reminderSentAt: dueAt?.getTime() !== task.dueAt?.getTime() ? null : task.reminderSentAt,
      },
    });
    if (updated.dealId) await refreshDealNextAction(updated.dealId);
    if (updated.hasTime || updated.googleEventId) await enqueueJob("calendar.syncTask", { taskId: id });
  }, "Tâche mise à jour");
}

export async function completeTaskAction(id: string, note?: string | null): Promise<ActionResult<{ dealId: string | null; dealHasNextAction: boolean }>> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    await completeTask(id, user.id, { note: note ?? null });
    let dealHasNextAction = true;
    if (task.dealId) {
      const deal = await db.deal.findUnique({ where: { id: task.dealId }, select: { nextActionAt: true, stage: true } });
      dealHasNextAction = !deal || deal.stage === "WON" || deal.stage === "LOST" || Boolean(deal.nextActionAt);
    }
    return { dealId: task.dealId, dealHasNextAction };
  }, "Tâche terminée");
}

export async function reopenTaskAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    await reopenTask(id);
  }, "Tâche rouverte");
}

export async function cancelTaskAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    await cancelTask(id);
  }, "Tâche annulée");
}

export async function rescheduleTaskAction(id: string, dueAt: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    const date = parseDateTimeLocal(dueAt, user.timezone);
    if (!date) throw new UserError("Date invalide.");
    await rescheduleTask(id, date, dueAt.includes("T"));
  }, "Tâche replanifiée");
}

/** Décale d'un nombre de jours (boutons « demain », « +1 semaine »). */
export async function postponeTaskAction(id: string, days: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    const { addBusinessDaysTz, addDaysTz, dayKey, isWeekendTz, timeKey, zonedDateTime } = await import("@/lib/dates");
    const tz = user.timezone;
    // À partir de la date prévue (ou d'aujourd'hui si la tâche est en retard), en conservant l'heure prévue
    const now = new Date();
    const from = task.dueAt && task.dueAt > now ? task.dueAt : now;
    let day = days === 1 ? addBusinessDaysTz(from, 1, tz) : addDaysTz(from, days, tz);
    while (isWeekendTz(day, tz)) day = addDaysTz(day, 1, tz);
    const time = task.dueAt && task.hasTime ? timeKey(task.dueAt, tz) : "09:00";
    await rescheduleTask(id, zonedDateTime(dayKey(day, tz), time, tz), task.hasTime);
  }, "Tâche décalée");
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, task.assigneeId);
    if (task.googleEventId) {
      await db.task.update({ where: { id }, data: { status: "CANCELLED" } });
      await enqueueJob("calendar.syncTask", { taskId: id });
    } else {
      await db.task.delete({ where: { id } });
    }
    if (task.dealId) await refreshDealNextAction(task.dealId);
  }, "Tâche supprimée");
}
