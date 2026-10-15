import { after, NextResponse, type NextRequest } from "next/server";
import { getShopifyConnection, verifyShopifyWebhook, webhookSecrets } from "@/lib/shopify/client";
import { processShopifyWebhook, recordWebhook } from "@/lib/shopify/webhooks";
import { enqueueJob } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * Webhooks Shopify (commandes, clients). Signature HMAC vérifiée sur le corps brut,
 * dédoublonnage par X-Shopify-Webhook-Id, réponse immédiate puis traitement en arrière-plan.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const conn = await getShopifyConnection();
  const secrets = webhookSecrets(conn);
  if (!verifyShopifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), secrets)) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id") ?? `${topic}:${Date.now()}`;
  if (conn && shop && shop !== conn.shopDomain) return NextResponse.json({ error: "Boutique inconnue" }, { status: 403 });

  if (!(await recordWebhook(webhookId, topic, shop))) return NextResponse.json({ ok: true, duplicate: true });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  after(async () => {
    try {
      await processShopifyWebhook(webhookId, topic, payload);
    } catch (error) {
      console.error(`[shopify] webhook ${topic} :`, error instanceof Error ? error.message : error);
      // Nouvel essai automatique via la file de tâches
      await enqueueJob("shopify.webhook", { webhookId, topic, payload: payload as object }, { runAt: new Date(Date.now() + 60_000) });
    }
  });
  return NextResponse.json({ ok: true });
}
