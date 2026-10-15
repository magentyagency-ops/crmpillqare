import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { env } from "./env";
import { blockedReasons } from "./deals";
import { getSettings } from "./settings";
import { toNumber } from "./format";
import { dayKey } from "./dates";
import { OPEN_STAGES, STAGE_PROBABILITY } from "./labels";
import type { DealStage } from "@/generated/prisma/enums";

export type Period = { from: Date; to: Date };

export type SalesRow = {
  userId: string;
  name: string;
  color: string;
  calls: number;
  callsReached: number;
  emailsSent: number;
  meetingsHeld: number;
  meetingsScheduled: number;
  followUpsDone: number;
  quotesSent: number;
  quotesAmount: number;
  quotesAccepted: number;
  dealsCreated: number;
  dealsWon: number;
  dealsLost: number;
  revenue: number;
  openDeals: number;
  pipelineValue: number;
  weightedPipeline: number;
  blockedDeals: number;
  overdueTasks: number;
  winRate: number | null;
};

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T, valueKey?: keyof T): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key]);
    const v = valueKey ? toNumber(r[valueKey] as never) : 1;
    m.set(k, (m.get(k) ?? 0) + v);
  }
  return m;
}

/** Indicateurs par commercial sur une période (appels, RDV, relances, devis, ventes, CA, blocages). */
export async function getSalesMetrics(period: Period, userIds?: string[]): Promise<SalesRow[]> {
  const users = await db.user.findMany({
    where: { active: true, ...(userIds ? { id: { in: userIds } } : { role: { in: ["SALES", "MANAGER", "ADMIN"] } }) },
    select: { id: true, firstName: true, lastName: true, color: true, role: true },
    orderBy: { firstName: "asc" },
  });
  const ids = users.map((u) => u.id);
  const range = { gte: period.from, lte: period.to };
  const now = new Date();

  const [calls, emails, meetings, stepRuns, followTasks, quotes, dealsCreated, won, lost, openDeals, overdueTasks, pipelineSettings] = await Promise.all([
    db.activity.findMany({ where: { type: "CALL", userId: { in: ids }, occurredAt: range }, select: { userId: true, callOutcome: true } }),
    db.emailMessage.groupBy({ by: ["userId"], where: { direction: "OUTBOUND", status: "SENT", userId: { in: ids }, sentAt: range }, _count: { _all: true } }),
    // RDV réalisés sur la période, et RDV obtenus (pris pendant la période, quelle que soit leur date)
    db.meeting.findMany({
      where: { organizerId: { in: ids }, OR: [{ startAt: range, status: "COMPLETED" }, { createdAt: range, status: { not: "CANCELLED" } }] },
      select: { organizerId: true, status: true, startAt: true, createdAt: true },
    }),
    db.sequenceStepRun.findMany({
      where: { status: { in: ["SENT", "DONE"] }, executedAt: range, enrollment: { ownerId: { in: ids } } },
      select: { enrollment: { select: { ownerId: true } } },
    }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "DONE", type: { in: ["FOLLOW_UP"] }, stepRunId: null, completedAt: range }, _count: { _all: true } }),
    db.quote.findMany({ where: { ownerId: { in: ids }, sentAt: range }, select: { ownerId: true, totalHT: true, status: true } }),
    db.deal.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, createdAt: range }, _count: { _all: true } }),
    db.deal.findMany({ where: { ownerId: { in: ids }, stage: "WON", wonAt: range }, select: { ownerId: true, amount: true } }),
    db.deal.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, stage: "LOST", lostAt: range }, _count: { _all: true } }),
    db.deal.findMany({
      where: { ownerId: { in: ids }, stage: { notIn: ["WON", "LOST"] }, archivedAt: null },
      select: { ownerId: true, amount: true, stage: true, probability: true, nextActionAt: true, lastActivityAt: true, createdAt: true, stageEnteredAt: true },
    }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "OPEN", dueAt: { lt: new Date(now.getTime() - 3600_000) } }, _count: { _all: true } }),
    getSettings("pipeline"),
  ]);

  const callsBy = countBy(calls, "userId");
  const reachedBy = countBy(calls.filter((c) => c.callOutcome === "REACHED"), "userId");
  const emailsBy = new Map(emails.map((e) => [String(e.userId), e._count._all]));
  const inRange = (d: Date) => d >= period.from && d <= period.to;
  const heldBy = countBy(meetings.filter((m) => m.status === "COMPLETED" && inRange(m.startAt)), "organizerId");
  const scheduledBy = countBy(meetings.filter((m) => inRange(m.createdAt) && m.status !== "CANCELLED"), "organizerId");
  const stepsBy = countBy(stepRuns.map((s) => ({ ownerId: s.enrollment.ownerId })), "ownerId");
  const followTasksBy = new Map(followTasks.map((t) => [t.assigneeId, t._count._all]));
  const quotesBy = countBy(quotes, "ownerId");
  const quotesAmountBy = countBy(quotes, "ownerId", "totalHT");
  const quotesAcceptedBy = countBy(quotes.filter((q) => q.status === "ACCEPTED"), "ownerId");
  const createdBy = new Map(dealsCreated.map((d) => [d.ownerId, d._count._all]));
  const wonBy = countBy(won, "ownerId");
  const revenueBy = countBy(won, "ownerId", "amount");
  const lostBy = new Map(lost.map((d) => [d.ownerId, d._count._all]));
  const overdueBy = new Map(overdueTasks.map((t) => [t.assigneeId, t._count._all]));

  return users.map((u) => {
    const open = openDeals.filter((d) => d.ownerId === u.id);
    const wonCount = wonBy.get(u.id) ?? 0;
    const lostCount = lostBy.get(u.id) ?? 0;
    return {
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      color: u.color,
      calls: callsBy.get(u.id) ?? 0,
      callsReached: reachedBy.get(u.id) ?? 0,
      emailsSent: emailsBy.get(u.id) ?? 0,
      meetingsHeld: heldBy.get(u.id) ?? 0,
      meetingsScheduled: scheduledBy.get(u.id) ?? 0,
      followUpsDone: (stepsBy.get(u.id) ?? 0) + (followTasksBy.get(u.id) ?? 0),
      quotesSent: quotesBy.get(u.id) ?? 0,
      quotesAmount: quotesAmountBy.get(u.id) ?? 0,
      quotesAccepted: quotesAcceptedBy.get(u.id) ?? 0,
      dealsCreated: createdBy.get(u.id) ?? 0,
      dealsWon: wonCount,
      dealsLost: lostCount,
      revenue: revenueBy.get(u.id) ?? 0,
      openDeals: open.length,
      pipelineValue: open.reduce((a, d) => a + toNumber(d.amount), 0),
      weightedPipeline: open.reduce((a, d) => a + (toNumber(d.amount) * (d.probability ?? STAGE_PROBABILITY[d.stage])) / 100, 0),
      blockedDeals: open.filter((d) => blockedReasons(d, pipelineSettings, now).length > 0).length,
      overdueTasks: overdueBy.get(u.id) ?? 0,
      winRate: wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null,
    };
  });
}

export function totals(rows: SalesRow[]): SalesRow {
  const sum = (k: keyof SalesRow) => rows.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  const won = sum("dealsWon");
  const lost = sum("dealsLost");
  return {
    userId: "total",
    name: "Équipe",
    color: "#12295A",
    calls: sum("calls"),
    callsReached: sum("callsReached"),
    emailsSent: sum("emailsSent"),
    meetingsHeld: sum("meetingsHeld"),
    meetingsScheduled: sum("meetingsScheduled"),
    followUpsDone: sum("followUpsDone"),
    quotesSent: sum("quotesSent"),
    quotesAmount: sum("quotesAmount"),
    quotesAccepted: sum("quotesAccepted"),
    dealsCreated: sum("dealsCreated"),
    dealsWon: won,
    dealsLost: lost,
    revenue: sum("revenue"),
    openDeals: sum("openDeals"),
    pipelineValue: sum("pipelineValue"),
    weightedPipeline: sum("weightedPipeline"),
    blockedDeals: sum("blockedDeals"),
    overdueTasks: sum("overdueTasks"),
    winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
  };
}

/** CA signé (dossiers) et CA boutique (Shopify) par mois, sur 12 mois. */
export async function revenueByMonth(userIds?: string[]) {
  const tz = env.timezone;
  const from = new Date(Date.now() - 365 * 86_400_000);
  const ownerFilter = userIds?.length ? db.$queryRaw<{ month: string; total: number }[]>`
      SELECT to_char(date_trunc('month', ("wonAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS month, COALESCE(SUM("amount"), 0)::float AS total
      FROM "Deal" WHERE "stage" = 'WON' AND "wonAt" >= ${from} AND "ownerId" = ANY(${userIds})
      GROUP BY 1 ORDER BY 1`
    : db.$queryRaw<{ month: string; total: number }[]>`
      SELECT to_char(date_trunc('month', ("wonAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS month, COALESCE(SUM("amount"), 0)::float AS total
      FROM "Deal" WHERE "stage" = 'WON' AND "wonAt" >= ${from}
      GROUP BY 1 ORDER BY 1`;
  const [deals, shop] = await Promise.all([
    ownerFilter,
    db.$queryRaw<{ month: string; total: number }[]>`
      SELECT to_char(date_trunc('month', ("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS month, COALESCE(SUM("total" - "totalTax"), 0)::float AS total
      FROM "Order" WHERE "cancelledAt" IS NULL AND "processedAt" >= ${from}
      GROUP BY 1 ORDER BY 1`,
  ]);
  // Mois calendaires dans le fuseau de l'entreprise (cohérent avec le regroupement SQL)
  const [year, month] = dayKey(new Date(), tz).split("-").map(Number) as [number, number];
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const dealMap = new Map(deals.map((r) => [r.month, Number(r.total)]));
  const shopMap = new Map(shop.map((r) => [r.month, Number(r.total)]));
  return months.map((m) => ({ month: m, signe: Math.round(dealMap.get(m) ?? 0), boutique: Math.round(shopMap.get(m) ?? 0) }));
}

/** Activité hebdomadaire (appels, emails, RDV) sur 8 semaines. */
export async function activityByWeek(userIds?: string[]) {
  const tz = env.timezone;
  const from = new Date(Date.now() - 8 * 7 * 86_400_000);
  const userFilter = userIds?.length ? userIds : null;
  const rows = await db.$queryRaw<{ week: string; type: string; n: number }[]>`
    SELECT to_char(date_trunc('week', ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS week, "type"::text AS type, COUNT(*)::int AS n
    FROM "Activity"
    WHERE "occurredAt" >= ${from} AND "type" IN ('CALL', 'EMAIL_SENT', 'MEETING')
      AND (${userFilter}::text[] IS NULL OR "userId" = ANY(${userFilter}::text[]))
    GROUP BY 1, 2 ORDER BY 1`;
  const weeks = new Map<string, { week: string; appels: number; emails: number; rdv: number }>();
  for (const r of rows) {
    const w = weeks.get(r.week) ?? { week: r.week, appels: 0, emails: 0, rdv: 0 };
    if (r.type === "CALL") w.appels += Number(r.n);
    if (r.type === "EMAIL_SENT") w.emails += Number(r.n);
    if (r.type === "MEETING") w.rdv += Number(r.n);
    weeks.set(r.week, w);
  }
  return [...weeks.values()];
}

/** Entonnoir actuel : dossiers ouverts par étape. */
export async function pipelineFunnel(where: Prisma.DealWhereInput = {}) {
  const rows = await db.deal.groupBy({
    by: ["stage"],
    where: { ...where, stage: { in: OPEN_STAGES }, archivedAt: null },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return OPEN_STAGES.map((stage: DealStage) => {
    const r = rows.find((x) => x.stage === stage);
    return { stage, count: r?._count._all ?? 0, amount: toNumber(r?._sum.amount ?? 0) };
  });
}

export async function lostReasonsBreakdown(period: Period, where: Prisma.DealWhereInput = {}) {
  const rows = await db.deal.groupBy({
    by: ["lostReasonId"],
    where: { ...where, stage: "LOST", lostAt: { gte: period.from, lte: period.to } },
    _count: { _all: true },
  });
  const reasons = await db.lostReason.findMany();
  return rows
    .map((r) => ({ label: reasons.find((x) => x.id === r.lostReasonId)?.label ?? "Non renseigné", count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

export async function leadSources(period: Period) {
  const rows = await db.contact.groupBy({ by: ["source"], where: { createdAt: { gte: period.from, lte: period.to } }, _count: { _all: true } });
  return rows.map((r) => ({ source: r.source, count: r._count._all })).sort((a, b) => b.count - a.count);
}

export async function satisfactionStats(period: Period) {
  const agg = await db.order.aggregate({
    where: { satisfactionAt: { gte: period.from, lte: period.to }, satisfactionScore: { not: null } },
    _avg: { satisfactionScore: true },
    _count: { _all: true },
  });
  return { average: agg._avg.satisfactionScore, count: agg._count._all };
}
