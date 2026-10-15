"use client";

import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { CalendarDays, ChevronDown, Clock } from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MiniMonth } from "@/components/calendar/mini-month";

/** Sélecteurs de date et d'heure à la manière de Google Agenda (remplacent les champs natifs du système). */

const STEP = 15;
const ALL_TIMES = Array.from({ length: (24 * 60) / STEP }, (_, i) => fromMin(i * STEP));

export function toMin(t: string) {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}
function fromMin(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function fmtDuration(m: number) {
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m / 60} h`;
}

/** « 9h30 », « 930 », « 9:30 », « 14 », « 14h » → « HH:mm » (null si illisible). */
export function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s/g, "");
  let m = s.match(/^(\d{1,2})(?:[h:.](\d{0,2}))?$/);
  if (!m && /^\d{3,4}$/.test(s)) m = [s, s.slice(0, s.length - 2), s.slice(-2)] as RegExpMatchArray;
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  if (h > 23 || min > 59) return null;
  return fromMin(h * 60 + min);
}

const triggerCls =
  "inline-flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 data-[state=open]:border-[#1a73e8] data-[state=open]:ring-1 data-[state=open]:ring-[#1a73e8]";

export function DatePicker({
  value,
  onChange,
  tz = "Europe/Paris",
  className,
  placeholder = "Choisir une date",
  variant = "field",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  tz?: string;
  className?: string;
  placeholder?: string;
  variant?: "field" | "chip";
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const d = value ? DateTime.fromISO(value).setLocale("fr") : null;
  const label = d?.isValid ? d.toFormat("cccc d LLLL").replace(/^./, (c) => c.toUpperCase()) + (d.year !== DateTime.now().year ? ` ${d.year}` : "") : placeholder;
  const next = d?.isValid ? d.plus({ days: 1 }).toISODate() : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" className={cn(triggerCls, variant === "chip" && "border-transparent bg-muted/70 hover:bg-muted", !d && "text-muted-foreground", className)}>
          {variant === "field" && <CalendarDays className="size-4 text-muted-foreground" />}
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-2">
        <MiniMonth
          key={value || "none"}
          tz={tz}
          rangeStart={value || null}
          rangeEnd={next}
          selected={value || null}
          onPick={(day) => {
            onChange(day);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TimePicker({
  value,
  onChange,
  from,
  className,
  placeholder = "Heure",
  variant = "field",
  allowEmpty,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Heure de début : la liste propose alors les fins avec la durée, comme Google Agenda */
  from?: string;
  className?: string;
  placeholder?: string;
  variant?: "field" | "chip";
  allowEmpty?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const times = from ? ALL_TIMES.filter((t) => toMin(t) > toMin(from)) : ALL_TIMES;

  useEffect(() => {
    if (!open) return;
    // Fait défiler la liste jusqu'à l'heure choisie (ou 9 h)
    const id = requestAnimationFrame(() => {
      const list = listRef.current;
      const target = (list?.querySelector("[data-selected=true]") ?? list?.querySelector(`[data-time="09:00"]`) ?? list?.firstElementChild) as HTMLElement | null;
      if (list && target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const commit = (raw: string) => {
    setEditing(false);
    if (!raw.trim()) {
      if (allowEmpty) onChange("");
      setText(value);
      return;
    }
    const t = parseTime(raw);
    if (t && (!from || toMin(t) > toMin(from))) onChange(t);
    setText(t ?? value);
  };

  const pick = (t: string) => {
    onChange(t);
    setText(t);
    setEditing(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} data-time-anchor="" data-state={open ? "open" : "closed"} onClick={() => setOpen(true)} className={cn(triggerCls, "cursor-text px-2.5", variant === "chip" && "border-transparent bg-muted/70 hover:bg-muted", className)}>
          {variant === "field" && <Clock className="size-4 shrink-0 text-muted-foreground" />}
          <input
            aria-label={ariaLabel ?? placeholder}
            value={editing ? text : value}
            placeholder={placeholder}
            onFocus={(e) => {
              setText(value);
              setEditing(true);
              setOpen(true);
              e.target.select();
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commit(text);
                setOpen(false);
              } else if (e.key === "Escape") {
                setEditing(false);
                setOpen(false);
              }
            }}
            className="w-[3.4rem] min-w-0 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground"
          />
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className={cn("p-1", from ? "w-48" : "w-32")}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Un clic dans le champ lui-même ne ferme pas la liste
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[data-time-anchor]") === anchorRef.current) e.preventDefault();
        }}
      >
        <div ref={listRef} role="listbox" aria-label={ariaLabel ?? placeholder} className="max-h-60 overflow-y-auto overscroll-contain">
          {allowEmpty && (
            <button type="button" role="option" aria-selected={!value} onMouseDown={(e) => e.preventDefault()} onClick={() => pick("")} className="w-full rounded-md px-3 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted">
              Sans heure
            </button>
          )}
          {times.map((t) => (
            <button
              key={t}
              type="button"
              role="option"
              data-time={t}
              data-selected={t === value}
              aria-selected={t === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(t)}
              className={cn("flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] tabular-nums hover:bg-muted", t === value && "bg-[#e8f0fe] font-medium text-[#1967d2] hover:bg-[#e8f0fe]")}
            >
              {t}
              {from && <span className="text-[12px] font-normal text-muted-foreground">{fmtDuration(toMin(t) - toMin(from))}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
