import type { Prisma } from "@/generated/prisma/client";
import { contactSearchWhere, searchTokens } from "./search";

export type ContactSearch = { q?: string; statut?: string; owner?: string; segment?: string; kind?: string; source?: string; tag?: string; page?: string };

/** Filtres de la liste des contacts (page et export CSV). */
export function contactsWhere(sp: ContactSearch, userId: string, scope: Record<string, string>): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { ...scope };
  if (sp.statut === "archives") where.archivedAt = { not: null };
  else {
    where.archivedAt = null;
    if (sp.statut === "prospects") where.status = "PROSPECT";
    if (sp.statut === "clients") where.status = "CUSTOMER";
  }
  if (sp.owner === "me") where.ownerId = userId;
  else if (sp.owner) where.ownerId = sp.owner;
  if (sp.segment) where.segmentId = sp.segment === "none" ? null : sp.segment;
  if (sp.kind === "B2B" || sp.kind === "B2C") where.kind = sp.kind;
  if (sp.tag?.trim()) where.tags = { has: sp.tag.trim() };
  if (sp.source) where.source = sp.source as Prisma.EnumContactSourceFilter["equals"];
  if (sp.q?.trim()) {
    const q = sp.q.trim();
    // Mots-clés : chaque mot doit apparaître dans au moins un champ (nom, email, organisation, fonction, ville, notes, étiquettes…)
    const word = (t: string): Prisma.ContactWhereInput => ({
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
        { email: { contains: t, mode: "insensitive" } },
        { company: { name: { contains: t, mode: "insensitive" } } },
        { jobTitle: { contains: t, mode: "insensitive" } },
        { city: { contains: t, mode: "insensitive" } },
        { postalCode: { startsWith: t } },
        { notes: { contains: t, mode: "insensitive" } },
        { tags: { has: t.toLowerCase() } },
        { segment: { name: { contains: t, mode: "insensitive" } } },
      ],
    });
    where.AND = [{ OR: [contactSearchWhere(q), { AND: searchTokens(q).map(word) }] }];
  }
  return where;
}

