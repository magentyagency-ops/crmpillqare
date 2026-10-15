import { db } from "./db";
import { endOfDayTz, startOfDayTz } from "./dates";
import { blockedReasons, type BlockedReason } from "./deals";
import { getSettings } from "./settings";

const contactSelect = { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { id: true, name: true } } } as const;

/**
 * Planning du jour d'un commercial : RDV, appels, relances, tâches, réponses à traiter,
 * comptes rendus à valider, dossiers à débloquer, nouveaux leads.
 */
export async function getDailyPlan(userId: string, date: Date = new Date()) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const tz = user.timezone;
  const dayStart = startOfDayTz(date, tz);
  const dayEnd = endOfDayTz(date, tz);
  const now = new Date();

  const [meetings, tasks, approvals, autoToday, replies, reports, ownedOpenDeals, newLeads, pipelineSettings] = await Promise.all([
    db.meeting.findMany({
      where: { organizerId: userId, startAt: { gte: dayStart, lte: dayEnd }, status: { not: "CANCELLED" } },
      orderBy: { startAt: "asc" },
      include: {
        contact: { select: contactSelect },
        deal: { select: { id: true, title: true, stage: true } },
        aiSessions: { select: { id: true, status: true } },
      },
    }),
    db.task.findMany({
      where: { assigneeId: userId, status: "OPEN", OR: [{ dueAt: { lte: dayEnd } }, { dueAt: null }] },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      include: {
        contact: { select: contactSelect },
        deal: { select: { id: true, title: true, stage: true } },
        meeting: { select: { id: true, title: true } },
        order: { select: { id: true, number: true } },
      },
      take: 200,
    }),
    db.sequenceStepRun.findMany({
      where: { status: "PENDING_APPROVAL", enrollment: { ownerId: userId, status: "ACTIVE" } },
      orderBy: { scheduledAt: "asc" },
      include: { step: { select: { subject: true } }, enrollment: { include: { contact: { select: contactSelect }, sequence: { select: { name: true } } } } },
      take: 50,
    }),
    db.sequenceStepRun.count({
      where: { status: "SCHEDULED", type: "EMAIL", scheduledAt: { gte: now, lte: dayEnd }, enrollment: { ownerId: userId, status: "ACTIVE" } },
    }),
    db.emailMessage.findMany({
      where: {
        direction: "INBOUND",
        handledAt: null,
        contactId: { not: null },
        sentAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
        OR: [{ userId }, { contact: { ownerId: userId } }],
      },
      orderBy: { sentAt: "desc" },
      include: { contact: { select: contactSelect } },
      take: 30,
    }),
    db.aiSession.findMany({
      where: { userId, status: { in: ["READY", "FAILED"] } },
      orderBy: { updatedAt: "desc" },
      include: { contact: { select: contactSelect } },
      take: 20,
    }),
    db.deal.findMany({
      where: { ownerId: userId, stage: { notIn: ["WON", "LOST"] }, archivedAt: null },
      include: { contact: { select: contactSelect } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    db.deal.findMany({
      where: { ownerId: userId, stage: "PROSPECT", archivedAt: null, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, contact: { lastContactedAt: null } },
      include: { contact: { select: contactSelect } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getSettings("pipeline"),
  ]);

  // Dédoublonne les emails d'un même fil (on garde le plus récent)
  const seenThreads = new Set<string>();
  const uniqueReplies = replies.filter((r) => {
    if (seenThreads.has(r.threadKey)) return false;
    seenThreads.add(r.threadKey);
    return true;
  });

  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < dayStart);
  const today = tasks.filter((t) => t.dueAt && t.dueAt >= dayStart);
  const undated = tasks.filter((t) => !t.dueAt).slice(0, 20);
  const isCall = (t: (typeof tasks)[number]) => t.type === "CALL" || t.type === "CALLBACK";
  const isFollowUp = (t: (typeof tasks)[number]) => t.type === "FOLLOW_UP" || t.type === "EMAIL";

  const attention: { deal: (typeof ownedOpenDeals)[number]; reasons: BlockedReason[] }[] = [];
  for (const d of ownedOpenDeals) {
    const reasons = blockedReasons(d, pipelineSettings, now);
    if (reasons.includes("NO_NEXT_ACTION") || reasons.includes("OVERDUE_ACTION") || reasons.includes("STALE")) attention.push({ deal: d, reasons });
  }

  const dated = [...overdue, ...today];
  return {
    tz,
    dayStart,
    dayEnd,
    meetings,
    calls: dated.filter(isCall),
    followUps: dated.filter(isFollowUp),
    otherTasks: dated.filter((t) => !isCall(t) && !isFollowUp(t)),
    undatedTasks: undated,
    overdueCount: overdue.length,
    approvals,
    autoEmailsToday: autoToday,
    replies: uniqueReplies,
    reports,
    attention: attention.slice(0, 30),
    newLeads,
    counts: {
      meetings: meetings.filter((m) => m.status !== "CANCELLED").length,
      calls: dated.filter(isCall).length,
      followUps: dated.filter(isFollowUp).length + approvals.length,
      tasks: dated.length,
      replies: uniqueReplies.length,
      reports: reports.length,
      attention: attention.length,
    },
  };
}

export type DailyPlan = Awaited<ReturnType<typeof getDailyPlan>>;
