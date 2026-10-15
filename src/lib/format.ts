/** Formatage des montants et nombres (fr-FR) */

type DecimalLike = { toString(): string } | number | string | null | undefined;

export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurCompact = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Espace fine insécable (U+202F) de l'usage français → espace insécable classique, rendue par toutes les polices */
const nbsp = (s: string) => s.replace(/\u202f/g, "\u00a0");

export function formatEUR(value: DecimalLike, opts: { compact?: boolean } = {}): string {
  return nbsp((opts.compact ? eurCompact : eur).format(toNumber(value)));
}

export function formatNumber(value: DecimalLike): string {
  return nbsp(num.format(toNumber(value)));
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits).replace(".", ",")} %`;
}

/** Arrondi bancaire à 2 décimales (évite 0.1 + 0.2) */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} min${s ? ` ${String(s).padStart(2, "0")} s` : ""}`;
  return `${s} s`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count > 1 ? (plural ?? `${singular}s`) : singular}`;
}

export function truncate(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
