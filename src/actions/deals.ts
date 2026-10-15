"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { changeDealStage, createDeal, reassignDeal, refreshDealNextAction } from "@/lib/deals";
import { createTask, NEXT_ACTION_TO_TASK_TYPE } from "@/lib/tasks";
import { logActivity } from "@/lib/activity";
import { contactDisplayName, NEXT_ACTION_LABELS, STAGE_LABELS } from "@/lib/labels";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalNumber, optionalInt, optionalString } from "@/lib/validation";
import { getSettings } from "@/lib/settings";

const STAGES = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"] as const;
const NEXT_TYPES = ["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "DEMO", "TASK"] as const;

const nextActionSchema = z.object({
  type: z.enum(NEXT_TYPES),
  label: optionalString,
  dueAt: z.string().min(1, "Date de la prochaine action obligatoire"),
});

const dealSchema = z.object({
  title: z.string().trim().min(1, "Titre obligatoire"),
  contactId: z.string().min(1, "Contact obligatoire"),
  ownerId: z.string().min(1, "Commercial responsable obligatoire"),
  stage: z.enum(STAGES).default("PROSPECT"),
  amount: optionalNumber,
  quantity: optionalInt,
  expectedCloseAt: optionalString,
  source: z
    .enum(["MANUAL", "WEBSITE_FORM", "BOOKING", "SHOPIFY", "EMAIL", "IMPORT", "REFERRAL", "EVENT", "PHONE", "LINKEDIN", "OTHER"])
    .default("MANUAL"),
  notes: optionalString,
  segmentId: optionalString,
});

export async function createDealAction(input: z.input<typeof dealSchema> & { nextAction?: z.input<typeof nextActionSchema> | null }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = dealSchema.parse(input);
    const settings = await getSettings("pipeline");
    let nextAction = null;
    if (input.nextAction) {
      const n = nextActionSchema.parse(input.nextAction);
      const due = parseDateTimeLocal(n.dueAt, user.timezone);
      if (!due) throw new UserError("Date de prochaine action invalide.");
      nextAction = { type: n.type, label: n.label, dueAt: due, hasTime: n.dueAt.includes("T") };
    } else if (settings.requireNextAction && data.stage !== "WON" && data.stage !== "LOST") {
      throw new UserError("Chaque dossier doit avoir une prochaine action datée.");
    }
    const deal = await createDeal({
      title: data.title,
      contactId: data.contactId,
      ownerId: data.ownerId,
      createdById: user.id,
      stage: data.stage,
      amount: data.amount,
      quantity: data.quantity,
      expectedCloseAt: parseDateTimeLocal(data.expectedCloseAt, user.timezone),
      source: data.source,
      notes: data.notes,
      segmentId: data.segmentId,
      nextAction,
    });
    if (data.ownerId !== user.id) {
      const { notify } = await import("@/lib/notifications");
      await notify({ userId: data.ownerId, type: "LEAD_ASSIGNED", title: `Nouveau dossier attribué : ${deal.title}`, link: `/pipeline/${deal.id}` });
    }
    return { id: deal.id };
  }, "Dossier créé");
}

const updateSchema = dealSchema.omit({ stage: true, contactId: true });

export async function updateDealAction(id: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, deal.ownerId);
    const data = updateSchema.parse(input);
    await db.deal.update({
      where: { id },
      data: {
        title: data.title,
        amount: data.amount,
        quantity: data.quantity,
        expectedCloseAt: parseDateTimeLocal(data.expectedCloseAt, user.timezone),
        source: data.source,
        notes: data.notes,
        segmentId: data.segmentId,
      },
    });
    if (data.ownerId !== deal.ownerId) await reassignDeal(id, data.ownerId, user.id);
  }, "Dossier mis à jour");
}

export async function moveDealStageAction(
  id: string,
  input: {
    stage: (typeof STAGES)[number];
    lostReasonId?: string | null;
    lostReasonDetail?: string | null;
    note?: string | null;
    nextAction?: z.input<typeof nextActionSchema> | null;
    amount?: string | number | null;
    /** Refus : date à laquelle recontacter le contact (relance sur sa fiche) */
    revisitAt?: string | null;
  },
): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id }, include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } });
    await assertCanEdit(user, deal.ownerId);
    const stage = z.enum(STAGES).parse(input.stage);
    if (stage === "LOST" && !input.lostReasonId) throw new UserError("Indiquez le motif du refus.");
    const amount = input.amount !== undefined && input.amount !== null && input.amount !== "" ? Number(String(input.amount).replace(",", ".")) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new UserError("Montant invalide.");
    // Validation avant tout changement : pas d'étape modifiée si la prochaine action est incorrecte
    const closed = stage === "WON" || stage === "LOST";
    const next = input.nextAction && !closed ? nextActionSchema.parse(input.nextAction) : null;
    const due = next ? parseDateTimeLocal(next.dueAt, user.timezone) : null;
    if (next && !due) throw new UserError("Date de la prochaine action invalide.");
    const revisit = stage === "LOST" && input.revisitAt ? parseDateTimeLocal(input.revisitAt, user.timezone) : null;
    if (stage === "LOST" && input.revisitAt && !revisit) throw new UserError("Date de relance invalide.");

    await changeDealStage(id, stage, { userId: user.id, lostReasonId: input.lostReasonId ?? null, lostReasonDetail: input.lostReasonDetail ?? null, note: input.note ?? null, amount });
    if (next && due) {
      await createTask({
        title: next.label || `${NEXT_ACTION_LABELS[next.type]} — ${contactDisplayName(deal.contact)}`,
        type: NEXT_ACTION_TO_TASK_TYPE[next.type],
        dueAt: due,
        hasTime: next.dueAt.includes("T"),
        assigneeId: deal.ownerId,
        createdById: user.id,
        dealId: id,
      });
    }
    if (revisit) {
      const reason = input.lostReasonId ? await db.lostReason.findUnique({ where: { id: input.lostReasonId }, select: { label: true } }) : null;
      await createTask({
        title: `Recontacter ${contactDisplayName(deal.contact)} (dossier refusé${reason ? ` : ${reason.label.toLowerCase()}` : ""})`,
        description: [`Dossier « ${deal.title} » refusé.`, input.lostReasonDetail].filter(Boolean).join("\n"),
        type: "FOLLOW_UP",
        dueAt: revisit,
        hasTime: input.revisitAt!.includes("T"),
        assigneeId: deal.ownerId,
        createdById: user.id,
        contactId: deal.contactId,
      });
    }
    return undefined;
  }, `Dossier passé en « ${STAGE_LABELS[input.stage]} »`);
}

export async function setNextActionAction(dealId: string, input: z.input<typeof nextActionSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } });
    await assertCanEdit(user, deal.ownerId);
    const n = nextActionSchema.parse(input);
    const due = parseDateTimeLocal(n.dueAt, user.timezone);
    if (!due) throw new UserError("Date invalide.");
    await createTask({
      title: n.label || `${NEXT_ACTION_LABELS[n.type]} — ${contactDisplayName(deal.contact)}`,
      type: NEXT_ACTION_TO_TASK_TYPE[n.type],
      dueAt: due,
      hasTime: n.dueAt.includes("T"),
      assigneeId: deal.ownerId,
      createdById: user.id,
      dealId,
    });
  }, "Prochaine action planifiée");
}

export async function reassignDealAction(dealId: string, ownerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    await assertCanEdit(user, deal.ownerId);
    await reassignDeal(dealId, ownerId, user.id);
  }, "Commercial mis à jour");
}

export async function archiveDealAction(dealId: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    await assertCanEdit(user, deal.ownerId);
    await db.deal.update({ where: { id: dealId }, data: { archivedAt: archived ? new Date() : null } });
    if (archived) {
      const { stopEnrollment } = await import("@/lib/sequences/engine");
      const enrollments = await db.sequenceEnrollment.findMany({ where: { dealId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } });
      for (const e of enrollments) await stopEnrollment(e.id, "MANUAL");
    }
    await logActivity({ type: "SYSTEM", title: archived ? "Dossier archivé" : "Dossier restauré", dealId, contactId: deal.contactId, userId: user.id });
    await refreshDealNextAction(dealId);
  }, archived ? "Dossier archivé" : "Dossier restauré");
}

/** Dossiers d'un contact (sélecteurs). */
export async function dealsForContactAction(contactId: string) {
  await assertUser();
  return db.deal.findMany({
    where: { contactId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, stage: true },
  });
}
