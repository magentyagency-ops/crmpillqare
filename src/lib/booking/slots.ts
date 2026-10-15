import { addDaysTz, dayKey, startOfDayTz, weekdayTz, zonedDateTime } from "@/lib/dates";

/** Plages de travail par jour de semaine (0 = dimanche … 6 = samedi), heures locales « HH:mm ». */
export type WorkingHours = Record<string, [string, string][]>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  "1": [["09:00", "12:30"], ["14:00", "18:00"]],
  "2": [["09:00", "12:30"], ["14:00", "18:00"]],
  "3": [["09:00", "12:30"], ["14:00", "18:00"]],
  "4": [["09:00", "12:30"], ["14:00", "18:00"]],
  "5": [["09:00", "12:30"], ["14:00", "17:00"]],
  "6": [],
  "0": [],
};

export const WEEKDAY_LABELS: Record<string, string> = {
  "1": "Lundi",
  "2": "Mardi",
  "3": "Mercredi",
  "4": "Jeudi",
  "5": "Vendredi",
  "6": "Samedi",
  "0": "Dimanche",
};

export function parseWorkingHours(value: unknown): WorkingHours {
  if (!value || typeof value !== "object") return DEFAULT_WORKING_HOURS;
  const out: WorkingHours = {};
  for (const d of ["0", "1", "2", "3", "4", "5", "6"]) {
    const ranges = (value as Record<string, unknown>)[d];
    out[d] = Array.isArray(ranges)
      ? ranges.filter(
          (r): r is [string, string] =>
            Array.isArray(r) && r.length === 2 && /^\d{2}:\d{2}$/.test(String(r[0])) && /^\d{2}:\d{2}$/.test(String(r[1])) && r[0] < r[1],
        )
      : [];
  }
  return out;
}

export type Interval = { start: Date; end: Date };

export type SlotOptions = {
  workingHours: WorkingHours;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  tz: string;
  /** Jour de départ (inclus) */
  from: Date;
  days: number;
  busy: Interval[];
  now?: Date;
  stepMin?: number;
};

export type DaySlots = { day: string; slots: Date[] };

/** Calcule les créneaux disponibles (fonction pure, testée unitairement). */
export function generateSlots(opts: SlotOptions): DaySlots[] {
  const now = opts.now ?? new Date();
  const step = opts.stepMin ?? Math.min(30, opts.durationMin);
  const earliest = now.getTime() + opts.minNoticeHours * 3600_000;
  const latest = startOfDayTz(addDaysTz(now, opts.maxDaysAhead + 1, opts.tz), opts.tz).getTime();
  const bufferMs = opts.bufferMin * 60_000;
  const durationMs = opts.durationMin * 60_000;
  const result: DaySlots[] = [];

  let cursor = startOfDayTz(opts.from, opts.tz);
  for (let i = 0; i < opts.days; i++) {
    const day = dayKey(cursor, opts.tz);
    const ranges = opts.workingHours[String(weekdayTz(cursor, opts.tz))] ?? [];
    const slots: Date[] = [];
    for (const [startStr, endStr] of ranges) {
      const rangeStart = zonedDateTime(day, startStr, opts.tz).getTime();
      const rangeEnd = zonedDateTime(day, endStr, opts.tz).getTime();
      for (let t = rangeStart; t + durationMs <= rangeEnd; t += step * 60_000) {
        if (t < earliest || t >= latest) continue;
        const end = t + durationMs;
        const conflict = opts.busy.some((b) => t < b.end.getTime() + bufferMs && end + bufferMs > b.start.getTime());
        if (!conflict) slots.push(new Date(t));
      }
    }
    result.push({ day, slots });
    cursor = addDaysTz(cursor, 1, opts.tz);
  }
  return result;
}
