"use server";

import { db } from "@/lib/db";
import { assertUser, ownerScope } from "@/lib/auth/guards";
import { runAction, type ActionResult } from "@/lib/actions";
import { contactDisplayName, STAGE_LABELS } from "@/lib/labels";
import { allWords, contactSearchWhere } from "@/lib/search";

export type SearchResult = { type: "contact" | "company" | "deal" | "quote" | "order"; id: string; title: string; subtitle: string | null; href: string };

/** Recherche globale (⌘K) : contacts, organisations, dossiers, devis, commandes. */
export async function globalSearchAction(q: string): Promise<SearchResult[]> {
  const user = await assertUser();
  const term = q.trim();
  if (term.length < 2) return [];
  const scope = await ownerScope(user);
  const [contacts, companies, deals, quotes, orders] = await Promise.all([
    db.contact.findMany({
      where: { ...scope, ...contactSearchWhere(term) },
      take: 8,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, archivedAt: true, company: { select: { name: true } } },
    }),
    db.company.findMany({ where: { name: { contains: term, mode: "insensitive" } }, take: 5, select: { id: true, name: true, city: true } }),
    db.deal.findMany({ where: { ...scope, ...allWords(term, (w) => ({ title: { contains: w, mode: "insensitive" as const } })) }, take: 6, select: { id: true, title: true, stage: true } }),
    db.quote.findMany({ where: { ...scope, number: { contains: term, mode: "insensitive" } }, take: 4, select: { id: true, number: true, title: true } }),
    db.order.findMany({ where: { number: { contains: term, mode: "insensitive" } }, take: 4, select: { id: true, number: true } }),
  ]);
  return [
    ...contacts.map((c) => ({
      type: "contact" as const,
      id: c.id,
      title: contactDisplayName(c) + (c.archivedAt ? " (archivé)" : ""),
      subtitle: [c.company?.name, c.email, c.phone].filter(Boolean).join(" · ") || null,
      href: `/contacts/${c.id}`,
    })),
    ...companies.map((c) => ({ type: "company" as const, id: c.id, title: c.name, subtitle: c.city, href: `/organisations/${c.id}` })),
    ...deals.map((d) => ({ type: "deal" as const, id: d.id, title: d.title, subtitle: STAGE_LABELS[d.stage], href: `/pipeline/${d.id}` })),
    ...quotes.map((q2) => ({ type: "quote" as const, id: q2.id, title: `Devis ${q2.number}`, subtitle: q2.title, href: `/devis/${q2.id}` })),
    ...orders.map((o) => ({ type: "order" as const, id: o.id, title: `Commande ${o.number}`, subtitle: null, href: `/commandes/${o.id}` })),
  ];
}

export async function getNotificationsAction() {
  const user = await assertUser();
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsReadAction(ids?: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  });
}
