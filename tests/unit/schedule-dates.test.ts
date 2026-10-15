import { describe, expect, it } from "vitest";
import { computeSchedule } from "@/lib/sequences/schedule";
import { addBusinessDaysTz, clampToBusinessWindow, dayKey, zonedDateTime } from "@/lib/dates";

const TZ = "Europe/Paris";
const local = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
const window = { windowStart: "09:00", windowEnd: "18:30", skipWeekends: true, tz: TZ };

describe("dates (fuseau Europe/Paris, quel que soit le fuseau du serveur)", () => {
  it("convertit une heure locale en UTC, été comme hiver", () => {
    expect(zonedDateTime("2026-07-01", "09:00", TZ).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedDateTime("2026-12-01", "09:00", TZ).toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("recale dans la plage d'envoi : soir → lendemain 9 h, week-end → lundi", () => {
    expect(local(clampToBusinessWindow(new Date("2026-10-07T20:30:00Z"), { start: "09:00", end: "18:30", tz: TZ }))).toBe("jeu. 08/10 09:00");
    expect(local(clampToBusinessWindow(new Date("2026-10-10T10:00:00Z"), { start: "09:00", end: "18:30", tz: TZ }))).toBe("lun. 12/10 09:00");
    const inWindow = new Date("2026-10-07T12:00:00Z");
    expect(clampToBusinessWindow(inWindow, { tz: TZ })).toEqual(inWindow);
  });

  it("ajoute ou retire des jours ouvrés", () => {
    const wednesday = new Date("2026-10-07T10:00:00Z");
    expect(dayKey(addBusinessDaysTz(wednesday, 3, TZ), TZ)).toBe("2026-10-12");
    expect(dayKey(addBusinessDaysTz(wednesday, -5, TZ), TZ)).toBe("2026-09-30");
  });
});

describe("planning des relances", () => {
  const steps = [
    { position: 1, delayDays: 3, delayHours: 0, sendTime: "09:30" },
    { position: 2, delayDays: 4, delayHours: 0, sendTime: null },
    { position: 3, delayDays: 7, delayHours: 0, sendTime: null },
  ];

  it("décale les relances du week-end au lundi en gardant l'heure préférée", () => {
    const dates = computeSchedule(steps, new Date("2026-10-07T20:30:00Z"), window);
    expect(dates.map(local)).toEqual(["lun. 12/10 09:30", "ven. 16/10 09:30", "ven. 23/10 09:30"]);
  });

  it("traverse le passage à l'heure d'été sans décalage d'heure locale", () => {
    const dates = computeSchedule(steps, new Date("2026-03-27T08:00:00Z"), window);
    expect(dates.map(local)).toEqual(["lun. 30/03 09:30", "ven. 03/04 09:30", "ven. 10/04 09:30"]);
  });

  it("une étape en heures reste dans la journée si possible", () => {
    const [d] = computeSchedule([{ position: 1, delayDays: 0, delayHours: 2, sendTime: null }], new Date("2026-10-07T08:00:00Z"), window);
    expect(local(d!)).toBe("mer. 07/10 12:00");
  });
});
