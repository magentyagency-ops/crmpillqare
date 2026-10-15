"use server";

import { db } from "@/lib/db";
import { assertUser, isManager } from "@/lib/auth/guards";

/** Exemples réels (contact, dossier) pour les étapes « fiche » du guide interactif. */
export async function guideSamplesAction(): Promise<{ contactId: string | null; dealId: string | null }> {
  const user = await assertUser();
  const mine = isManager(user) ? {} : { ownerId: user.id };
  const [deal, contact] = await Promise.all([
    db.deal.findFirst({ where: { ...mine, wonAt: null, lostAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, contactId: true } }),
    db.contact.findFirst({ where: { ...mine, archivedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } }),
  ]);
  return { contactId: deal?.contactId ?? contact?.id ?? null, dealId: deal?.id ?? null };
}
