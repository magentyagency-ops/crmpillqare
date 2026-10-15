import crypto from "node:crypto";
import { db } from "@/lib/db";
import { processJobs, enqueueJob, purgeOldJobs, type JobHandler } from "@/lib/jobs";
import { notify } from "@/lib/notifications";
import { formatTime } from "@/lib/dates";

/**
 * Planificateur : exécuté chaque minute (dans le serveur Next, via `npm run worker`,
 * ou via /api/cron/tick). Un bail en base garantit une seule exécution à la fois.
 */

const INSTANCE = crypto.randomBytes(6).toString("hex");
const LEASE_KEY = "scheduler.lease";
const STATE_KEY = "scheduler.state";
const LEASE_MS = 10 * 60_000;

async function acquireLease(): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MS).toISOString();
  const value = JSON.stringify({ holder: INSTANCE, until });
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (${LEASE_KEY}, ${value}::jsonb, (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE ("Setting"."value"->>'until')::timestamptz < NOW() OR "Setting"."value"->>'holder' = ${INSTANCE}
    RETURNING "key"`;
  return rows.length > 0;
}

async function releaseLease() {
  const value = JSON.stringify({ holder: null, until: new Date(0).toISOString() });
  await db.$executeRaw`
    UPDATE "Setting" SET "value" = ${value}::jsonb, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "key" = ${LEASE_KEY} AND "value"->>'holder' = ${INSTANCE}`;
}

// ───────────── Gestionnaires de tâches de fond ─────────────

const handlers: Record<string, JobHandler> = {
  "calendar.syncTask": async (p) => {
    const { syncTaskToGoogle } = await import("@/lib/google/calendar");
    await syncTaskToGoogle(String(p.taskId));
  },
  "calendar.pushMeeting": async (p) => {
    const { pushMeetingToGoogle } = await import("@/lib/google/calendar");
    await pushMeetingToGoogle(String(p.meetingId));
  },
  "calendar.sync": async (p) => {
    const account = await db.googleAccount.findUnique({ where: { id: String(p.accountId) } });
    if (!account || account.status === "DISCONNECTED") return;
    const { syncGoogleCalendar } = await import("@/lib/google/calendar");
    await syncGoogleCalendar(account);
  },
  "mailbox.sync": async (p) => {
    await syncMailbox(String(p.mailboxId));
  },
  "meeting.email": async (p) => {
    const { sendMeetingEmail } = await import("@/lib/meetings");
    await sendMeetingEmail(String(p.meetingId), p.kind as "confirmation");
  },
  "form.confirmation": async (p) => {
    const { sendFormConfirmation } = await import("@/lib/forms");
    await sendFormConfirmation(String(p.formId), String(p.contactId), (p.dealId as string | null) ?? null, String(p.ownerId));
  },
  "meet.fetchTranscript": async (p) => {
    const { importMeetTranscript } = await import("@/lib/ai/sessions");
    const meetingId = String(p.meetingId);
    const attempt = Number(p.attempt ?? 1);
    const res = await importMeetTranscript(meetingId);
    // La transcription Meet peut mettre jusqu'à ~1 h à être générée
    if (res === "pending" && attempt < 10) {
      await enqueueJob("meet.fetchTranscript", { meetingId, attempt: attempt + 1 }, { runAt: new Date(Date.now() + 15 * 60_000), dedupeKey: `meet:${meetingId}:${attempt + 1}` });
    }
  },
  "ai.finalize": async (p) => {
    const { finalizeSession } = await import("@/lib/ai/sessions");
    await finalizeSession(String(p.sessionId), { durationSec: (p.durationSec as number | null) ?? null, extraNotes: (p.extraNotes as string | null) ?? null });
  },
  "ai.generate": async (p) => {
    const { generateReport } = await import("@/lib/ai/report");
    await generateReport(String(p.sessionId));
  },
  "shopify.webhook": async (p) => {
    const { processShopifyWebhook } = await import("@/lib/shopify/webhooks");
    await processShopifyWebhook(String(p.webhookId), String(p.topic), p.payload);
  },
  "shopify.sync": async (p) => {
    const { getShopifyConnection } = await import("@/lib/shopify/client");
    const { syncShopify } = await import("@/lib/shopify/sync");
    const conn = await getShopifyConnection();
    if (conn && conn.status !== "DISCONNECTED") await syncShopify(conn, { full: Boolean(p.full) });
  },
  "digest.send": async (p) => {
    const { sendDigestNow } = await import("./digest");
    await sendDigestNow(String(p.userId));
  },
  "digest.weekly": async (p) => {
    const { sendWeeklySummary } = await import("./digest");
    await sendWeeklySummary(String(p.userId));
  },
};

export async function runJobsNow(limit = 20) {
  return processJobs(handlers, limit);
}

// ───────────── Tâches périodiques ─────────────

export async function syncMailbox(mailboxId: string) {
  const mailbox = await db.mailbox.findUnique({ where: { id: mailboxId }, include: { googleAccount: true } });
  if (!mailbox || !mailbox.syncEnabled || mailbox.status === "DISCONNECTED") return null;
  try {
    if (mailbox.provider === "GOOGLE") {
      const { syncGmailMailbox } = await import("@/lib/email/gmail");
      return await syncGmailMailbox(mailbox);
    }
    const { syncImapMailbox } = await import("@/lib/email/imap");
    return await syncImapMailbox(mailbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wasOk = mailbox.status === "ACTIVE";
    await db.mailbox.update({ where: { id: mailbox.id }, data: { status: "ERROR", lastError: message.slice(0, 2000) } });
    if (wasOk) {
      await notify({
        userId: mailbox.userId,
        type: "INTEGRATION_ERROR",
        title: `Synchronisation de ${mailbox.email} impossible`,
        body: message.slice(0, 300),
        link: "/parametres/integrations",
      });
    }
    throw error;
  }
}

async function syncAllMailboxes() {
  const boxes = await db.mailbox.findMany({ where: { syncEnabled: true, status: { not: "DISCONNECTED" } }, select: { id: true } });
  for (const b of boxes) {
    try {
      await syncMailbox(b.id);
    } catch (error) {
      console.error(`[scheduler] synchro mail ${b.id} :`, error instanceof Error ? error.message : error);
    }
  }
  return boxes.length;
}

async function syncAllCalendars() {
  const accounts = await db.googleAccount.findMany({ where: { status: { not: "DISCONNECTED" } } });
  const { syncGoogleCalendar } = await import("@/lib/google/calendar");
  for (const a of accounts) {
    try {
      await syncGoogleCalendar(a);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.googleAccount.update({ where: { id: a.id }, data: { lastError: message.slice(0, 2000) } }).catch(() => undefined);
      console.error(`[scheduler] synchro agenda ${a.email} :`, message);
    }
  }
  return accounts.length;
}

async function incrementalShopifySync() {
  const { getShopifyConnection } = await import("@/lib/shopify/client");
  const conn = await getShopifyConnection();
  if (!conn || conn.status === "DISCONNECTED") return 0;
  const { syncShopify } = await import("@/lib/shopify/sync");
  const report = await syncShopify(conn);
  return report.orders + report.customers;
}

/** Rappel in-app quelques minutes avant une tâche planifiée à heure fixe (appels…). */
async function processTaskReminders() {
  const now = Date.now();
  const due = await db.task.findMany({
    where: { status: "OPEN", hasTime: true, reminderSentAt: null, dueAt: { gt: new Date(now - 60_000), lte: new Date(now + 10 * 60_000) } },
    include: { assignee: { select: { timezone: true } } },
    take: 100,
  });
  for (const t of due) {
    const claimed = await db.task.updateMany({ where: { id: t.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (!claimed.count) continue;
    await notify({
      userId: t.assigneeId,
      type: "TASK_DUE",
      title: `${t.type === "CALL" || t.type === "CALLBACK" ? "📞" : "⏰"} ${formatTime(t.dueAt, t.assignee.timezone)} : ${t.title}`,
      link: `/taches?task=${t.id}`,
    });
  }
  return due.length;
}

/**
 * Sessions d'assistant IA bloquées (processus redémarré pendant l'analyse, onglet fermé sans
 * arrêter l'enregistrement) : la génération du compte rendu est relancée automatiquement.
 */
async function recoverStuckSessions() {
  const now = Date.now();
  const stuck = await db.aiSession.findMany({
    where: { status: { in: ["TRANSCRIBING", "ANALYZING"] }, updatedAt: { lt: new Date(now - 15 * 60_000) } },
    select: { id: true },
    take: 20,
  });
  const abandoned = await db.aiSession.findMany({
    where: {
      status: "RECORDING",
      segments: { some: { status: "DONE" }, none: { createdAt: { gt: new Date(now - 30 * 60_000) } } },
      createdAt: { lt: new Date(now - 30 * 60_000) },
    },
    select: { id: true },
    take: 20,
  });
  for (const s of [...stuck, ...abandoned]) {
    const hour = Math.floor(now / 3_600_000);
    await enqueueJob("ai.finalize", { sessionId: s.id }, { dedupeKey: `ai-recover:${s.id}:${hour}`, maxAttempts: 2 });
  }
  return stuck.length + abandoned.length;
}

async function cleanup() {
  const { purgeExpiredSessions } = await import("@/lib/auth/session");
  const now = Date.now();
  await purgeExpiredSessions();
  await purgeOldJobs(30);
  await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(now) } } });
  await db.notification.deleteMany({ where: { readAt: { lt: new Date(now - 90 * 86_400_000) } } });
  await db.shopifyWebhookEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 86_400_000) } } });
  await db.userToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 7 * 86_400_000) } } });
  return 1;
}

type Periodic = { name: string; everyMs: number; run: () => Promise<unknown> };

const PERIODIC: Periodic[] = [
  { name: "jobs", everyMs: 20_000, run: () => processJobs(handlers, 25) },
  {
    name: "sequences",
    // À chaque passage (30 s) : les séries à la minute partent à l'heure
    everyMs: 20_000,
    run: async () => (await import("@/lib/sequences/engine")).processDueSteps(),
  },
  {
    name: "meetingReminders",
    everyMs: 55_000,
    run: async () => (await import("@/lib/meetings")).processMeetingReminders(),
  },
  { name: "taskReminders", everyMs: 55_000, run: processTaskReminders },
  {
    name: "endedMeetings",
    everyMs: 4 * 60_000,
    run: async () => (await import("@/lib/meetings")).processEndedMeetings(),
  },
  { name: "aiRecovery", everyMs: 5 * 60_000, run: recoverStuckSessions },
  { name: "emailSync", everyMs: 2 * 60_000, run: syncAllMailboxes },
  { name: "calendarSync", everyMs: 5 * 60_000, run: syncAllCalendars },
  { name: "shopifySync", everyMs: 30 * 60_000, run: incrementalShopifySync },
  {
    name: "quotesExpire",
    everyMs: 60 * 60_000,
    run: async () => (await import("@/lib/quotes/service")).expireQuotes(),
  },
  {
    name: "digests",
    everyMs: 5 * 60_000,
    run: async () => (await import("./digest")).sendDailyDigests(),
  },
  { name: "cleanup", everyMs: 24 * 60 * 60_000, run: cleanup },
];

type SchedulerState = Record<string, { lastRun: string; ok: boolean; error?: string; ms?: number }>;

export async function getSchedulerState(): Promise<SchedulerState> {
  const row = await db.setting.findUnique({ where: { key: STATE_KEY } });
  return (row?.value as SchedulerState | undefined) ?? {};
}

export async function runSchedulerTick(opts: { only?: string[] } = {}): Promise<{ ran: string[]; skipped?: boolean }> {
  if (!(await acquireLease())) return { ran: [], skipped: true };
  const ran: string[] = [];
  try {
    const state = await getSchedulerState();
    const now = Date.now();
    for (const task of PERIODIC) {
      if (opts.only && !opts.only.includes(task.name)) continue;
      const last = state[task.name] ? new Date(state[task.name]!.lastRun).getTime() : 0;
      if (!opts.only && now - last < task.everyMs) continue;
      const started = Date.now();
      try {
        await task.run();
        state[task.name] = { lastRun: new Date().toISOString(), ok: true, ms: Date.now() - started };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[scheduler] ${task.name} :`, message);
        state[task.name] = { lastRun: new Date().toISOString(), ok: false, error: message.slice(0, 500), ms: Date.now() - started };
      }
      ran.push(task.name);
      // Prolonge le bail entre deux tâches longues
      await acquireLease();
    }
    await db.setting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value: state }, update: { value: state } });
  } finally {
    await releaseLease();
  }
  return { ran };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Démarre le planificateur dans le processus courant (serveur Next ou worker). */
export function startScheduler(intervalMs = 30_000) {
  const g = globalThis as unknown as { __pqScheduler?: boolean };
  if (g.__pqScheduler || timer) return;
  g.__pqScheduler = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick();
    } catch (error) {
      console.error("[scheduler] tick :", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000);
  timer = setInterval(tick, intervalMs);
  console.info(`[scheduler] démarré (instance ${INSTANCE}, toutes les ${intervalMs / 1000} s)`);
}
