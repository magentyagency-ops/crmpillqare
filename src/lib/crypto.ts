import crypto from "node:crypto";
import { env } from "./env";

/**
 * Chiffrement AES-256-GCM des secrets stockés en base (jetons OAuth, mots de passe IMAP/SMTP,
 * secrets Shopify). Format : v1:<iv b64>:<tag b64>:<données b64>
 */

let cachedKey: Buffer | null = null;
let warned = false;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.encryptionKey;
  if (!raw) {
    if (env.isProduction) {
      throw new Error("ENCRYPTION_KEY est obligatoire en production (32 octets en base64 ou hex).");
    }
    if (!warned) {
      console.warn("[crypto] ENCRYPTION_KEY absent — clé de développement dérivée utilisée. Ne pas utiliser en production.");
      warned = true;
    }
    cachedKey = crypto.createHash("sha256").update("pillqare-crm-dev-key").digest();
    return cachedKey;
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    // Dérive une clé de 32 octets à partir d'une phrase secrète
    key = crypto.createHash("sha256").update(raw).digest();
  }
  cachedKey = key;
  return key;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("Format de donnée chiffrée invalide.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function encryptOptional(plain: string | null | undefined): string | null {
  return plain ? encrypt(plain) : null;
}

export function decryptOptional(payload: string | null | undefined): string | null {
  if (!payload) return null;
  return decrypt(payload);
}

/** Jeton aléatoire URL-safe */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Base64(secret: string, body: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

export function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Comparaison à temps constant */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Signature courte pour les paramètres « state » OAuth */
export function signState(data: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...data, t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", getKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string, maxAgeMs = 15 * 60 * 1000): T | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getKey()).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { t: number };
    if (typeof data.t !== "number" || Date.now() - data.t > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}
