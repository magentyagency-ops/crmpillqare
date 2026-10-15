import type { Prisma } from "@/generated/prisma/client";
import { db, isUniqueViolation } from "./db";

/**
 * File de tâches de fond persistée en base (envois d'emails, synchronisations, IA…).
 * Exécutée par le planificateur (voir lib/scheduler). Réessais avec backoff exponentiel.
 */

export type JobRow = {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
};

export async function enqueueJob(
  type: string,
  payload: Prisma.InputJsonValue,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
) {
  try {
    return await db.job.create({
      data: {
        type,
        payload,
        runAt: opts.runAt ?? new Date(),
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? 5,
      },
    });
  } catch (error) {
    if (opts.dedupeKey && isUniqueViolation(error)) return null; // déjà planifié / déjà fait
    throw error;
  }
}

/** Réserve atomiquement jusqu'à `limit` tâches prêtes (sûr en multi-instances). */
export async function claimJobs(limit = 20): Promise<JobRow[]> {
  // Libère les tâches bloquées (processus interrompu)
  await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
    data: { status: "PENDING", lockedAt: null },
  });
  return db.$queryRaw<JobRow[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = (NOW() AT TIME ZONE 'UTC'), "attempts" = "attempts" + 1, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"`;
}

export async function completeJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "DONE", lockedAt: null, lastError: null } });
}

export async function failJob(job: JobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const final = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** (job.attempts - 1));
  await db.job.update({
    where: { id: job.id },
    data: {
      status: final ? "FAILED" : "PENDING",
      lockedAt: null,
      lastError: message.slice(0, 4000),
      runAt: final ? undefined : new Date(Date.now() + backoffMs),
    },
  });
  return final;
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export async function processJobs(handlers: Record<string, JobHandler>, limit = 20): Promise<{ done: number; failed: number }> {
  const jobs = await claimJobs(limit);
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    const handler = handlers[job.type];
    if (!handler) {
      await failJob({ ...job, attempts: job.maxAttempts }, new Error(`Type de tâche inconnu : ${job.type}`));
      failed++;
      continue;
    }
    try {
      await handler((job.payload ?? {}) as Record<string, unknown>);
      await completeJob(job.id);
      done++;
    } catch (error) {
      console.error(`[jobs] ${job.type} (${job.id}) a échoué :`, error instanceof Error ? error.message : error);
      await failJob(job, error);
      failed++;
    }
  }
  return { done, failed };
}

/** Nettoyage des tâches terminées anciennes (conserve les clés de dédoublonnage récentes). */
export async function purgeOldJobs(days = 30) {
  const res = await db.job.deleteMany({
    where: { status: { in: ["DONE", "FAILED"] }, updatedAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return res.count;
}
