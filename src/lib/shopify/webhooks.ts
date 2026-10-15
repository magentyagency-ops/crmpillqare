import { db, isUniqueViolation } from "@/lib/db";
import { customerFromWebhook, orderFromWebhook, upsertShopifyCustomer, upsertShopifyOrder } from "./sync";

/** Enregistre la réception d'un webhook (dédoublonnage par X-Shopify-Webhook-Id). */
export async function recordWebhook(webhookId: string, topic: string, shopDomain: string): Promise<boolean> {
  try {
    await db.shopifyWebhookEvent.create({ data: { webhookId, topic, shopDomain } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false; // déjà reçu (Shopify renvoie parfois les webhooks)
    throw error;
  }
}

/** Traite un webhook Shopify déjà authentifié. */
export async function processShopifyWebhook(webhookId: string, topic: string, payload: unknown) {
  try {
    switch (topic) {
      case "orders/create":
      case "orders/updated":
      case "orders/paid":
      case "orders/cancelled":
      case "orders/fulfilled":
      case "orders/partially_fulfilled":
        await upsertShopifyOrder(orderFromWebhook(payload), { fromWebhook: true });
        break;
      case "customers/create":
      case "customers/update": {
        const c = customerFromWebhook(payload);
        if (c) await upsertShopifyCustomer(c, { notifyNew: topic === "customers/create" });
        break;
      }
      case "app/uninstalled":
        await db.shopifyConnection.updateMany({ data: { status: "DISCONNECTED", lastError: "Application désinstallée de la boutique Shopify." } });
        break;
      default:
        // customers/data_request, customers/redact, shop/redact… : accusé de réception
        break;
    }
    await db.shopifyWebhookEvent.update({ where: { webhookId }, data: { processedAt: new Date(), error: null } });
  } catch (error) {
    await db.shopifyWebhookEvent
      .update({ where: { webhookId }, data: { error: error instanceof Error ? error.message.slice(0, 2000) : String(error) } })
      .catch(() => undefined);
    throw error;
  }
}
