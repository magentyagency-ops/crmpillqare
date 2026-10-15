import type { ShopifyConnection } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { upsertContact } from "@/lib/contacts";
import { defaultOwner } from "@/lib/assignment";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeDealStage, findOpenDealForContact } from "@/lib/deals";
import { contactDisplayName } from "@/lib/labels";
import { formatEUR, round2 } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { shopifyGraphQL } from "./client";

// ───────────── Modèles normalisés (GraphQL & webhooks) ─────────────

export type ShopifyAddress = {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
};

export type ShopifyCustomerData = {
  id: string; // identifiant numérique (legacy)
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  numberOfOrders: number | null;
  defaultAddress: ShopifyAddress | null;
};

export type ShopifyOrderData = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
  processedAt: Date;
  cancelledAt: Date | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currency: string;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalShipping: number;
  total: number;
  note: string | null;
  tags: string[];
  customer: ShopifyCustomerData | null;
  shippingAddress: ShopifyAddress | null;
  billingAddress: ShopifyAddress | null;
  lineItems: { id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; unitPrice: number; total: number; variantId: string | null; productId: string | null }[];
};

function legacyId(gid: string | number | null | undefined): string | null {
  if (gid === null || gid === undefined) return null;
  const s = String(gid);
  const m = s.match(/(\d+)$/);
  return m ? m[1]! : s;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function tagList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function restAddress(a: any): ShopifyAddress | null {
  if (!a) return null;
  return { firstName: a.first_name, lastName: a.last_name, company: a.company, address1: a.address1, address2: a.address2, zip: a.zip, city: a.city, country: a.country, phone: a.phone };
}

function gqlAddress(a: any): ShopifyAddress | null {
  if (!a) return null;
  return { firstName: a.firstName, lastName: a.lastName, company: a.company, address1: a.address1, address2: a.address2, zip: a.zip, city: a.city, country: a.country, phone: a.phone };
}

export function customerFromWebhook(c: any): ShopifyCustomerData | null {
  if (!c?.id) return null;
  return {
    id: legacyId(c.id)!,
    email: c.email ?? c.default_email_address?.email_address ?? null,
    phone: c.phone ?? c.default_phone_number?.phone_number ?? c.default_address?.phone ?? null,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    tags: tagList(c.tags),
    numberOfOrders: c.orders_count !== undefined ? num(c.orders_count) : null,
    defaultAddress: restAddress(c.default_address),
  };
}

export function orderFromWebhook(o: any): ShopifyOrderData {
  const money = (set: any, fallback: unknown) => num(set?.shop_money?.amount ?? fallback);
  return {
    id: legacyId(o.id)!,
    name: o.name ?? `#${o.order_number ?? o.id}`,
    email: o.email ?? o.contact_email ?? null,
    phone: o.phone ?? null,
    createdAt: new Date(o.created_at ?? Date.now()),
    processedAt: new Date(o.processed_at ?? o.created_at ?? Date.now()),
    cancelledAt: o.cancelled_at ? new Date(o.cancelled_at) : null,
    financialStatus: o.financial_status ? String(o.financial_status).toUpperCase() : null,
    fulfillmentStatus: o.fulfillment_status ? String(o.fulfillment_status).toUpperCase() : "UNFULFILLED",
    currency: o.currency ?? "EUR",
    subtotal: money(o.subtotal_price_set, o.subtotal_price),
    totalTax: money(o.total_tax_set, o.total_tax),
    totalDiscount: money(o.total_discounts_set, o.total_discounts),
    totalShipping: money(o.total_shipping_price_set, 0),
    total: money(o.total_price_set, o.total_price),
    note: o.note ?? null,
    tags: tagList(o.tags),
    customer: customerFromWebhook(o.customer),
    shippingAddress: restAddress(o.shipping_address),
    billingAddress: restAddress(o.billing_address),
    lineItems: (o.line_items ?? []).map((li: any) => ({
      id: legacyId(li.id)!,
      title: li.title ?? li.name ?? "Article",
      variantTitle: li.variant_title ?? null,
      sku: li.sku || null,
      quantity: num(li.quantity),
      unitPrice: num(li.price_set?.shop_money?.amount ?? li.price),
      total: round2(num(li.price_set?.shop_money?.amount ?? li.price) * num(li.quantity) - num(li.total_discount)),
      variantId: legacyId(li.variant_id),
      productId: legacyId(li.product_id),
    })),
  };
}

const GQL_CUSTOMER_FIELDS = `
  id legacyResourceId firstName lastName tags numberOfOrders
  defaultEmailAddress { emailAddress }
  defaultPhoneNumber { phoneNumber }
  defaultAddress { firstName lastName company address1 address2 zip city country phone }
`;

function customerFromGraphQL(c: any): ShopifyCustomerData | null {
  if (!c) return null;
  return {
    id: String(c.legacyResourceId ?? legacyId(c.id)),
    email: c.defaultEmailAddress?.emailAddress ?? null,
    phone: c.defaultPhoneNumber?.phoneNumber ?? c.defaultAddress?.phone ?? null,
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    tags: tagList(c.tags),
    numberOfOrders: c.numberOfOrders !== undefined ? num(c.numberOfOrders) : null,
    defaultAddress: gqlAddress(c.defaultAddress),
  };
}

function orderFromGraphQL(o: any): ShopifyOrderData {
  const money = (set: any) => num(set?.shopMoney?.amount);
  return {
    id: String(o.legacyResourceId ?? legacyId(o.id)),
    name: o.name,
    email: o.email ?? null,
    phone: o.phone ?? null,
    createdAt: new Date(o.createdAt),
    processedAt: new Date(o.processedAt ?? o.createdAt),
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    currency: o.currencyCode ?? "EUR",
    subtotal: money(o.subtotalPriceSet),
    totalTax: money(o.totalTaxSet),
    totalDiscount: money(o.totalDiscountsSet),
    totalShipping: money(o.totalShippingPriceSet),
    total: money(o.totalPriceSet),
    note: o.note ?? null,
    tags: tagList(o.tags),
    customer: customerFromGraphQL(o.customer),
    shippingAddress: gqlAddress(o.shippingAddress),
    billingAddress: gqlAddress(o.billingAddress),
    lineItems: (o.lineItems?.nodes ?? []).map((li: any) => ({
      id: legacyId(li.id)!,
      title: li.title,
      variantTitle: li.variantTitle ?? null,
      sku: li.sku || null,
      quantity: num(li.quantity),
      unitPrice: money(li.originalUnitPriceSet),
      total: money(li.discountedTotalSet),
      variantId: legacyId(li.variant?.id),
      productId: legacyId(li.product?.id),
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ───────────── Rapprochement / création sans doublon ─────────────

export async function upsertShopifyCustomer(c: ShopifyCustomerData, opts: { hasOrders?: boolean; notifyNew?: boolean } = {}) {
  if (!c.email && !c.phone && !c.firstName && !c.lastName) return null;
  const existingByShopify = await db.contact.findUnique({ where: { shopifyCustomerId: c.id }, select: { id: true, ownerId: true } });
  const company = c.defaultAddress?.company?.trim() || null;
  const ownerId = existingByShopify?.ownerId ?? (await defaultOwner(null));
  const isCustomer = (c.numberOfOrders ?? 0) > 0 || opts.hasOrders;
  const { contact, created } = await upsertContact({
    shopifyCustomerId: c.id,
    email: c.email,
    phone: c.phone,
    firstName: c.firstName ?? c.defaultAddress?.firstName,
    lastName: c.lastName ?? c.defaultAddress?.lastName,
    companyName: company,
    kind: company ? "B2B" : "B2C",
    address: [c.defaultAddress?.address1, c.defaultAddress?.address2].filter(Boolean).join(", ") || null,
    postalCode: c.defaultAddress?.zip ?? null,
    city: c.defaultAddress?.city ?? null,
    country: c.defaultAddress?.country ?? null,
    source: "SHOPIFY",
    sourceDetail: "Client boutique en ligne",
    status: isCustomer ? "CUSTOMER" : "PROSPECT",
    ownerId,
    tags: ["shopify", ...c.tags.slice(0, 10)],
  });
  if (created) {
    await logActivity({ type: "SYSTEM", title: "Contact importé depuis Shopify", contactId: contact.id });
    if (opts.notifyNew && contact.ownerId) {
      await notify({
        userId: contact.ownerId,
        type: "LEAD_ASSIGNED",
        title: `Nouveau client Shopify : ${contactDisplayName(contact)}`,
        link: `/contacts/${contact.id}`,
      });
    }
  }
  return contact;
}

const PAID_STATUSES = new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);

/** Crée ou met à jour une commande Shopify (idempotent), et déclenche le suivi après-achat. */
export async function upsertShopifyOrder(o: ShopifyOrderData, opts: { fromWebhook?: boolean } = {}) {
  // 1. Contact (client Shopify, ou commande invité rapprochée par email / téléphone)
  let contactId: string | null = null;
  if (o.customer) {
    const c = await upsertShopifyCustomer(
      { ...o.customer, email: o.customer.email ?? o.email, phone: o.customer.phone ?? o.phone },
      { hasOrders: true },
    );
    contactId = c?.id ?? null;
  }
  if (!contactId) {
    const addr = o.billingAddress ?? o.shippingAddress;
    if (!o.email && !o.phone) return null;
    const ownerId = await defaultOwner(null);
    const { contact } = await upsertContact({
      email: o.email,
      phone: o.phone ?? addr?.phone,
      firstName: addr?.firstName,
      lastName: addr?.lastName,
      companyName: addr?.company,
      kind: addr?.company ? "B2B" : "B2C",
      address: addr?.address1,
      postalCode: addr?.zip,
      city: addr?.city,
      source: "SHOPIFY",
      status: "CUSTOMER",
      ownerId,
      tags: ["shopify"],
    });
    contactId = contact.id;
  }
  const contact = await db.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: { id: true, ownerId: true, status: true, companyId: true, firstName: true, lastName: true, email: true, phone: true },
  });

  // 2. Correspondance des produits du catalogue
  const variantIds = o.lineItems.map((l) => l.variantId).filter((v): v is string => Boolean(v));
  const skus = o.lineItems.map((l) => l.sku).filter((v): v is string => Boolean(v));
  const products = await db.product.findMany({
    where: { OR: [{ shopifyVariantId: { in: variantIds } }, { sku: { in: skus } }] },
    select: { id: true, shopifyVariantId: true, sku: true },
  });
  const productFor = (l: ShopifyOrderData["lineItems"][number]) =>
    products.find((p) => (l.variantId && p.shopifyVariantId === l.variantId) || (l.sku && p.sku === l.sku))?.id ?? null;

  const existing = await db.order.findUnique({ where: { shopifyOrderId: o.id } });
  const isPaid = o.financialStatus ? PAID_STATUSES.has(o.financialStatus) : false;
  const isFulfilled = o.fulfillmentStatus === "FULFILLED";
  const data = {
    number: o.name,
    contactId: contact.id,
    companyId: contact.companyId,
    currency: o.currency,
    subtotal: o.subtotal,
    totalDiscount: o.totalDiscount,
    totalTax: o.totalTax,
    totalShipping: o.totalShipping,
    total: o.total,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    processedAt: o.processedAt,
    cancelledAt: o.cancelledAt,
    paidAt: existing?.paidAt ?? (isPaid ? new Date() : null),
    fulfilledAt: existing?.fulfilledAt ?? (isFulfilled ? new Date() : null),
    shippingAddress: o.shippingAddress ?? undefined,
    note: o.note,
    tags: o.tags,
  };

  const order = await db.$transaction(async (tx) => {
    const saved = existing
      ? await tx.order.update({ where: { id: existing.id }, data })
      : await tx.order.create({ data: { ...data, source: "SHOPIFY", shopifyOrderId: o.id } });
    await tx.orderItem.deleteMany({ where: { orderId: saved.id } });
    if (o.lineItems.length) {
      await tx.orderItem.createMany({
        data: o.lineItems.map((l) => ({
          orderId: saved.id,
          productId: productFor(l),
          shopifyLineItemId: l.id,
          title: l.title,
          variantTitle: l.variantTitle,
          sku: l.sku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          total: l.total,
        })),
      });
    }
    return saved;
  });

  if (contact.status !== "CUSTOMER" && !o.cancelledAt) {
    await db.contact.update({ where: { id: contact.id }, data: { status: "CUSTOMER" } });
  }

  if (!existing) {
    await logActivity({
      type: "ORDER_PLACED",
      title: `Commande ${o.name} — ${formatEUR(o.total)}`,
      body: o.lineItems.map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`).join("\n"),
      contactId: contact.id,
      orderId: order.id,
      occurredAt: o.processedAt,
    });
    if (opts.fromWebhook && contact.ownerId) {
      await notify({
        userId: contact.ownerId,
        type: "ORDER_PLACED",
        title: `Nouvelle commande ${o.name} : ${contactDisplayName(contact)}`,
        body: formatEUR(o.total),
        link: `/commandes/${order.id}`,
      });
    }
    // Un prospect en cours qui commande en ligne : dossier signé automatiquement
    const openDeal = await findOpenDealForContact(contact.id);
    if (openDeal && !o.cancelledAt && opts.fromWebhook) {
      await changeDealStage(openDeal.id, "WON", { amount: round2(o.total - o.totalTax), note: `Commande Shopify ${o.name}` });
    }
  }

  // 3. Annulation : arrêt du suivi après-achat
  if (o.cancelledAt) {
    const { stopEnrollment } = await import("@/lib/sequences/engine");
    const active = await db.sequenceEnrollment.findMany({ where: { orderId: order.id, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } });
    for (const e of active) await stopEnrollment(e.id, "MANUAL");
    return order;
  }

  // 4. Suivi après-achat (installation, prise en main, satisfaction) dès le paiement
  const settings = await getSettings("shopify");
  // Commandes historiques importées : pas de suivi rétroactif (seulement les commandes récentes)
  const ageDays = (Date.now() - o.processedAt.getTime()) / 86_400_000;
  const eligible = ageDays < (opts.fromWebhook ? 30 : 3);
  if (settings.postPurchaseEnabled && isPaid && !order.postPurchaseStartedAt && eligible) {
    const claimed = await db.order.updateMany({ where: { id: order.id, postPurchaseStartedAt: null }, data: { postPurchaseStartedAt: new Date() } });
    if (claimed.count) {
      const { autoEnroll } = await import("@/lib/sequences/engine");
      const ownerId = contact.ownerId ?? (await defaultOwner(null));
      await autoEnroll("ORDER_PAID", { contactId: contact.id, orderId: order.id, ownerId, startAt: new Date() });
    }
  }
  return order;
}

// ───────────── Import / synchronisation périodique ─────────────

const ORDERS_QUERY = `
  query Orders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id legacyResourceId name email phone createdAt processedAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus currencyCode note tags
        totalPriceSet { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        customer { ${GQL_CUSTOMER_FIELDS} }
        shippingAddress { firstName lastName company address1 address2 zip city country phone }
        billingAddress { firstName lastName company address1 address2 zip city country phone }
        lineItems(first: 50) {
          nodes {
            id title variantTitle sku quantity
            originalUnitPriceSet { shopMoney { amount } }
            discountedTotalSet { shopMoney { amount } }
            variant { id }
            product { id }
          }
        }
      }
    }
  }`;

const CUSTOMERS_QUERY = `
  query Customers($cursor: String, $query: String) {
    customers(first: 100, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${GQL_CUSTOMER_FIELDS} }
    }
  }`;

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title description variants(first: 20) { nodes { id title sku price } } }
    }
  }`;

export type SyncReport = { customers: number; orders: number; products: number; errors: string[]; at: string };

/** Import des produits Shopify dans le catalogue (rapprochement par variante ou SKU). */
export async function syncShopifyProducts(conn: ShopifyConnection): Promise<number> {
  let cursor: string | null = null;
  let count = 0;
  for (let page = 0; page < 20; page++) {
    type P = { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; title: string; description: string; variants: { nodes: { id: string; title: string; sku: string | null; price: string }[] } }[] } };
    const res: P = await shopifyGraphQL<P>(conn, PRODUCTS_QUERY, { cursor });
    for (const p of res.products.nodes) {
      for (const v of p.variants.nodes) {
        const variantId = legacyId(v.id)!;
        const name = v.title && v.title !== "Default Title" ? `${p.title} — ${v.title}` : p.title;
        const priceTTC = num(v.price);
        const existing = await db.product.findFirst({ where: { OR: [{ shopifyVariantId: variantId }, ...(v.sku ? [{ sku: v.sku }] : [])] } });
        if (existing) {
          await db.product.update({ where: { id: existing.id }, data: { shopifyVariantId: variantId, shopifyProductId: legacyId(p.id) } });
        } else {
          await db.product.create({
            data: {
              name,
              sku: v.sku || null,
              description: p.description?.slice(0, 2000) || null,
              unitPriceHT: round2(priceTTC / 1.2),
              vatRate: 20,
              shopifyVariantId: variantId,
              shopifyProductId: legacyId(p.id),
            },
          });
        }
        count++;
      }
    }
    if (!res.products.pageInfo.hasNextPage) break;
    cursor = res.products.pageInfo.endCursor;
  }
  return count;
}

/** Import complet (premier branchement) ou incrémental (depuis la dernière synchro). */
export async function syncShopify(conn: ShopifyConnection, opts: { full?: boolean } = {}): Promise<SyncReport> {
  const report: SyncReport = { customers: 0, orders: 0, products: 0, errors: [], at: new Date().toISOString() };
  const settings = await getSettings("shopify");
  const since = !opts.full && conn.lastSyncAt ? new Date(conn.lastSyncAt.getTime() - 10 * 60_000) : null;
  const sinceQuery = since ? `updated_at:>='${since.toISOString()}'` : null;

  try {
    if (opts.full) report.products = await syncShopifyProducts(conn);
  } catch (error) {
    report.errors.push(`Produits : ${error instanceof Error ? error.message : error}`);
  }

  // Commandes
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      type R = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } };
      const res: R = await shopifyGraphQL<R>(conn, ORDERS_QUERY, { cursor, query: sinceQuery });
      for (const node of res.orders.nodes) {
        try {
          const saved = await upsertShopifyOrder(orderFromGraphQL(node), { fromWebhook: false });
          if (saved) report.orders++;
        } catch (error) {
          report.errors.push(`Commande : ${error instanceof Error ? error.message : error}`);
        }
      }
      if (!res.orders.pageInfo.hasNextPage) break;
      cursor = res.orders.pageInfo.endCursor;
    }
  } catch (error) {
    report.errors.push(`Commandes : ${error instanceof Error ? error.message : error}`);
  }

  // Clients sans commande (comptes créés, inscrits…)
  if (settings.importCustomersWithoutOrders) {
    try {
      let cursor: string | null = null;
      for (let page = 0; page < 200; page++) {
        type R = { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } };
        const res: R = await shopifyGraphQL<R>(conn, CUSTOMERS_QUERY, { cursor, query: sinceQuery });
        for (const node of res.customers.nodes) {
          try {
            const c = customerFromGraphQL(node);
            if (c && (await upsertShopifyCustomer(c))) report.customers++;
          } catch (error) {
            report.errors.push(`Client : ${error instanceof Error ? error.message : error}`);
          }
        }
        if (!res.customers.pageInfo.hasNextPage) break;
        cursor = res.customers.pageInfo.endCursor;
      }
    } catch (error) {
      report.errors.push(`Clients : ${error instanceof Error ? error.message : error}`);
    }
  }

  await db.shopifyConnection.update({
    where: { id: conn.id },
    data: {
      lastSyncAt: new Date(report.at),
      lastSyncResult: report,
      status: report.errors.length && report.orders === 0 && report.customers === 0 ? "ERROR" : "ACTIVE",
      lastError: report.errors[0] ?? null,
    },
  });
  return report;
}
