import { fromZonedTime, formatInTimeZone, toZonedTime } from "date-fns-tz";
import { fr } from "date-fns/locale";
import { env } from "./env";

/**
 * Toutes les dates sont stockées en UTC. Les calculs « jour », « heures ouvrées » et l'affichage
 * se font explicitement dans le fuseau de l'application (Europe/Paris par défaut), indépendamment
 * du fuseau du serveur.
 */

export function appTz(tz?: string | null): string {
  return tz || env.timezone;
}

/** Clé de jour locale « yyyy-MM-dd » */
export function dayKey(date: Date, tz?: string | null): string {
  return formatInTimeZone(date, appTz(tz), "yyyy-MM-dd");
}

/** Heure locale « HH:mm » */
export function timeKey(date: Date, tz?: string | null): string {
  return formatInTimeZone(date, appTz(tz), "HH:mm");
}

/** Construit l'instant UTC correspondant à une date et une heure locales du fuseau. */
export function zonedDateTime(day: string, time: string, tz?: string | null): Date {
  const [h = "00", m = "00"] = time.split(":");
  return fromZonedTime(`${day}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`, appTz(tz));
}

export function startOfDayTz(date: Date, tz?: string | null): Date {
  return zonedDateTime(dayKey(date, tz), "00:00", tz);
}

export function endOfDayTz(date: Date, tz?: string | null): Date {
  return new Date(addDaysTz(startOfDayTz(date, tz), 1, tz).getTime() - 1);
}

/** Ajoute n jours calendaires en conservant l'heure locale (gère les changements d'heure). */
export function addDaysTz(date: Date, days: number, tz?: string | null): Date {
  const z = appTz(tz);
  const local = toZonedTime(date, z);
  local.setDate(local.getDate() + days);
  const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  return zonedDateTime(day, `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`, z);
}

/** Jour de la semaine local (0 = dimanche … 6 = samedi) */
export function weekdayTz(date: Date, tz?: string | null): number {
  return Number(formatInTimeZone(date, appTz(tz), "i")) % 7;
}

export function isWeekendTz(date: Date, tz?: string | null): boolean {
  const d = weekdayTz(date, tz);
  return d === 0 || d === 6;
}

export function startOfWeekTz(date: Date, tz?: string | null): Date {
  const wd = weekdayTz(date, tz);
  const diff = wd === 0 ? -6 : 1 - wd; // semaine du lundi
  return startOfDayTz(addDaysTz(date, diff, tz), tz);
}

export function startOfMonthTz(date: Date, tz?: string | null): Date {
  return zonedDateTime(formatInTimeZone(date, appTz(tz), "yyyy-MM-01"), "00:00", tz);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Ramène un instant dans une fenêtre d'envoi ouvrée : si l'instant est avant l'ouverture,
 * il est placé à l'ouverture ; après la fermeture ou un week-end, au prochain jour ouvré.
 */
export function clampToBusinessWindow(
  date: Date,
  opts: { start?: string; end?: string; skipWeekends?: boolean; tz?: string | null } = {},
): Date {
  const start = opts.start ?? "09:00";
  const end = opts.end ?? "18:30";
  const skipWeekends = opts.skipWeekends ?? true;
  const tz = opts.tz;
  let candidate = date;
  for (let i = 0; i < 14; i++) {
    const local = minutesOf(timeKey(candidate, tz));
    if (skipWeekends && isWeekendTz(candidate, tz)) {
      candidate = zonedDateTime(dayKey(addDaysTz(candidate, 1, tz), tz), start, tz);
      continue;
    }
    if (local < minutesOf(start)) return zonedDateTime(dayKey(candidate, tz), start, tz);
    if (local >= minutesOf(end)) {
      candidate = zonedDateTime(dayKey(addDaysTz(candidate, 1, tz), tz), start, tz);
      continue;
    }
    return candidate;
  }
  return candidate;
}

/** Ajoute des jours ouvrés (lundi → vendredi) en conservant l'heure locale. */
export function addBusinessDaysTz(date: Date, days: number, tz?: string | null): Date {
  let d = date;
  const step = days < 0 ? -1 : 1;
  let added = 0;
  while (added < Math.abs(days)) {
    d = addDaysTz(d, step, tz);
    if (!isWeekendTz(d, tz)) added++;
  }
  return d;
}

// ───────────── Formatage (français) ─────────────

export function formatDate(date: Date | null | undefined, pattern = "d MMM yyyy", tz?: string | null): string {
  if (!date) return "—";
  return formatInTimeZone(date, appTz(tz), pattern, { locale: fr });
}

export function formatDateTime(date: Date | null | undefined, tz?: string | null): string {
  if (!date) return "—";
  return formatInTimeZone(date, appTz(tz), "d MMM yyyy 'à' HH:mm", { locale: fr });
}

export function formatTime(date: Date | null | undefined, tz?: string | null): string {
  if (!date) return "—";
  return formatInTimeZone(date, appTz(tz), "HH:mm", { locale: fr });
}

export function formatLongDate(date: Date, tz?: string | null): string {
  return formatInTimeZone(date, appTz(tz), "EEEE d MMMM yyyy", { locale: fr });
}

/** « aujourd'hui 14:30 », « demain 09:00 », « hier », « lun. 12 oct. » … */
export function formatSmart(date: Date | null | undefined, opts: { withTime?: boolean; tz?: string | null; now?: Date } = {}): string {
  if (!date) return "—";
  const tz = opts.tz;
  const now = opts.now ?? new Date();
  const withTime = opts.withTime ?? true;
  const today = dayKey(now, tz);
  const d = dayKey(date, tz);
  const time = withTime ? ` ${formatTime(date, tz)}` : "";
  if (d === today) return `aujourd'hui${time}`;
  if (d === dayKey(addDaysTz(now, 1, tz), tz)) return `demain${time}`;
  if (d === dayKey(addDaysTz(now, -1, tz), tz)) return `hier${time}`;
  const sameYear = d.slice(0, 4) === today.slice(0, 4);
  return formatInTimeZone(date, appTz(tz), sameYear ? "EEE d MMM" : "d MMM yyyy", { locale: fr }) + time;
}

/** « il y a 3 j », « dans 2 h » */
export function formatRelative(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const min = Math.round(abs / 60000);
  let label: string;
  if (min < 1) return "à l'instant";
  if (min < 60) label = `${min} min`;
  else if (min < 60 * 24) label = `${Math.round(min / 60)} h`;
  else if (min < 60 * 24 * 30) label = `${Math.round(min / (60 * 24))} j`;
  else if (min < 60 * 24 * 365) label = `${Math.round(min / (60 * 24 * 30))} mois`;
  else label = `${Math.round(min / (60 * 24 * 365))} an(s)`;
  return future ? `dans ${label}` : `il y a ${label}`;
}

/** Valeur pour <input type="datetime-local"> dans le fuseau de l'application */
export function toDateTimeLocalValue(date: Date | null | undefined, tz?: string | null): string {
  if (!date) return "";
  return formatInTimeZone(date, appTz(tz), "yyyy-MM-dd'T'HH:mm");
}

/** Valeur pour <input type="date"> */
export function toDateInputValue(date: Date | null | undefined, tz?: string | null): string {
  if (!date) return "";
  return formatInTimeZone(date, appTz(tz), "yyyy-MM-dd");
}

/** Interprète une valeur « yyyy-MM-ddTHH:mm » saisie dans le fuseau de l'application */
export function parseDateTimeLocal(value: string | null | undefined, tz?: string | null): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!m) return null;
  return zonedDateTime(m[1]!, m[2] ?? "09:00", tz);
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

/** Instant situé n jours avant maintenant (utilitaire des composants serveur). */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Instant courant (utilitaire des composants serveur). */
export function nowDate(): Date {
  return new Date();
}
