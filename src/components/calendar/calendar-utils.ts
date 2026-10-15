import { DateTime } from "luxon";
import type { CalendarEventInfo } from "@/actions/calendar";

/** Couleurs inspirées de Google Agenda (Paon, Banane, Lavande…). */
export const LAYER_COLORS = {
  meeting: "#039BE5",
  task: "#F6BF26",
  step: "#7986CB",
} as const;

export type Layer = keyof typeof LAYER_COLORS;

export const LAYER_LABELS: Record<Layer, string> = {
  meeting: "Rendez-vous",
  task: "Tâches et appels",
  step: "Relances automatiques",
};

export type CalView = "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "listWeek";

export const VIEWS: { id: CalView; label: string; key: string }[] = [
  { id: "timeGridDay", label: "Jour", key: "D" },
  { id: "timeGridWeek", label: "Semaine", key: "W" },
  { id: "dayGridMonth", label: "Mois", key: "M" },
  { id: "listWeek", label: "Planning", key: "A" },
];

/** Événement sélectionné (fiche au clic). */
export type SelectedEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  color: string;
  info: CalendarEventInfo;
};

export const inTz = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).setLocale("fr");

/** Valeur « AAAA-MM-JJTHH:mm » dans le fuseau de l'utilisateur (format attendu par les actions serveur). */
export const toLocalValue = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm");

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** « 9:30 – 10:00 » (format français de Google Agenda). */
export function timeRange(start: Date, end: Date | null, tz: string) {
  const s = inTz(start, tz).toFormat("HH:mm");
  return end ? `${s} – ${inTz(end, tz).toFormat("HH:mm")}` : s;
}

/** Titre de la barre d'outils : « Octobre 2026 », « Sept. – oct. 2026 », « Mercredi 14 octobre 2026 ». */
export function viewTitle(view: string, start: Date, end: Date, tz: string) {
  const a = inTz(start, tz);
  const b = inTz(end, tz).minus({ days: 1 });
  if (view === "timeGridDay") return capitalize(a.toFormat("cccc d LLLL yyyy"));
  if (view === "dayGridMonth") {
    // La vue mois commence parfois la semaine précédente : on prend le milieu de la plage
    const mid = inTz(new Date((start.getTime() + end.getTime()) / 2), tz);
    return capitalize(mid.toFormat("LLLL yyyy"));
  }
  if (a.hasSame(b, "month")) return capitalize(a.toFormat("LLLL yyyy"));
  const short = (d: DateTime) => d.toFormat("LLL").replace(/\.$/, "") + ".";
  if (a.hasSame(b, "year")) return capitalize(`${short(a)} – ${short(b)} ${b.year}`);
  return capitalize(`${short(a)} ${a.year} – ${short(b)} ${b.year}`);
}

/** Créneau par défaut : prochaine demi-heure (ou 10 h un autre jour). */
export function defaultSlot(day: string, tz: string) {
  const now = DateTime.now().setZone(tz);
  if (day === now.toISODate()) {
    const next = now.plus({ minutes: 30 - (now.minute % 30) }).startOf("minute");
    if (next.hour < 23) return next.toFormat("HH:mm");
  }
  return "10:00";
}

export function readPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function writePrefs(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée) : préférences non conservées
  }
}
