import type { ShopifyConnection } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decryptOptional, encrypt, hmacSha256Base64, hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

export const SHOPIFY_SCOPES = ["read_customers", "read_orders", "read_all_orders", "read_products"];

export function normalizeShopDomain(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v)) return v;
  if (/^[a-z0-9][a-z0-9-]*$/.test(v)) return `${v}.myshopify.com`;
  return null;
}

export async function getShopifyConnection() {
  return db.shopifyConnection.findFirst({ orderBy: { createdAt: "asc" } });
}

export class ShopifyError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ShopifyError";
  }
}

/** Jeton via le « client credentials grant » (apps du Dev Dashboard de la même organisation, valable 24 h). */
export async function requestClientCredentialsToken(shop: string, clientId: string, clientSecret: string) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const text = await res.text();
  let json: { access_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // réponse HTML (boutique inconnue…)
  }
  if (!res.ok || !json.access_token) {
    throw new ShopifyError(
      `Shopify a refusé l'authentification (${res.status}) : ${json.error_description ?? json.error ?? "vérifiez le domaine, le Client ID et le Client secret, et que l'app et la boutique appartiennent à la même organisation Shopify."}`,
      res.status,
    );
  }
  return { accessToken: json.access_token, scope: json.scope ?? "", expiresIn: json.expires_in ?? 86399 };
}

/** Jeton d'accès valide pour l'Admin API (renouvelé automatiquement en mode client credentials). */
export async function getShopifyAccessToken(conn: ShopifyConnection): Promise<string> {
  if (conn.authMode === "CLIENT_CREDENTIALS") {
    const valid = conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000;
    if (valid) return decryptOptional(conn.accessTokenEnc)!;
    const secret = decryptOptional(conn.clientSecretEnc);
    if (!conn.clientId || !secret) throw new ShopifyError("Client ID / Client secret Shopify manquants.");
    const t = await requestClientCredentialsToken(conn.shopDomain, conn.clientId, secret);
    await db.shopifyConnection.update({
      where: { id: conn.id },
      data: { accessTokenEnc: encrypt(t.accessToken), tokenExpiresAt: new Date(Date.now() + t.expiresIn * 1000), scopes: t.scope, status: "ACTIVE", lastError: null },
    });
    return t.accessToken;
  }
  const token = decryptOptional(conn.accessTokenEnc);
  if (!token) throw new ShopifyError("Jeton d'accès Shopify manquant.");
  return token;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number }; requestedQueryCost?: number } };
};

/** Appel GraphQL Admin API avec gestion du quota (THROTTLED / 429). */
export async function shopifyGraphQL<T>(conn: ShopifyConnection, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await getShopifyAccessToken(conn);
    const res = await fetch(`https://${conn.shopDomain}/admin/api/${conn.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(10, retryAfter) * 1000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      if (conn.authMode === "CLIENT_CREDENTIALS" && attempt === 0) {
        conn.tokenExpiresAt = new Date(0);
        continue;
      }
      throw new ShopifyError(`Accès refusé par Shopify (${res.status}) : vérifiez les autorisations (scopes) de l'application.`, res.status);
    }
    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      if (json.errors.some((e) => e.extensions?.code === "THROTTLED")) {
        const status = json.extensions?.cost?.throttleStatus;
        const needed = json.extensions?.cost?.requestedQueryCost ?? 100;
        const waitSec = status ? Math.max(1, Math.ceil((needed - status.currentlyAvailable) / Math.max(1, status.restoreRate))) : 2;
        await new Promise((r) => setTimeout(r, Math.min(waitSec, 20) * 1000));
        continue;
      }
      throw new ShopifyError(`Erreur GraphQL Shopify : ${json.errors.map((e) => e.message).join(" ; ")}`);
    }
    if (!json.data) throw new ShopifyError("Réponse Shopify vide.");
    return json.data;
  }
  throw new ShopifyError("Shopify ne répond pas (quota dépassé). Réessayez plus tard.");
}

/** Vérifie la signature HMAC d'un webhook Shopify (corps brut). */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secrets: string[]): boolean {
  if (!hmacHeader) return false;
  return secrets.some((secret) => secret && safeEqual(hmacSha256Base64(secret, rawBody), hmacHeader));
}

/** Secrets possibles pour signer les webhooks : secret de l'app, clé des webhooks admin, variable d'env. */
export function webhookSecrets(conn: ShopifyConnection | null): string[] {
  const out: string[] = [];
  if (conn) {
    const s = decryptOptional(conn.clientSecretEnc);
    if (s) out.push(s);
    const w = decryptOptional(conn.webhookSecretEnc);
    if (w) out.push(w);
  }
  if (env.shopify.clientSecret) out.push(env.shopify.clientSecret);
  return [...new Set(out)];
}

/** Vérifie la signature HMAC des paramètres du retour OAuth Shopify. */
export function verifyShopifyOAuthQuery(params: URLSearchParams, clientSecret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(hmacSha256Hex(clientSecret, message), hmac);
}

export async function exchangeShopifyOAuthCode(shop: string, clientId: string, clientSecret: string, code: string) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new ShopifyError(`Échange du code OAuth Shopify impossible : ${json.error_description ?? res.status}`);
  return { accessToken: json.access_token, scope: json.scope ?? "" };
}

export const SHOPIFY_WEBHOOK_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_PAID",
  "ORDERS_CANCELLED",
  "ORDERS_FULFILLED",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
] as const;

/** Abonne le CRM aux webhooks Shopify (idempotent : les abonnements existants sont réutilisés). */
export async function registerShopifyWebhooks(conn: ShopifyConnection): Promise<{ created: number; existing: number; errors: string[] }> {
  const uri = `${env.appUrl}/api/webhooks/shopify`;
  if (!uri.startsWith("https://")) {
    return { created: 0, existing: 0, errors: ["Les webhooks Shopify exigent une URL publique en HTTPS (APP_URL). En local, utilisez un tunnel (cloudflared, ngrok) ou la synchronisation périodique."] };
  }
  const existing = await shopifyGraphQL<{ webhookSubscriptions: { nodes: { id: string; topic: string; uri: string }[] } }>(
    conn,
    `query { webhookSubscriptions(first: 100) { nodes { id topic uri } } }`,
  );
  const have = new Set(existing.webhookSubscriptions.nodes.filter((n) => n.uri === uri).map((n) => n.topic));
  let created = 0;
  const errors: string[] = [];
  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const res = await shopifyGraphQL<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: { field: string[]; message: string }[] } }>(
      conn,
      `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`,
      { topic, webhookSubscription: { uri } },
    );
    if (res.webhookSubscriptionCreate.userErrors.length) {
      errors.push(`${topic} : ${res.webhookSubscriptionCreate.userErrors.map((e) => e.message).join(", ")}`);
    } else created++;
  }
  await db.shopifyConnection.update({ where: { id: conn.id }, data: { webhooksRegisteredAt: new Date() } });
  return { created, existing: have.size, errors };
}

export async function testShopifyConnection(conn: ShopifyConnection) {
  const data = await shopifyGraphQL<{ shop: { name: string; email: string; currencyCode: string; myshopifyDomain: string } }>(
    conn,
    `query { shop { name email currencyCode myshopifyDomain } }`,
  );
  return data.shop;
}
