import type { ActivityType, CallDirection, CallOutcome } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "./db";

export type LogActivityInput = {
  type: ActivityType;
  title: string;
  body?: string | null;
  occurredAt?: Date;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  userId?: string | null;
  callDirection?: CallDirection | null;
  callOutcome?: CallOutcome | null;
  callDurationSec?: number | null;
  meetingId?: string | null;
  emailMessageId?: string | null;
  quoteId?: string | null;
  orderId?: string | null;
  trialId?: string | null;
  aiSessionId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/** Types d'activité qui comptent comme un contact réel avec le prospect (dossier « vivant »). */
const ENGAGEMENT_TYPES = new Set<ActivityType>([
  "CALL",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "MEETING",
  "MEETING_BOOKED",
  "MEETING_REPORT",
  "NOTE",
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "QUOTE_REFUSED",
  "QUOTE_VIEWED",
  "ORDER_PLACED",
  "FORM_SUBMITTED",
  "TRIAL_EVENT",
  "TASK_COMPLETED",
]);

/**
 * Enregistre un événement dans l'historique (fiche contact / compte / dossier) et met à jour
 * les dates de dernière activité.
 */
export async function logActivity(input: LogActivityInput, tx: Tx = db) {
  const occurredAt = input.occurredAt ?? new Date();
  let companyId = input.companyId ?? null;
  if (!companyId && input.contactId) {
    const c = await tx.contact.findUnique({ where: { id: input.contactId }, select: { companyId: true } });
    companyId = c?.companyId ?? null;
  }
  const activity = await tx.activity.create({
    data: {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      occurredAt,
      contactId: input.contactId ?? null,
      companyId,
      dealId: input.dealId ?? null,
      userId: input.userId ?? null,
      callDirection: input.callDirection ?? null,
      callOutcome: input.callOutcome ?? null,
      callDurationSec: input.callDurationSec ?? null,
      meetingId: input.meetingId ?? null,
      emailMessageId: input.emailMessageId ?? null,
      quoteId: input.quoteId ?? null,
      orderId: input.orderId ?? null,
      trialId: input.trialId ?? null,
      aiSessionId: input.aiSessionId ?? null,
      metadata: input.metadata,
    },
  });

  if (ENGAGEMENT_TYPES.has(input.type)) {
    if (input.contactId) {
      await tx.contact.updateMany({
        where: { id: input.contactId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }] },
        data: { lastActivityAt: occurredAt },
      });
    }
    if (input.dealId) {
      await tx.deal.updateMany({
        where: { id: input.dealId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }] },
        data: { lastActivityAt: occurredAt },
      });
    }
  }
  return activity;
}
