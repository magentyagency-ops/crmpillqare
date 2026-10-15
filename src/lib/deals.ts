import type { ContactKind, ContactSource, DealStage, NextActionType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logActivity } from "./activity";
import { notify, notifyManagers } from "./notifications";
import { NEXT_ACTION_LABELS, STAGE_LABELS, STAGE_PROBABILITY, contactDisplayName, type BlockedReason } from "./labels";
import { getSettings, type PipelineSettings } from "./settings";
import { formatEUR } from "./format";

export const STAGE_INDEX: Record<DealStage, number> = {
  PROSPECT: 0,
  CONTACTED: 1,
  MEETING: 2,
  QUOTE: 3,
  FOLLOW_UP: 4,
  WON: 5,
  LOST: 5,
};

export function isClosedStage(stage: DealStage) {
  return stage === "WON" || stage === "LOST";
}

/**
 * Recalcule la « prochaine action » d'un dossier : la plus proche parmi les tâches ouvertes,
 * les RDV à venir et les relances automatiques planifiées.
 */
export async function refreshDealNextAction(dealId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
  if (!deal) return;
  if (isClosedStage(deal.stage)) {
    await db.deal.update({ where: { id: dealId }, data: { nextActionAt: null, nextActionLabel: null, nextActionType: null } });
    return;
  }
  const now = new Date();
  const [task, meeting, step] = await Promise.all([
    db.task.findFirst({
      where: { dealId, status: "OPEN" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { title: true, type: true, dueAt: true },
    }),
    db.meeting.findFirst({
      where: { dealId, status: "SCHEDULED", startAt: { gte: now } },
      orderBy: { startAt: "asc" },
      select: { title: true, startAt: true },
    }),
    db.sequenceStepRun.findFirst({
      where: { status: { in: ["SCHEDULED", "PENDING_APPROVAL"] }, enrollment: { dealId, status: "ACTIVE" } },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true, type: true, step: { select: { subject: true, taskTitle: true } } },
    }),
  ]);

  type Candidate = { at: Date | null; type: NextActionType; label: string };
  const candidates: Candidate[] = [];
  if (task) {
    const { taskTypeToNextAction } = await import("./tasks");
    candidates.push({ at: task.dueAt, type: taskTypeToNextAction(task.type), label: task.title });
  }
  if (meeting) candidates.push({ at: meeting.startAt, type: "MEETING", label: meeting.title });
  if (step) {
    candidates.push({
      at: step.scheduledAt,
      type: step.type === "EMAIL" ? "FOLLOW_UP" : step.type === "CALL" ? "CALL" : "TASK",
      label: step.type === "EMAIL" ? `Relance auto : ${step.step.subject ?? "email"}` : (step.step.taskTitle ?? "Relance"),
    });
  }
  candidates.sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
  const next = candidates[0];
  await db.deal.update({
    where: { id: dealId },
    data: next
      ? { nextActionAt: next.at, nextActionType: next.type, nextActionLabel: next.label.slice(0, 250) }
      : { nextActionAt: null, nextActionType: null, nextActionLabel: null },
  });
}

export type CreateDealInput = {
  title: string;
  contactId: string;
  companyId?: string | null;
  ownerId: string;
  createdById?: string | null;
  stage?: DealStage;
  kind?: ContactKind;
  segmentId?: string | null;
  amount?: number | null;
  quantity?: number | null;
  expectedCloseAt?: Date | null;
  source?: ContactSource;
  notes?: string | null;
  nextAction?: { type: NextActionType; label?: string | null; dueAt: Date; hasTime?: boolean } | null;
  /** Ne pas déclencher les relances automatiques (ex. import) */
  skipAutomation?: boolean;
};

export async function createDeal(input: CreateDealInput) {
  const contact = await db.contact.findUniqueOrThrow({
    where: { id: input.contactId },
    select: { id: true, kind: true, companyId: true, segmentId: true, firstName: true, lastName: true, email: true, phone: true },
  });
  const stage = input.stage ?? "PROSPECT";
  const deal = await db.deal.create({
    data: {
      title: input.title.slice(0, 200),
      contactId: contact.id,
      companyId: input.companyId ?? contact.companyId,
      ownerId: input.ownerId,
      createdById: input.createdById ?? null,
      stage,
      kind: input.kind ?? contact.kind,
      segmentId: input.segmentId ?? contact.segmentId,
      amount: input.amount ?? null,
      quantity: input.quantity ?? null,
      probability: STAGE_PROBABILITY[stage],
      expectedCloseAt: input.expectedCloseAt ?? null,
      source: input.source ?? "MANUAL",
      notes: input.notes ?? null,
      wonAt: stage === "WON" ? new Date() : null,
      lostAt: stage === "LOST" ? new Date() : null,
      stageHistory: { create: { toStage: stage, userId: input.createdById ?? null } },
    },
  });
  if (!contact.companyId && deal.companyId) {
    await db.contact.update({ where: { id: contact.id }, data: { companyId: deal.companyId } });
  }
  await db.contact.updateMany({ where: { id: contact.id, ownerId: null }, data: { ownerId: input.ownerId } });

  await logActivity({
    type: "DEAL_CREATED",
    title: `Dossier créé : ${deal.title}`,
    body: `Étape : ${STAGE_LABELS[stage]}${input.amount ? ` — ${formatEUR(input.amount)}` : ""}`,
    contactId: contact.id,
    companyId: deal.companyId,
    dealId: deal.id,
    userId: input.createdById ?? null,
  });

  if (input.nextAction) {
    const { createTask, NEXT_ACTION_TO_TASK_TYPE } = await import("./tasks");
    await createTask({
      title: input.nextAction.label?.trim() || `${NEXT_ACTION_LABELS[input.nextAction.type]} — ${contactDisplayName(contact)}`,
      type: NEXT_ACTION_TO_TASK_TYPE[input.nextAction.type],
      dueAt: input.nextAction.dueAt,
      hasTime: input.nextAction.hasTime ?? true,
      assigneeId: input.ownerId,
      createdById: input.createdById ?? null,
      dealId: deal.id,
      contactId: contact.id,
    });
  }

  if (!input.skipAutomation) {
    const { onDealStageChanged } = await import("./sequences/engine");
    await onDealStageChanged(deal.id, null, stage);
  }
  await refreshDealNextAction(deal.id);
  return deal;
}

export type ChangeStageOptions = {
  userId?: string | null;
  lostReasonId?: string | null;
  lostReasonDetail?: string | null;
  note?: string | null;
  amount?: number | null;
  /** Ne pas déclencher les relances (ex. changement automatique interne) */
  skipAutomation?: boolean;
};

export async function changeDealStage(dealId: string, toStage: DealStage, opts: ChangeStageOptions = {}) {
  const deal = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
  });
  if (deal.stage === toStage) return deal;
  if (toStage === "LOST" && !opts.lostReasonId) {
    throw new Error("Le motif de refus est obligatoire pour passer un dossier en « Refusé ».");
  }
  const now = new Date();
  const data: Prisma.DealUpdateInput = {
    stage: toStage,
    stageEnteredAt: now,
    probability: STAGE_PROBABILITY[toStage],
  };
  if (toStage === "WON") {
    data.wonAt = now;
    data.lostAt = null;
    data.lostReason = { disconnect: true };
    data.lostReasonDetail = null;
  } else if (toStage === "LOST") {
    data.lostAt = now;
    data.wonAt = null;
    data.lostReason = { connect: { id: opts.lostReasonId! } };
    data.lostReasonDetail = opts.lostReasonDetail ?? null;
  } else {
    data.wonAt = null;
    data.lostAt = null;
  }
  if (opts.amount !== undefined && opts.amount !== null) data.amount = opts.amount;

  const updated = await db.deal.update({ where: { id: dealId }, data });
  await db.dealStageHistory.create({
    data: { dealId, fromStage: deal.stage, toStage, userId: opts.userId ?? null, note: opts.note ?? opts.lostReasonDetail ?? null },
  });

  let lostLabel = "";
  if (toStage === "LOST" && opts.lostReasonId) {
    const reason = await db.lostReason.findUnique({ where: { id: opts.lostReasonId } });
    lostLabel = reason ? ` — motif : ${reason.label}${opts.lostReasonDetail ? ` (${opts.lostReasonDetail})` : ""}` : "";
  }
  await logActivity({
    type: "STAGE_CHANGED",
    title: `${STAGE_LABELS[deal.stage]} → ${STAGE_LABELS[toStage]}`,
    body: [lostLabel.replace(/^ — /, ""), opts.note].filter(Boolean).join("\n") || null,
    contactId: deal.contactId,
    companyId: deal.companyId,
    dealId,
    userId: opts.userId ?? null,
    metadata: { from: deal.stage, to: toStage },
  });

  if (toStage === "WON") {
    await db.contact.update({ where: { id: deal.contactId }, data: { status: "CUSTOMER" } });
    await notifyManagers({
      type: "SYSTEM",
      title: `🎉 Dossier signé : ${deal.title}`,
      body: `${contactDisplayName(deal.contact)}${updated.amount ? ` — ${formatEUR(updated.amount)}` : ""}`,
      link: `/pipeline/${dealId}`,
    });
  }
  if (isClosedStage(toStage)) {
    // Les tâches générées automatiquement pour faire avancer la vente (relances, rappels, RDV à reprogrammer…)
    // n'ont plus lieu d'être ; les tâches saisies par le commercial et l'après-vente sont conservées.
    const stale = await db.task.findMany({
      where: {
        dealId,
        status: "OPEN",
        OR: [
          { source: "SEQUENCE" },
          // Refus : toutes les actions commerciales du dossier
          // Signature : les actions d'avant-vente (devis, relance, préparation de RDV, rappel) et celles générées automatiquement ;
          // les appels / emails saisis par le commercial sont conservés (ils peuvent concerner la mise en place)
          toStage === "LOST"
            ? { type: { in: ["CALL", "CALLBACK", "FOLLOW_UP", "EMAIL", "MEETING_PREP", "QUOTE"] } }
            : { OR: [{ type: { in: ["CALLBACK", "FOLLOW_UP", "MEETING_PREP", "QUOTE"] } }, { source: { in: ["WEB_FORM", "BOOKING", "SYSTEM", "AI"] }, type: { in: ["CALL", "EMAIL"] } }] },
        ],
      },
      select: { id: true, googleEventId: true },
    });
    if (stale.length) {
      await db.task.updateMany({ where: { id: { in: stale.map((t) => t.id) } }, data: { status: "CANCELLED" } });
      const { enqueueJob } = await import("./jobs");
      for (const t of stale) if (t.googleEventId) await enqueueJob("calendar.syncTask", { taskId: t.id });
    }
  }

  const { onDealStageChanged } = await import("./sequences/engine");
  if (!opts.skipAutomation) await onDealStageChanged(dealId, deal.stage, toStage);
  else await onDealStageChanged(dealId, deal.stage, toStage, { stopOnly: true });

  await refreshDealNextAction(dealId);
  return updated;
}

/** Fait avancer un dossier ouvert jusqu'à `stage` s'il est à une étape antérieure (jamais en arrière). */
export async function advanceDealTo(dealId: string, stage: DealStage, opts: ChangeStageOptions = {}) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
  if (!deal || isClosedStage(deal.stage)) return null;
  if (STAGE_INDEX[deal.stage] >= STAGE_INDEX[stage]) return null;
  return changeDealStage(dealId, stage, opts);
}

/** Dossier ouvert le plus récent d'un contact (pour rattacher emails, RDV, devis…) */
export async function findOpenDealForContact(contactId: string) {
  return db.deal.findFirst({
    where: { contactId, stage: { notIn: ["WON", "LOST"] }, archivedAt: null },
    orderBy: { updatedAt: "desc" },
  });
}

export async function reassignDeal(dealId: string, newOwnerId: string, byUserId: string | null) {
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { owner: true } });
  if (deal.ownerId === newOwnerId) return deal;
  const newOwner = await db.user.findUniqueOrThrow({ where: { id: newOwnerId } });
  const updated = await db.deal.update({ where: { id: dealId }, data: { ownerId: newOwnerId } });
  await db.task.updateMany({ where: { dealId, status: "OPEN", assigneeId: deal.ownerId }, data: { assigneeId: newOwnerId } });
  await db.sequenceEnrollment.updateMany({ where: { dealId, status: "ACTIVE" }, data: { ownerId: newOwnerId } });
  await db.contact.updateMany({ where: { id: deal.contactId, OR: [{ ownerId: null }, { ownerId: deal.ownerId }] }, data: { ownerId: newOwnerId } });
  await logActivity({
    type: "OWNER_CHANGED",
    title: `Commercial : ${deal.owner.firstName} ${deal.owner.lastName} → ${newOwner.firstName} ${newOwner.lastName}`,
    contactId: deal.contactId,
    companyId: deal.companyId,
    dealId,
    userId: byUserId,
  });
  if (byUserId !== newOwnerId) {
    await notify({
      userId: newOwnerId,
      type: "LEAD_ASSIGNED",
      title: `Dossier attribué : ${deal.title}`,
      link: `/pipeline/${dealId}`,
    });
  }
  return updated;
}

// ───────────── Dossiers bloqués ─────────────

export { BLOCKED_REASON_LABELS, type BlockedReason } from "./labels";

export function blockedReasons(
  deal: { stage: DealStage; nextActionAt: Date | null; lastActivityAt: Date | null; createdAt: Date; stageEnteredAt: Date },
  settings: PipelineSettings,
  now: Date = new Date(),
): BlockedReason[] {
  if (isClosedStage(deal.stage)) return [];
  const reasons: BlockedReason[] = [];
  if (!deal.nextActionAt) reasons.push("NO_NEXT_ACTION");
  else if (deal.nextActionAt.getTime() < now.getTime() - 24 * 3600 * 1000) reasons.push("OVERDUE_ACTION");
  const last = deal.lastActivityAt ?? deal.createdAt;
  if (now.getTime() - last.getTime() > settings.staleDays * 86_400_000) reasons.push("STALE");
  const maxDays = settings.stageMaxDays[deal.stage];
  if (maxDays && now.getTime() - deal.stageEnteredAt.getTime() > maxDays * 86_400_000) reasons.push("STAGE_TOO_LONG");
  return reasons;
}

/** Condition Prisma approximative pour pré-filtrer les dossiers bloqués (affinée par blockedReasons). */
export async function blockedDealsWhere(): Promise<Prisma.DealWhereInput> {
  const settings = await getSettings("pipeline");
  const now = Date.now();
  const staleBefore = new Date(now - settings.staleDays * 86_400_000);
  const or: Prisma.DealWhereInput[] = [
    { nextActionAt: null },
    { nextActionAt: { lt: new Date(now - 24 * 3600 * 1000) } },
    { lastActivityAt: { lt: staleBefore } },
    { lastActivityAt: null, createdAt: { lt: staleBefore } },
  ];
  for (const [stage, days] of Object.entries(settings.stageMaxDays)) {
    if (days) or.push({ stage: stage as DealStage, stageEnteredAt: { lt: new Date(now - days * 86_400_000) } });
  }
  return { stage: { notIn: ["WON", "LOST"] }, archivedAt: null, OR: or };
}
