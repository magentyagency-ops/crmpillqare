import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { encrypt, verifyState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeShopifyOAuthCode, normalizeShopDomain, registerShopifyWebhooks, verifyShopifyOAuthQuery } from "@/lib/shopify/client";
import { enqueueJob } from "@/lib/jobs";

export async function GET(req: NextRequest) {
  const fail = (message: string) => NextResponse.redirect(new URL(`/parametres/integrations?shopify=error&message=${encodeURIComponent(message)}`, env.appUrl));
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/login", env.appUrl));
  const sp = req.nextUrl.searchParams;
  const shop = normalizeShopDomain(sp.get("shop") ?? "");
  const state = verifyState<{ userId: string; shop: string }>(sp.get("state") ?? "");
  if (!shop || !state || state.userId !== user.id || state.shop !== shop) return fail("Requête d'installation invalide ou expirée.");
  if (!env.shopify.clientId || !env.shopify.clientSecret) return fail("Identifiants Shopify manquants.");
  if (!verifyShopifyOAuthQuery(sp, env.shopify.clientSecret)) return fail("Signature Shopify invalide.");
  const code = sp.get("code");
  if (!code) return fail("Code d'autorisation manquant.");
  try {
    const token = await exchangeShopifyOAuthCode(shop, env.shopify.clientId, env.shopify.clientSecret, code);
    const existing = await db.shopifyConnection.findFirst();
    const data = {
      shopDomain: shop,
      authMode: "OAUTH" as const,
      clientId: env.shopify.clientId,
      clientSecretEnc: encrypt(env.shopify.clientSecret),
      accessTokenEnc: encrypt(token.accessToken),
      tokenExpiresAt: null,
      scopes: token.scope,
      apiVersion: env.shopify.apiVersion,
      status: "ACTIVE" as const,
      lastError: null,
    };
    const conn = existing ? await db.shopifyConnection.update({ where: { id: existing.id }, data }) : await db.shopifyConnection.create({ data });
    await registerShopifyWebhooks(conn).catch((e) => console.error("[shopify] webhooks :", e));
    await enqueueJob("shopify.sync", { full: true });
    return NextResponse.redirect(new URL("/parametres/integrations?shopify=ok", env.appUrl));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Installation impossible");
  }
}
