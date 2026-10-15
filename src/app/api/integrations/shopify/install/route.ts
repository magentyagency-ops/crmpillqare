import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { signState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { normalizeShopDomain, SHOPIFY_SCOPES } from "@/lib/shopify/client";

/** Installation OAuth (app Shopify d'une autre organisation, distribution personnalisée). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/login", env.appUrl));
  const shop = normalizeShopDomain(req.nextUrl.searchParams.get("shop") ?? "");
  const fail = (message: string) => NextResponse.redirect(new URL(`/parametres/integrations?shopify=error&message=${encodeURIComponent(message)}`, env.appUrl));
  if (!shop) return fail("Domaine de boutique invalide.");
  if (!env.shopify.clientId || !env.shopify.clientSecret) return fail("SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET non configurés sur le serveur.");
  const state = signState({ userId: user.id, shop });
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", env.shopify.clientId);
  url.searchParams.set("scope", SHOPIFY_SCOPES.join(","));
  url.searchParams.set("redirect_uri", `${env.appUrl}/api/integrations/shopify/callback`);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
