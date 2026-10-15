"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PublicDay } from "@/actions/public";

const TZ = "Europe/Paris";

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatSlotTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

export function formatSlotLong(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

/** Choix d'un créneau : navigation par semaine, jours et heures disponibles (heure de Paris). */
export function SlotPicker({ load, today, onPick, selected }: { load: (fromDay: string) => Promise<PublicDay[]>; today: string; onPick: (iso: string) => void; selected: string | null }) {
  const [from, setFrom] = useState(today);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; days: PublicDay[] | null } | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const current = result?.key === `${from}#${attempt}` ? result : null;
  const days = current?.days ?? null;
  const failed = current !== null && current.days === null;

  useEffect(() => {
    let cancelled = false;
    const key = `${from}#${attempt}`;
    load(from)
      .then((res) => {
        if (cancelled) return;
        setResult({ key, days: res });
        setActiveDay((cur) => (cur && res.some((d) => d.day === cur && d.slots.length) ? cur : (res.find((d) => d.slots.length)?.day ?? null)));
      })
      .catch(() => {
        if (!cancelled) setResult({ key, days: null });
      });
    return () => {
      cancelled = true;
    };
  }, [from, attempt, load]);

  const dayLabel = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    return {
      weekday: new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(d),
      date: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(d),
    };
  };
  const active = days?.find((d) => d.day === activeDay);
  const noneThisWeek = days && days.every((d) => d.slots.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon-sm" disabled={from <= today} onClick={() => setFrom(addDays(from, -7))} aria-label="Semaine précédente">
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium">
          Semaine du {dayLabel(from).date}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Semaine suivante">
          <ChevronRight />
        </Button>
      </div>
      {failed ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
          Impossible de charger les disponibilités.
          <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            Réessayer
          </Button>
        </div>
      ) : days === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const l = dayLabel(d.day);
              const has = d.slots.length > 0;
              return (
                <button
                  key={d.day}
                  disabled={!has}
                  onClick={() => setActiveDay(d.day)}
                  className={cn(
                    "flex flex-col items-center rounded-lg border px-1 py-2 text-xs transition-colors",
                    activeDay === d.day ? "border-primary bg-primary text-white" : has ? "hover:border-primary hover:bg-accent" : "cursor-not-allowed opacity-35",
                  )}
                >
                  <span className="capitalize">{l.weekday}</span>
                  <span className="font-semibold">{l.date}</span>
                </button>
              );
            })}
          </div>
          {noneThisWeek ? (
            <div className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
              Aucun créneau disponible cette semaine.{" "}
              <button className="font-medium text-primary hover:underline" onClick={() => setFrom(addDays(from, 7))}>
                Voir la semaine suivante
              </button>
            </div>
          ) : active ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {active.slots.map((s) => (
                <button
                  key={s}
                  onClick={() => onPick(s)}
                  className={cn("rounded-lg border py-2 text-sm font-medium tabular-nums transition-colors", selected === s ? "border-primary bg-primary text-white" : "hover:border-primary hover:bg-accent")}
                >
                  {formatSlotTime(s)}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-center text-xs text-muted-foreground">Horaires affichés à l&apos;heure de Paris.</p>
        </>
      )}
    </div>
  );
}
