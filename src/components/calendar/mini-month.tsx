"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { capitalize } from "./calendar-utils";

/** Mini-calendrier mensuel (colonne de gauche, comme Google Agenda). */
export function MiniMonth({ tz, rangeStart, rangeEnd, onPick, selected }: { tz: string; rangeStart: string | null; rangeEnd: string | null; onPick: (day: string) => void; selected?: string | null }) {
  const today = DateTime.now().setZone(tz).setLocale("fr").toISODate()!;
  const [month, setMonth] = useState(() => DateTime.fromISO(rangeStart ?? today, { zone: tz }).setLocale("fr").startOf("month"));
  const [lastRange, setLastRange] = useState(rangeStart);

  // Suit la navigation du grand calendrier
  if (rangeStart !== lastRange) {
    setLastRange(rangeStart);
    if (rangeStart) {
      const target = DateTime.fromISO(rangeStart, { zone: tz }).setLocale("fr").startOf("month");
      if (!target.hasSame(month, "month")) setMonth(target);
    }
  }

  const first = month.startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => first.plus({ days: i }));
  const weekdays = ["L", "M", "M", "J", "V", "S", "D"];

  return (
    <div className="select-none px-1">
      <div className="mb-1 flex items-center justify-between pl-2">
        <span className="text-[13px] font-medium text-foreground">{capitalize(month.toFormat("LLLL yyyy"))}</span>
        <div className="flex">
          <button type="button" aria-label="Mois précédent" onClick={() => setMonth((m) => m.minus({ months: 1 }))} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Mois suivant" onClick={() => setMonth((m) => m.plus({ months: 1 }))} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] font-medium text-muted-foreground">
        {weekdays.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.map((d) => {
          const iso = d.toISODate()!;
          const inMonth = d.hasSame(month, "month");
          const isToday = iso === today;
          const isSelected = selected === iso;
          const inRange = !selected && rangeStart && rangeEnd ? iso >= rangeStart && iso < rangeEnd : false;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              aria-label={d.toFormat("cccc d LLLL yyyy")}
              aria-current={isToday ? "date" : undefined}
              className={cn("grid h-7 place-items-center text-[11px]", inRange && "bg-sky-50 first:rounded-l-full last:rounded-r-full")}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full transition-colors",
                  !isToday && (inMonth ? "text-foreground" : "text-muted-foreground/60"),
                  isToday ? "bg-[#1a73e8] font-semibold text-white" : isSelected ? "bg-[#d2e3fc] font-semibold text-[#185abc]" : "hover:bg-muted",
                )}
              >
                {d.day}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
