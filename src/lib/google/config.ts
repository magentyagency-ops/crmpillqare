import { db } from "@/lib/db";
import { decryptOptional, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Identifiants de l'application Google (OAuth) : saisis par l'administrateur dans le CRM
 * (Paramètres → Email, agenda, Shopify), sinon lus dans GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 */

const KEY = "google.oauth";
const TTL_MS = 30_000;

export type GoogleCredentials = { clientId: string; clientSecret: string; source: "crm" | "env" };

let cache: { value: GoogleCredentials | null; expires: number } | null = null;

export async function getGoogleCredentials(): Promise<GoogleCredentials | null> {
  if (cache && cache.expires > Date.now()) return cache.value;
  const row = await db.setting.findUnique({ where: { key: KEY } });
  const stored = row?.value as { clientId?: string; clientSecretEnc?: string } | null;
  let value: GoogleCredentials | null = null;
  const secret = stored?.clientSecretEnc ? decryptOptional(stored.clientSecretEnc) : null;
  if (stored?.clientId && secret) value = { clientId: stored.clientId, clientSecret: secret, source: "crm" };
  else if (env.google.clientId && env.google.clientSecret) value = { clientId: env.google.clientId, clientSecret: env.google.clientSecret, source: "env" };
  cache = { value, expires: Date.now() + TTL_MS };
  return value;
}

export async function googleConfigured(): Promise<boolean> {
  return Boolean(await getGoogleCredentials());
}

export async function saveGoogleCredentials(clientId: string, clientSecret: string) {
  const value = { clientId: clientId.trim(), clientSecretEnc: encrypt(clientSecret.trim()) };
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
}

export async function clearGoogleCredentials() {
  await db.setting.deleteMany({ where: { key: KEY } });
  cache = null;
}
