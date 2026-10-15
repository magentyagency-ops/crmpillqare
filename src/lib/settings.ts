import type { DealStage } from "@/generated/prisma/enums";
import { db } from "./db";

/**
 * Paramètres de l'entreprise stockés en base (table Setting), avec valeurs par défaut typées.
 */

export type CompanySettings = {
  name: string;
  legalName: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  siret: string;
  vatNumber: string;
  iban: string;
  bic: string;
  logoUrl: string;
};

export type QuoteSettings = {
  prefix: string;
  validityDays: number;
  defaultTerms: string;
  defaultNotes: string;
  footer: string;
};

export type PipelineSettings = {
  /** Un dossier sans activité depuis N jours est considéré bloqué */
  staleDays: number;
  /** Exiger une prochaine action datée sur les dossiers ouverts */
  requireNextAction: boolean;
  /** Durée maximale conseillée par étape (jours) avant alerte */
  stageMaxDays: Partial<Record<DealStage, number>>;
};

export type FollowUpSettings = {
  /** Un email de relance est « sans réponse » après N jours */
  noReplyDays: number;
  windowStart: string;
  windowEnd: string;
  skipWeekends: boolean;
  unsubscribeFooter: boolean;
  /** Créer une tâche « Répondre » quand un prospect répond */
  replyTask: boolean;
};

export type AssignmentSettings = {
  /** Commercial par défaut pour les leads hors formulaire (Shopify, emails entrants…) */
  defaultOwnerId: string | null;
  /** Curseur du tour de rôle */
  lastAssignedUserId: string | null;
};

export type VisibilitySettings = {
  /** false : un commercial ne voit que ses contacts et dossiers */
  salesSeeAll: boolean;
};

export type MeetingSettings = {
  reminder24h: boolean;
  reminder1h: boolean;
  /** Créer une tâche « Compte rendu » après chaque RDV sans CR */
  reportTask: boolean;
  /** Récupérer automatiquement la transcription Google Meet et générer le CR */
  autoReportFromMeet: boolean;
};

export type DigestSettings = {
  enabled: boolean;
  /** Heure d'envoi du planning quotidien (HH:mm) */
  hour: string;
  /** Email de synthèse hebdomadaire aux managers */
  managerWeekly: boolean;
};

export type ShopifySettings = {
  postPurchaseEnabled: boolean;
  /** Créer les clients Shopify sans commande */
  importCustomersWithoutOrders: boolean;
};

export type AiSettings = {
  /** Contexte produit transmis à l'IA pour les comptes rendus */
  productContext: string;
  followUpTone: string;
};

export type SettingsMap = {
  company: CompanySettings;
  quotes: QuoteSettings;
  pipeline: PipelineSettings;
  followups: FollowUpSettings;
  assignment: AssignmentSettings;
  visibility: VisibilitySettings;
  meetings: MeetingSettings;
  digest: DigestSettings;
  shopify: ShopifySettings;
  ai: AiSettings;
};

export const DEFAULT_SETTINGS: SettingsMap = {
  company: {
    name: "PillQare",
    legalName: "PillQare",
    address: "",
    postalCode: "",
    city: "",
    country: "France",
    phone: "",
    email: "",
    website: "https://pillqare.com",
    siret: "",
    vatNumber: "",
    iban: "",
    bic: "",
    logoUrl: "",
  },
  quotes: {
    prefix: "DEV",
    validityDays: 30,
    defaultTerms:
      "Devis valable pendant la durée indiquée. Paiement à 30 jours à réception de facture. Livraison sous 10 jours ouvrés après acceptation.",
    defaultNotes: "",
    footer: "Merci de votre confiance.",
  },
  pipeline: {
    staleDays: 14,
    requireNextAction: true,
    stageMaxDays: { PROSPECT: 7, CONTACTED: 14, MEETING: 14, QUOTE: 21, FOLLOW_UP: 30 },
  },
  followups: {
    noReplyDays: 3,
    windowStart: "09:00",
    windowEnd: "18:30",
    skipWeekends: true,
    unsubscribeFooter: true,
    replyTask: true,
  },
  assignment: { defaultOwnerId: null, lastAssignedUserId: null },
  visibility: { salesSeeAll: true },
  meetings: { reminder24h: true, reminder1h: true, reportTask: true, autoReportFromMeet: true },
  digest: { enabled: true, hour: "07:30", managerWeekly: true },
  shopify: { postPurchaseEnabled: true, importCustomersWithoutOrders: true },
  ai: {
    productContext:
      "PillQare est une solution française de gestion des médicaments : un pilulier connecté (21 capsules numérotées, application mobile, rappels de prise, alertes aux aidants en cas d'oubli) et un distributeur automatique optionnel. Offres : Pilulier PillQare (69 € TTC) et Pilulier + Distributeur (799 € TTC), sans abonnement obligatoire. Cibles : particuliers (patients, aidants familiaux) et professionnels (pharmacies, EHPAD, résidences seniors, SSIAD/SAAD, infirmiers libéraux, établissements de santé, mutuelles).",
    followUpTone: "professionnel, chaleureux et concis, vouvoiement",
  },
};

type CacheEntry = { value: unknown; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15_000;

function merge<T>(defaults: T, stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k];
    if (d && typeof d === "object" && !Array.isArray(d) && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...(d as object), ...(v as object) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function getSettings<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as SettingsMap[K];
  const row = await db.setting.findUnique({ where: { key } });
  const value = merge(DEFAULT_SETTINGS[key], row?.value);
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function updateSettings<K extends keyof SettingsMap>(key: K, patch: Partial<SettingsMap[K]>): Promise<SettingsMap[K]> {
  const current = await getSettings(key);
  const next = { ...current, ...patch } as SettingsMap[K];
  await db.setting.upsert({
    where: { key },
    create: { key, value: next as object },
    update: { value: next as object },
  });
  cache.set(key, { value: next, expires: Date.now() + TTL_MS });
  return next;
}

export function invalidateSettingsCache() {
  cache.clear();
}
