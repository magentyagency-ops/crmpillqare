import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { notify, notifyManagers } from "@/lib/notifications";
import { advanceDealTo, changeDealStage, refreshDealNextAction, STAGE_INDEX } from "@/lib/deals";
import { contactDisplayName } from "@/lib/labels";
import { formatEUR, toNumber } from "@/lib/format";
import { addDaysTz, formatDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { composeEmail } from "@/lib/email/render";
import { buildTemplateVars, quotePublicUrl } from "@/lib/email/vars";
import { computeQuoteTotals } from "./totals";
import { generateQuotePdf } from "./pdf";

export type QuoteItemInput = {
  productId?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unitPriceHT: number;
  discountPct?: number | null;
  vatRate?: number | null;
};

export type QuoteInput = {
  title?: string | null;
  contactId: string;
  dealId?: string | null;
  companyId?: string | null;
  ownerId: string;
  validUntil?: Date | null;
  globalDiscountPct?: number | null;
  notes?: string | null;
  terms?: string | null;
  items: QuoteItemInput[];
};

/** Numéro de devis séquentiel par année : DEV-2026-0001 (verrou transactionnel anti-doublon). */
async function nextQuoteNumber(tx: Prisma.TransactionClient): Promise<string> {
  const settings = await getSettings("quotes");
  const year = formatDate(new Date(), "yyyy");
  const prefix = `${settings.prefix || "DEV"}-${year}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-number:${prefix}`}))`;
  const last = await tx.quote.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  const lastSeq = last ? Number(last.number.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

function itemsData(items: QuoteItemInput[], lineTotals: number[]) {
  return items.map((it, i) => ({
    productId: it.productId ?? null,
    name: it.name.slice(0, 300),
    description: it.description ?? null,
    quantity: it.quantity,
    unit: it.unit || "unité",
    unitPriceHT: it.unitPriceHT,
    discountPct: it.discountPct ?? 0,
    vatRate: it.vatRate ?? 20,
    totalHT: lineTotals[i] ?? 0,
    position: i,
  }));
}

function totalsFor(input: Pick<QuoteInput, "items" | "globalDiscountPct">) {
  return computeQuoteTotals(
    input.items.map((i) => ({ quantity: i.quantity, unitPriceHT: i.unitPriceHT, discountPct: i.discountPct ?? 0, vatRate: i.vatRate ?? 20 })),
    input.globalDiscountPct ?? 0,
  );
}

export async function createQuote(input: QuoteInput, byUserId: string) {
  if (input.items.length === 0) throw new Error("Ajoutez au moins une ligne au devis.");
  const settings = await getSettings("quotes");
  const contact = await db.contact.findUniqueOrThrow({ where: { id: input.contactId }, select: { companyId: true } });
  const totals = totalsFor(input);
  const quote = await db.$transaction(async (tx) => {
    const number = await nextQuoteNumber(tx);
    return tx.quote.create({
      data: {
        number,
        title: input.title ?? null,
        contactId: input.contactId,
        dealId: input.dealId ?? null,
        companyId: input.companyId ?? contact.companyId,
        ownerId: input.ownerId,
        validUntil: input.validUntil ?? addDaysTz(new Date(), settings.validityDays),
        globalDiscountPct: input.globalDiscountPct ?? 0,
        notes: input.notes ?? settings.defaultNotes ?? null,
        terms: input.terms ?? settings.defaultTerms,
        subtotalHT: totals.subtotalHT,
        discountHT: totals.discountHT,
        totalHT: totals.totalHT,
        totalVAT: totals.totalVAT,
        totalTTC: totals.totalTTC,
        items: { create: itemsData(input.items, totals.lineTotals) },
      },
    });
  });
  await logActivity({
    type: "QUOTE_CREATED",
    title: `Devis ${quote.number} créé — ${formatEUR(quote.totalHT)} HT`,
    contactId: quote.contactId,
    dealId: quote.dealId,
    userId: byUserId,
    quoteId: quote.id,
  });
  return quote;
}

export async function updateQuote(quoteId: string, input: QuoteInput) {
  const existing = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
  if (existing.status !== "DRAFT") throw new Error("Seul un devis en brouillon peut être modifié. Dupliquez-le pour créer une nouvelle version.");
  const totals = totalsFor(input);
  return db.$transaction(async (tx) => {
    await tx.quoteItem.deleteMany({ where: { quoteId } });
    return tx.quote.update({
      where: { id: quoteId },
      data: {
        title: input.title ?? null,
        contactId: input.contactId,
        dealId: input.dealId ?? null,
        companyId: input.companyId ?? existing.companyId,
        ownerId: input.ownerId,
        validUntil: input.validUntil ?? existing.validUntil,
        globalDiscountPct: input.globalDiscountPct ?? 0,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        subtotalHT: totals.subtotalHT,
        discountHT: totals.discountHT,
        totalHT: totals.totalHT,
        totalVAT: totals.totalVAT,
        totalTTC: totals.totalTTC,
        items: { create: itemsData(input.items, totals.lineTotals) },
      },
    });
  });
}

export async function duplicateQuote(quoteId: string, byUserId: string) {
  const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: { orderBy: { position: "asc" } } } });
  return createQuote(
    {
      title: q.title,
      contactId: q.contactId,
      dealId: q.dealId,
      companyId: q.companyId,
      ownerId: q.ownerId,
      globalDiscountPct: toNumber(q.globalDiscountPct),
      notes: q.notes,
      terms: q.terms,
      items: q.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        description: i.description,
        quantity: toNumber(i.quantity),
        unit: i.unit,
        unitPriceHT: toNumber(i.unitPriceHT),
        discountPct: toNumber(i.discountPct),
        vatRate: toNumber(i.vatRate),
      })),
    },
    byUserId,
  );
}

export async function defaultQuoteEmail(quoteId: string) {
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { contact: true, owner: true } });
  const vars = await buildTemplateVars({ contactId: quote.contactId, dealId: quote.dealId, userId: quote.ownerId, quoteId });
  const composed = composeEmail({
    subject: "Votre devis {{org.name}} n° {{quote.number}}",
    body: `{{contact.greeting}}

Suite à notre échange, vous trouverez ci-joint notre proposition n° {{quote.number}} d'un montant de {{quote.totalTTC}} TTC.

Vous pouvez la consulter et l'accepter en ligne en un clic : {{quote.link}}

Cette offre est valable jusqu'au {{quote.validUntil}}. Je reste à votre disposition pour toute question.

Bien cordialement,`,
    vars,
  });
  return { to: quote.contact.email ?? "", subject: composed.subject, body: composed.text };
}

/** Envoie le devis (PDF en pièce jointe + lien d'acceptation en ligne) et fait avancer le dossier. */
export async function sendQuote(quoteId: string, byUserId: string, email: { to: string[]; cc?: string[]; subject: string; body: string }) {
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { deal: true } });
  if (quote.status === "ACCEPTED" || quote.status === "REFUSED") throw new Error("Ce devis est déjà clôturé.");
  const owner = await db.user.findUniqueOrThrow({ where: { id: quote.ownerId }, select: { signature: true } });
  const pdf = await generateQuotePdf(quoteId);
  const link = quotePublicUrl(quote.publicToken);
  const body = email.body.includes(link) ? email.body : `${email.body}\n\nConsulter et accepter le devis en ligne : ${link}`;
  const composed = composeEmail({ subject: email.subject, body, signature: owner.signature });
  const { sendEmail } = await import("@/lib/email/send");
  await sendEmail({
    senderId: byUserId,
    to: email.to,
    cc: email.cc,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    contactId: quote.contactId,
    dealId: quote.dealId,
    attachments: [{ filename: `Devis-${quote.number}.pdf`, content: pdf, contentType: "application/pdf" }],
    skipActivity: true,
  });
  const sent = await db.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: new Date() } });
  await logActivity({
    type: "QUOTE_SENT",
    title: `Devis ${quote.number} envoyé — ${formatEUR(quote.totalHT)} HT`,
    body: `Envoyé à ${email.to.join(", ")}`,
    contactId: quote.contactId,
    dealId: quote.dealId,
    userId: byUserId,
    quoteId,
  });
  const { autoEnroll, stopEnrollment } = await import("@/lib/sequences/engine");
  if (quote.dealId && quote.deal) {
    await db.deal.update({ where: { id: quote.dealId }, data: { amount: quote.totalHT } });
    const before = quote.deal.stage;
    if (before !== "WON" && before !== "LOST") {
      if (STAGE_INDEX[before] < STAGE_INDEX.QUOTE) await advanceDealTo(quote.dealId, "QUOTE", { userId: byUserId });
      // Relances de devis comptées à partir du dernier envoi : celles d'un envoi précédent sont remplacées
      const previous = await db.sequenceEnrollment.findMany({
        where: { dealId: quote.dealId, status: { in: ["ACTIVE", "PAUSED"] }, sequence: { trigger: "QUOTE_SENT" } },
        select: { id: true },
      });
      for (const e of previous) await stopEnrollment(e.id, "QUOTE_RESENT");
      await autoEnroll("QUOTE_SENT", { contactId: quote.contactId, dealId: quote.dealId, quoteId, ownerId: quote.ownerId });
    }
  } else if (!quote.dealId) {
    const previous = await db.sequenceEnrollment.findMany({
      where: { contactId: quote.contactId, dealId: null, status: { in: ["ACTIVE", "PAUSED"] }, sequence: { trigger: "QUOTE_SENT" } },
      select: { id: true },
    });
    for (const e of previous) await stopEnrollment(e.id, "QUOTE_RESENT");
    await autoEnroll("QUOTE_SENT", { contactId: quote.contactId, quoteId, ownerId: quote.ownerId });
  }
  return sent;
}

export async function markQuoteViewed(token: string) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: { contact: true } });
  if (!quote || quote.viewedAt || quote.status !== "SENT") return quote;
  await db.quote.update({ where: { id: quote.id }, data: { viewedAt: new Date() } });
  await logActivity({ type: "QUOTE_VIEWED", title: `Devis ${quote.number} consulté en ligne`, contactId: quote.contactId, dealId: quote.dealId, quoteId: quote.id });
  await notify({
    userId: quote.ownerId,
    type: "QUOTE_VIEWED",
    title: `${contactDisplayName(quote.contact)} consulte le devis ${quote.number}`,
    body: "Bon moment pour appeler !",
    link: `/devis/${quote.id}`,
  });
  return quote;
}

export async function acceptQuote(token: string, acceptedByName: string, ip: string | null) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: { contact: true } });
  if (!quote) throw new Error("Devis introuvable.");
  if (quote.status === "ACCEPTED") return quote;
  if (quote.status !== "SENT") throw new Error("Ce devis ne peut plus être accepté.");
  if (quote.validUntil < new Date()) throw new Error("Ce devis a expiré. Contactez-nous pour une nouvelle proposition.");
  const updated = await db.quote.update({
    where: { id: quote.id },
    data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName: acceptedByName.slice(0, 200), acceptedIp: ip },
  });
  await logActivity({
    type: "QUOTE_ACCEPTED",
    title: `Devis ${quote.number} accepté en ligne par ${acceptedByName}`,
    body: `${formatEUR(quote.totalHT)} HT — ${formatEUR(quote.totalTTC)} TTC`,
    contactId: quote.contactId,
    dealId: quote.dealId,
    quoteId: quote.id,
  });
  await notify({
    userId: quote.ownerId,
    type: "QUOTE_ACCEPTED",
    title: `✅ Devis ${quote.number} accepté par ${contactDisplayName(quote.contact)}`,
    body: `${formatEUR(quote.totalHT)} HT`,
    link: `/devis/${quote.id}`,
  });
  if (quote.dealId) {
    await changeDealStage(quote.dealId, "WON", { amount: toNumber(quote.totalHT), note: `Devis ${quote.number} accepté en ligne` });
  } else {
    await db.contact.update({ where: { id: quote.contactId }, data: { status: "CUSTOMER" } });
    await notifyManagers({ type: "QUOTE_ACCEPTED", title: `Devis ${quote.number} accepté`, link: `/devis/${quote.id}` });
  }
  return updated;
}

export async function refuseQuote(token: string, reason: string | null) {
  const quote = await db.quote.findUnique({ where: { publicToken: token }, include: { contact: true } });
  if (!quote) throw new Error("Devis introuvable.");
  if (quote.status !== "SENT") throw new Error("Ce devis ne peut plus être refusé en ligne.");
  const updated = await db.quote.update({ where: { id: quote.id }, data: { status: "REFUSED", refusedAt: new Date(), refusalReason: reason?.slice(0, 2000) ?? null } });
  await logActivity({
    type: "QUOTE_REFUSED",
    title: `Devis ${quote.number} refusé en ligne`,
    body: reason ?? null,
    contactId: quote.contactId,
    dealId: quote.dealId,
    quoteId: quote.id,
  });
  await notify({
    userId: quote.ownerId,
    type: "QUOTE_REFUSED",
    title: `Devis ${quote.number} refusé par ${contactDisplayName(quote.contact)}`,
    body: reason ?? "Aucun motif indiqué",
    link: `/devis/${quote.id}`,
  });
  const { createTask } = await import("@/lib/tasks");
  await createTask({
    title: `Comprendre le refus du devis ${quote.number} (${contactDisplayName(quote.contact)})`,
    description: reason ? `Motif indiqué : ${reason}` : null,
    type: "CALL",
    priority: "HIGH",
    source: "SYSTEM",
    dueAt: new Date(),
    assigneeId: quote.ownerId,
    contactId: quote.contactId,
    dealId: quote.dealId,
  });
  if (quote.dealId) await refreshDealNextAction(quote.dealId);
  return updated;
}

/** Statut manuel (devis signé sur papier, refus par téléphone…) */
export async function setQuoteStatus(quoteId: string, status: "ACCEPTED" | "REFUSED" | "DRAFT", byUserId: string, reason?: string | null) {
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
  if (status === "ACCEPTED") {
    await db.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName: "Saisi par le commercial" } });
    await logActivity({ type: "QUOTE_ACCEPTED", title: `Devis ${quote.number} accepté`, contactId: quote.contactId, dealId: quote.dealId, userId: byUserId, quoteId });
    if (quote.dealId) await changeDealStage(quote.dealId, "WON", { userId: byUserId, amount: toNumber(quote.totalHT), note: `Devis ${quote.number} accepté` });
  } else if (status === "REFUSED") {
    await db.quote.update({ where: { id: quoteId }, data: { status: "REFUSED", refusedAt: new Date(), refusalReason: reason ?? null } });
    await logActivity({ type: "QUOTE_REFUSED", title: `Devis ${quote.number} refusé`, body: reason ?? null, contactId: quote.contactId, dealId: quote.dealId, userId: byUserId, quoteId });
  } else {
    await db.quote.update({ where: { id: quoteId }, data: { status: "DRAFT", sentAt: null } });
  }
}

/** Devis envoyés arrivés à expiration : statut « expiré » et tâche de relance. */
export async function expireQuotes(): Promise<number> {
  const expired = await db.quote.findMany({
    where: { status: "SENT", validUntil: { lt: new Date() } },
    include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
    take: 100,
  });
  const { createTask } = await import("@/lib/tasks");
  for (const q of expired) {
    await db.quote.update({ where: { id: q.id }, data: { status: "EXPIRED" } });
    await logActivity({ type: "SYSTEM", title: `Devis ${q.number} expiré`, contactId: q.contactId, dealId: q.dealId, quoteId: q.id });
    await createTask({
      title: `Devis ${q.number} expiré : relancer ${contactDisplayName(q.contact)}`,
      type: "FOLLOW_UP",
      priority: "HIGH",
      source: "SYSTEM",
      dueAt: new Date(),
      assigneeId: q.ownerId,
      contactId: q.contactId,
      dealId: q.dealId,
    });
  }
  return expired.length;
}
