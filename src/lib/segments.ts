import type { ContactKind } from "@/generated/prisma/enums";
import { db } from "./db";

/**
 * Détection automatique de la cible (segment) d'un contact à partir des informations reçues :
 * champ « cible » du formulaire, nom de l'organisation, fonction, puis message libre.
 * Chaque cible est reconnue par son nom et par ses mots-clés (Paramètres → Référentiels).
 */

export type SegmentCandidate = { id: string; name: string; kind: ContactKind; keywords: string[]; position: number };

const NAME_STOPWORDS = new Set(["les", "des", "aux", "pour", "avec", "sans", "autre", "autres", "sante", "service", "services", "professionnel", "professionnels"]);

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("aux")) return `${word.slice(0, -3)}al`;
  if (word.length > 3 && /[sx]$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Texte normalisé pour la comparaison : minuscules, sans accents ni ponctuation, mots au singulier. */
export function normalizeForMatch(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singular);
  return words.join(" ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

/** Termes reconnus pour une cible : mots-clés, et (sauf mode prudent) son nom et les mots significatifs du nom. */
function termsFor(segment: SegmentCandidate, keywordsOnly: boolean): string[] {
  const terms = new Set<string>();
  for (const k of segment.keywords) {
    const t = normalizeForMatch(k);
    if (t) terms.add(t);
  }
  if (!keywordsOnly) {
    const name = normalizeForMatch(segment.name);
    if (name) terms.add(name);
    for (const w of name.split(" ")) if (w.length >= 4 && !NAME_STOPWORDS.has(w)) terms.add(w);
  }
  return [...terms];
}

/** Meilleure cible pour un texte : nombre de mots-clés reconnus, puis ordre d'affichage des cibles. */
export function matchSegment(text: string | null | undefined, segments: SegmentCandidate[], opts: { kind?: ContactKind | null; keywordsOnly?: boolean } = {}): SegmentCandidate | null {
  if (!text?.trim()) return null;
  const haystack = normalizeForMatch(text);
  if (!haystack) return null;
  let best: { segment: SegmentCandidate; score: number } | null = null;
  for (const segment of segments) {
    if (opts.kind && segment.kind !== opts.kind) continue;
    // Nom exact de la cible (ex. valeur d'une liste déroulante) : correspondance immédiate
    if (normalizeForMatch(segment.name) === haystack) return segment;
    const score = termsFor(segment, opts.keywordsOnly ?? false).filter((t) => containsPhrase(haystack, t)).length;
    if (score > 0 && (!best || score > best.score || (score === best.score && segment.position < best.segment.position))) {
      best = { segment, score };
    }
  }
  return best?.segment ?? null;
}

export type SegmentSignals = {
  /** Valeur explicite envoyée (champ « cible », « vous êtes »…) */
  explicit?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  message?: string | null;
};

/**
 * Détecte la cible, du signal le plus fiable au moins fiable :
 * 1. cible indiquée explicitement (liste « Vous êtes… ») ;
 * 2. nom de l'organisation (une organisation est toujours B2B) ;
 * 3. cible par défaut du formulaire ou de l'import ;
 * 4. message libre (mots-clés configurés uniquement) ;
 * 5. fonction de la personne (une infirmière peut travailler en EHPAD, SSIAD, clinique…).
 * `kind` restreint les étapes 4 et 5 aux cibles du bon type (B2B/B2C).
 */
export function detectSegment(
  signals: SegmentSignals,
  segments: SegmentCandidate[],
  opts: { kind?: ContactKind | null; defaultId?: string | null } = {},
): SegmentCandidate | null {
  return (
    matchSegment(signals.explicit, segments) ??
    matchSegment(signals.company, segments, { kind: "B2B" }) ??
    (opts.defaultId ? (segments.find((s) => s.id === opts.defaultId) ?? null) : null) ??
    matchSegment(signals.message, segments, { kind: opts.kind, keywordsOnly: true }) ??
    matchSegment(signals.jobTitle, segments, { kind: opts.kind })
  );
}

export async function loadSegmentCandidates(): Promise<SegmentCandidate[]> {
  return db.segment.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
    select: { id: true, name: true, kind: true, keywords: true, position: true },
  });
}
