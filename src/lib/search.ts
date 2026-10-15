import type { Prisma } from "@/generated/prisma/client";

/** Mots d'une recherche libre (6 au maximum). */
export function searchTokens(q: string | null | undefined): string[] {
  return (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * Recherche d'une personne : chaque mot doit se retrouver dans le prénom, le nom, l'email ou l'organisation
 * (« Marc Petit », « petit marc », « pharmacie lilas »…). Un numéro de téléphone est aussi reconnu.
 */
export function contactSearchWhere(q: string): Prisma.ContactWhereInput {
  const tokens = searchTokens(q);
  if (!tokens.length) return {};
  const word = (t: string): Prisma.ContactWhereInput => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" } },
      { lastName: { contains: t, mode: "insensitive" } },
      { email: { contains: t, mode: "insensitive" } },
      { company: { name: { contains: t, mode: "insensitive" } } },
    ],
  });
  const digits = q.replace(/\D/g, "");
  return {
    OR: [{ AND: tokens.map(word) }, ...(digits.length >= 4 ? [{ phoneNormalized: { contains: digits.slice(-9) } }] : [])],
  };
}

/** Tous les mots doivent correspondre (ex. titre d'un dossier : « ehpad roses »). */
export function allWords<T>(q: string, build: (word: string) => T): { AND: T[] } {
  return { AND: searchTokens(q).map(build) };
}
