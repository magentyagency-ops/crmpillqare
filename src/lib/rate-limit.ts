import { db } from "./db";

/**
 * Limitation de débit persistée en base (fonctionne en multi-instances).
 * Retourne false si la limite est dépassée sur la fenêtre.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${windowSec}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < (NOW() AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${windowSec}) ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= limit, count };
}

export async function resetRateLimit(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}

export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "local").split(",")[0]!.trim();
}
