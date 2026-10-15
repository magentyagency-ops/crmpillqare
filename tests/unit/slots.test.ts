import { describe, expect, it } from "vitest";
import { DEFAULT_WORKING_HOURS, generateSlots, parseWorkingHours } from "@/lib/booking/slots";

const paris = (iso: string) => new Date(iso); // ISO avec décalage explicite
const hhmm = (d: Date) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(d);

const base = {
  workingHours: DEFAULT_WORKING_HOURS,
  durationMin: 30,
  bufferMin: 10,
  minNoticeHours: 4,
  maxDaysAhead: 30,
  tz: "Europe/Paris",
  days: 7,
  busy: [],
};

describe("generateSlots", () => {
  it("propose des créneaux de 30 min dans les horaires de travail, jamais le week-end", () => {
    const now = paris("2026-10-05T07:00:00+02:00"); // lundi 7 h
    const days = generateSlots({ ...base, from: now, now });
    const monday = days[0]!;
    expect(monday.day).toBe("2026-10-05");
    // délai minimum de 4 h : premier créneau à 11 h
    expect(hhmm(monday.slots[0]!)).toBe("11:00");
    expect(monday.slots.map(hhmm)).toContain("14:00");
    expect(monday.slots.map(hhmm)).not.toContain("12:30"); // 12:30-13:00 hors plage (pause)
    expect(monday.slots.map(hhmm).at(-1)).toBe("17:30");
    const saturday = days.find((d) => d.day === "2026-10-10")!;
    expect(saturday.slots).toHaveLength(0);
  });

  it("respecte les RDV existants avec la pause entre deux RDV", () => {
    const now = paris("2026-10-04T12:00:00+02:00");
    const busy = [{ start: paris("2026-10-06T10:30:00+02:00"), end: paris("2026-10-06T11:15:00+02:00") }];
    const tuesday = generateSlots({ ...base, from: paris("2026-10-06T00:00:00+02:00"), days: 1, now, busy })[0]!;
    const times = tuesday.slots.map(hhmm);
    expect(times).toContain("09:30"); // fin 10:00 + 10 min < 10:30
    expect(times).not.toContain("10:00"); // fin 10:30 + pause chevauche
    expect(times).not.toContain("11:00");
    expect(times).toContain("11:30"); // 11:15 + 10 min de pause
  });

  it("ne propose rien au-delà de la limite de réservation", () => {
    const now = paris("2026-10-05T08:00:00+02:00");
    const days = generateSlots({ ...base, maxDaysAhead: 2, from: now, now, days: 7 });
    expect(days.find((d) => d.day === "2026-10-08")!.slots).toHaveLength(0);
    expect(days.find((d) => d.day === "2026-10-07")!.slots.length).toBeGreaterThan(0);
  });

  it("garde les heures locales justes le jour du passage à l'heure d'hiver", () => {
    const hours = { ...DEFAULT_WORKING_HOURS, "0": [["09:00", "10:00"]] as [string, string][] };
    const now = paris("2026-10-20T08:00:00+02:00");
    const sunday = generateSlots({ ...base, workingHours: hours, from: paris("2026-10-25T00:00:00+02:00"), days: 1, now })[0]!;
    expect(sunday.day).toBe("2026-10-25");
    expect(sunday.slots.map(hhmm)).toEqual(["09:00", "09:30"]);
    expect(sunday.slots[0]!.toISOString()).toBe("2026-10-25T08:00:00.000Z"); // UTC+1 après le changement
  });

  it("ignore les plages horaires invalides", () => {
    const parsed = parseWorkingHours({ "1": [["09:00", "12:00"], ["14:00", "13:00"], ["bad", "18:00"]] });
    expect(parsed["1"]).toEqual([["09:00", "12:00"]]);
    expect(parsed["6"]).toEqual([]);
  });
});
