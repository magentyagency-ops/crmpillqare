"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { acceptQuote, createQuote, defaultQuoteEmail, duplicateQuote, markQuoteViewed, refuseQuote, sendQuote, setQuoteStatus, updateQuote } from "@/lib/quotes/service";
import { getSessionUser } from "@/lib/auth/session";
import { parseDateTimeLocal } from "@/lib/dates";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { optionalNumber, optionalString } from "@/lib/validation";

const itemSchema = z.object({
  productId: optionalString,
  name: z.string().trim().min(1, "Désignation obligatoire"),
  description: optionalString,
  quantity: z.coerce.number().positive("Quantité invalide"),
  unit: optionalString,
  unitPriceHT: z.coerce.number().min(0, "Prix invalide"),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(20),
});

const quoteSchema = z.object({
  title: optionalString,
  contactId: z.string().min(1, "Contact obligatoire"),
  dealId: optionalString,
  ownerId: optionalString,
  validUntil: optionalString,
  globalDiscountPct: optionalNumber,
  notes: optionalString,
  terms: optionalString,
  items: z.array(itemSchema).min(1, "Ajoutez au moins une ligne"),
});

export type QuoteFormInput = z.input<typeof quoteSchema>;

function toInput(data: z.output<typeof quoteSchema>, ownerId: string, tz: string) {
  return {
    title: data.title,
    contactId: data.contactId,
    dealId: data.dealId,
    ownerId: data.ownerId ?? ownerId,
    validUntil: parseDateTimeLocal(data.validUntil, tz),
    globalDiscountPct: data.globalDiscountPct ?? 0,
    notes: data.notes,
    terms: data.terms,
    items: data.items.map((i) => ({ ...i, unit: i.unit ?? "unité" })),
  };
}

export async function createQuoteAction(input: QuoteFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = quoteSchema.parse(input);
    if (data.dealId) {
      const deal = await db.deal.findUniqueOrThrow({ where: { id: data.dealId }, select: { contactId: true } });
      if (deal.contactId !== data.contactId) throw new UserError("Le dossier sélectionné n'appartient pas à ce contact.");
    }
    const quote = await createQuote(toInput(data, user.id, user.timezone), user.id);
    return { id: quote.id };
  }, "Devis créé");
}

export async function updateQuoteAction(id: string, input: QuoteFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const quote = await db.quote.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, quote.ownerId);
    const data = quoteSchema.parse(input);
    await updateQuote(id, toInput(data, quote.ownerId, user.timezone));
    return { id };
  }, "Devis enregistré");
}

export async function getQuoteEmailDefaultsAction(id: string) {
  await assertUser();
  return defaultQuoteEmail(id);
}

export async function sendQuoteAction(id: string, email: { to: string; cc?: string; subject: string; body: string }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const quote = await db.quote.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, quote.ownerId);
    const split = (s?: string) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const to = split(email.to);
    if (to.length === 0) throw new UserError("Indiquez le destinataire.");
    if (!email.subject.trim() || !email.body.trim()) throw new UserError("L'objet et le message sont obligatoires.");
    await sendQuote(id, user.id, { to, cc: split(email.cc), subject: email.subject, body: email.body });
  }, "Devis envoyé avec le PDF et le lien d'acceptation en ligne");
}

export async function setQuoteStatusAction(id: string, status: "ACCEPTED" | "REFUSED" | "DRAFT", reason?: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const quote = await db.quote.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, quote.ownerId);
    await setQuoteStatus(id, status, user.id, reason);
  }, status === "ACCEPTED" ? "Devis accepté — dossier signé" : status === "REFUSED" ? "Devis marqué refusé" : "Devis repassé en brouillon");
}

export async function duplicateQuoteAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const original = await db.quote.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
    await assertCanEdit(user, original.ownerId);
    const copy = await duplicateQuote(id, user.id);
    return { id: copy.id };
  }, "Nouvelle version créée");
}

export async function deleteQuoteAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const quote = await db.quote.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, quote.ownerId);
    if (quote.status !== "DRAFT") throw new UserError("Seul un brouillon peut être supprimé.");
    await db.quote.delete({ where: { id } });
  }, "Brouillon supprimé");
}

export async function productsForQuoteAction() {
  await assertUser();
  const products = await db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return products.map((p) => ({ id: p.id, name: p.name, description: p.description, unitPriceHT: Number(p.unitPriceHT), vatRate: Number(p.vatRate), unit: p.unit, sku: p.sku }));
}

// ───────────── Actions publiques (page d'acceptation du devis) ─────────────

export async function acceptQuotePublicAction(token: string, name: string): Promise<ActionResult> {
  return runAction(async () => {
    const ip = clientIp(await headers());
    if (!(await rateLimit(`quote-accept:${ip}`, 10, 3600)).allowed) throw new UserError("Trop de tentatives, réessayez plus tard.");
    if (name.trim().length < 3) throw new UserError("Indiquez vos nom et prénom.");
    await acceptQuote(token, name.trim(), ip);
  }, "Merci ! Votre acceptation a bien été enregistrée.");
}

export async function refuseQuotePublicAction(token: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ip = clientIp(await headers());
    if (!(await rateLimit(`quote-refuse:${ip}`, 10, 3600)).allowed) throw new UserError("Trop de tentatives, réessayez plus tard.");
    await refuseQuote(token, reason.trim() || null);
  }, "Votre réponse a bien été transmise.");
}

/** Consultation du devis par le client (les utilisateurs du CRM ne déclenchent pas la notification). */
export async function markQuoteViewedAction(token: string): Promise<void> {
  if (await getSessionUser()) return;
  const ip = clientIp(await headers());
  if (!(await rateLimit(`quote-view:${ip}`, 30, 3600)).allowed) return;
  await markQuoteViewed(token);
}
