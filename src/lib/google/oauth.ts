import type { GoogleAccount } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { notify } from "@/lib/notifications";
import { getGoogleCredentials } from "./config";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

export function googleRedirectUri() {
  return `${env.appUrl}/api/integrations/google/callback`;
}

async function requireCredentials() {
  const creds = await getGoogleCredentials();
  if (!creds) throw new Error("La connexion Google n'est pas encore activée : un administrateur doit la configurer dans Paramètres → Email, agenda, Shopify.");
  return creds;
}

/**
 * URL d'autorisation Google. `prompt` : « consent » (garantit un jeton de rafraîchissement) pour connecter le compte,
 * « select_account » pour une simple connexion au CRM d'un compte déjà autorisé.
 */
export async function googleAuthUrl(state: string, opts: { loginHint?: string; prompt?: "consent" | "select_account" } = {}) {
  const creds = await requireCredentials();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: opts.prompt ?? "consent",
    include_granted_scopes: "true",
    state,
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

export class GoogleAuthError extends Error {
  constructor(message: string, public readonly revoked = false) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const revoked = json.error === "invalid_grant";
    throw new GoogleAuthError(`Google OAuth : ${json.error_description ?? json.error ?? res.statusText}`, revoked);
  }
  return json as TokenResponse;
}

export async function exchangeGoogleCode(code: string) {
  const creds = await requireCredentials();
  return tokenRequest({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Impossible de lire le profil Google (${res.status}).`);
  return (await res.json()) as { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string };
}

/**
 * Enregistre le compte Google d'un utilisateur (jetons chiffrés), sa boîte Gmail par défaut,
 * et lance la synchronisation des emails et de l'agenda.
 */
export async function saveGoogleConnection(
  user: { id: string; firstName: string; lastName: string },
  tokens: TokenResponse,
  profile: { sub: string; email: string },
) {
  const { enqueueJob } = await import("@/lib/jobs");
  const email = profile.email.toLowerCase();
  const existing = await db.googleAccount.findUnique({ where: { userId: user.id } });
  const data = {
    googleUserId: profile.sub,
    email,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refreshTokenEnc ?? null),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
    status: "ACTIVE" as const,
    lastError: null,
    // Autre compte Google : la synchronisation de l'agenda repart de zéro
    ...(existing && existing.email !== email ? { calendarSyncToken: null } : {}),
  };
  const account = existing
    ? await db.googleAccount.update({ where: { id: existing.id }, data })
    : await db.googleAccount.create({ data: { ...data, userId: user.id } });

  if (tokens.scope.includes("gmail")) {
    await db.mailbox.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    const box = await db.mailbox.upsert({
      where: { userId_email: { userId: user.id, email } },
      create: { userId: user.id, provider: "GOOGLE", email, googleAccountId: account.id, displayName: `${user.firstName} ${user.lastName}`, isDefault: true },
      update: { provider: "GOOGLE", googleAccountId: account.id, status: "ACTIVE", lastError: null, isDefault: true },
    });
    await enqueueJob("mailbox.sync", { mailboxId: box.id });
  }
  await enqueueJob("calendar.sync", { accountId: account.id });
  return account;
}

/** Jeton d'accès valide (rafraîchi automatiquement si nécessaire). */
export async function getGoogleAccessToken(account: GoogleAccount): Promise<string> {
  if (account.status === "DISCONNECTED") throw new GoogleAuthError("Compte Google déconnecté : reconnectez-le dans Paramètres > Intégrations.", true);
  const expiresSoon = !account.tokenExpiresAt || account.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!expiresSoon) return decrypt(account.accessTokenEnc);
  if (!account.refreshTokenEnc) throw new GoogleAuthError("Jeton Google expiré sans jeton de rafraîchissement : reconnectez le compte.", true);
  try {
    const creds = await requireCredentials();
    const t = await tokenRequest({
      refresh_token: decrypt(account.refreshTokenEnc),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    });
    await db.googleAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encrypt(t.access_token),
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token) } : {}),
        status: "ACTIVE",
        lastError: null,
      },
    });
    account.accessTokenEnc = encrypt(t.access_token);
    account.tokenExpiresAt = new Date(Date.now() + t.expires_in * 1000);
    return t.access_token;
  } catch (error) {
    if (error instanceof GoogleAuthError && error.revoked) {
      await markGoogleDisconnected(account, "Accès Google révoqué ou expiré : reconnectez votre compte.");
    }
    throw error;
  }
}

export async function markGoogleDisconnected(account: GoogleAccount, message: string) {
  if (account.status === "DISCONNECTED") return;
  await db.googleAccount.update({ where: { id: account.id }, data: { status: "DISCONNECTED", lastError: message } });
  await db.mailbox.updateMany({ where: { googleAccountId: account.id }, data: { status: "DISCONNECTED", lastError: message } });
  await notify({
    userId: account.userId,
    type: "INTEGRATION_ERROR",
    title: "Google déconnecté",
    body: message,
    link: "/parametres/integrations",
  });
}

export class GoogleApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly reason?: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Appel authentifié à une API Google (JSON), avec un nouvel essai après rafraîchissement du jeton. */
export async function googleFetch<T = unknown>(
  account: GoogleAccount,
  url: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  let refreshed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await getGoogleAccessToken(account);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(url, { ...init, headers, body });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      account.tokenExpiresAt = new Date(0); // force le rafraîchissement
      continue;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (data as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } } | undefined)?.error;
      // Quota dépassé : nouvel essai après une pause croissante
      const reason = err?.errors?.[0]?.reason ?? "";
      if ((res.status === 429 || (res.status === 403 && /rateLimit/i.test(reason)) || res.status >= 500) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
        continue;
      }
      throw new GoogleApiError(`Google API ${res.status} : ${err?.message ?? res.statusText}`, res.status, err?.errors?.[0]?.reason ?? err?.status);
    }
    return data as T;
  }
  throw new GoogleApiError("Google API : authentification impossible", 401);
}

export async function revokeGoogleToken(account: GoogleAccount) {
  try {
    const token = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : decrypt(account.accessTokenEnc);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    // révocation au mieux
  }
}

export function hasScope(account: Pick<GoogleAccount, "scopes">, scope: string) {
  return account.scopes.split(/\s+/).includes(scope);
}
