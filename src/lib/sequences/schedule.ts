import { addDaysTz, clampToBusinessWindow, dayKey, zonedDateTime } from "@/lib/dates";

export type StepTiming = { position: number; delayDays: number; delayHours: number; delayMinutes?: number; sendTime: string | null };

/** `businessHours: false` : pas de recadrage en heures ouvrées (série ponctuelle, ex. relances à la minute). */
export type WindowOptions = { windowStart: string; windowEnd: string; skipWeekends: boolean; tz?: string | null; businessHours?: boolean };

/**
 * Calcule la date d'exécution d'une étape à partir de la précédente :
 * + délai (jours / heures), heure d'envoi préférée, puis recadrage en heures ouvrées.
 */
export function nextStepDate(previous: Date, step: StepTiming, opts: WindowOptions): Date {
  const window = { start: opts.windowStart, end: opts.windowEnd, skipWeekends: opts.skipWeekends, tz: opts.tz };
  const minutes = step.delayMinutes ?? 0;
  let d = previous;
  if (step.delayDays) d = addDaysTz(d, step.delayDays, opts.tz);
  if (step.delayHours) d = new Date(d.getTime() + step.delayHours * 3600_000);
  if (minutes) d = new Date(d.getTime() + minutes * 60_000);
  if (opts.businessHours === false) return d;
  const preferredTime = step.sendTime && /^\d{1,2}:\d{2}$/.test(step.sendTime) && minutes === 0 && (step.delayDays > 0 || step.delayHours === 0) ? step.sendTime : null;
  if (preferredTime) {
    const candidate = zonedDateTime(dayKey(d, opts.tz), preferredTime, opts.tz);
    // Ne jamais planifier avant l'étape précédente
    d = candidate.getTime() >= previous.getTime() ? candidate : d;
  }
  const clamped = clampToBusinessWindow(d, window);
  // Reporté à un autre jour (week-end, soirée) : l'heure d'envoi préférée est conservée si elle est dans la plage
  if (preferredTime && dayKey(clamped, opts.tz) !== dayKey(d, opts.tz)) {
    const sameDay = clampToBusinessWindow(zonedDateTime(dayKey(clamped, opts.tz), preferredTime, opts.tz), window);
    if (dayKey(sameDay, opts.tz) === dayKey(clamped, opts.tz)) return sameDay;
  }
  return clamped;
}

/** Planning complet d'une séquence à partir d'une date de départ. */
export function computeSchedule(steps: StepTiming[], start: Date, opts: WindowOptions): Date[] {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const dates: Date[] = [];
  let prev = start;
  for (const step of sorted) {
    const d = nextStepDate(prev, step, opts);
    dates.push(d);
    prev = d;
  }
  return dates;
}
