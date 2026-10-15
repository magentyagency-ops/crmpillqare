import { describe, expect, it } from "vitest";
import { blockedReasons } from "@/lib/deals";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { orderFromWebhook } from "@/lib/shopify/sync";

const day = 86_400_000;

describe("dossiers bloqués", () => {
  const settings = DEFAULT_SETTINGS.pipeline;
  const now = new Date("2026-10-07T12:00:00Z");
  const deal = (over: Partial<Parameters<typeof blockedReasons>[0]> = {}) => ({
    stage: "QUOTE" as const,
    nextActionAt: new Date(now.getTime() + day),
    lastActivityAt: new Date(now.getTime() - day),
    createdAt: new Date(now.getTime() - 5 * day),
    stageEnteredAt: new Date(now.getTime() - 2 * day),
    ...over,
  });

  it("dossier sain : aucune alerte", () => {
    expect(blockedReasons(deal(), settings, now)).toEqual([]);
  });

  it("sans prochaine action, action en retard, inactif, trop long dans l'étape", () => {
    expect(blockedReasons(deal({ nextActionAt: null }), settings, now)).toContain("NO_NEXT_ACTION");
    expect(blockedReasons(deal({ nextActionAt: new Date(now.getTime() - 2 * day) }), settings, now)).toContain("OVERDUE_ACTION");
    expect(blockedReasons(deal({ lastActivityAt: new Date(now.getTime() - 30 * day) }), settings, now)).toContain("STALE");
    expect(blockedReasons(deal({ stageEnteredAt: new Date(now.getTime() - 60 * day) }), settings, now)).toContain("STAGE_TOO_LONG");
  });

  it("un dossier signé ou perdu n'est jamais bloqué", () => {
    expect(blockedReasons(deal({ stage: "WON", nextActionAt: null }), settings, now)).toEqual([]);
  });
});

describe("Shopify", () => {
  it("convertit une commande webhook (montants, client, lignes)", () => {
    const o = orderFromWebhook({
      id: 7001,
      name: "#1001",
      email: "Lucie@Gmail.com",
      created_at: "2026-10-07T18:00:00Z",
      financial_status: "paid",
      fulfillment_status: null,
      currency: "EUR",
      subtotal_price: "69.00",
      total_tax: "11.50",
      total_discounts: "0.00",
      total_price: "69.00",
      tags: "B2C, Newsletter",
      customer: { id: 9001, email: "lucie@gmail.com", first_name: "Lucie", last_name: "Bernard" },
      line_items: [{ id: 1, title: "Pilulier connecté PillQare", sku: "PQ-PILULIER", quantity: 2, price: "34.50", total_discount: "0.00" }],
    });
    expect(o).toMatchObject({ id: "7001", name: "#1001", financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED", total: 69, totalTax: 11.5 });
    expect(o.customer).toMatchObject({ id: "9001", firstName: "Lucie" });
    expect(o.tags).toEqual(["B2C", "Newsletter"]);
    expect(o.lineItems[0]).toMatchObject({ sku: "PQ-PILULIER", quantity: 2, unitPrice: 34.5, total: 69 });
  });
});
