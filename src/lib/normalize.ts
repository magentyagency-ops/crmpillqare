import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Email normalisé pour le dédoublonnage (minuscules, sans espaces). */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** Téléphone au format E.164 (+33612345678), pays par défaut : France. */
export function normalizePhone(phone: string | null | undefined, defaultCountry: "FR" | "BE" | "CH" | "LU" | "CA" = "FR"): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 6) return null;
  const parsed = parsePhoneNumberFromString(cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned, defaultCountry);
  if (parsed && parsed.isPossible()) return parsed.number;
  return cleaned;
}

/** Affichage lisible d'un numéro (06 12 34 56 78 / +32 …) */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const parsed = parsePhoneNumberFromString(phone, "FR");
  if (!parsed) return phone;
  return parsed.country === "FR" ? parsed.formatNational() : parsed.formatInternational();
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  return e.split("@")[1] ?? null;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.fr", "yahoo.com", "hotmail.fr", "hotmail.com", "outlook.fr", "outlook.com",
  "live.fr", "live.com", "msn.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net",
  "icloud.com", "me.com", "aol.com", "bbox.fr", "gmx.fr", "gmx.com", "protonmail.com", "proton.me", "numericable.fr",
]);

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Sépare « Jean Dupont » en prénom / nom */
export function splitFullName(full: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") };
}

export function capitalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim();
  if (!t) return null;
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
