"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg, DayCellContentArg, DayHeaderContentArg, EventApi, EventClickArg, EventContentArg, EventDropArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Link2, ListChecks, Mail, MapPin, Phone, Plus, RefreshCw, Video } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { MeetingDialog, RescheduleDialog } from "@/components/dialogs/meeting-dialog";
import { TaskDialog } from "@/components/dialogs/task-dialog";
import { useAppData, isManagerRole } from "@/components/app/app-data";
import { calendarEventsAction, type CalendarEvent, type CalendarEventInfo } from "@/actions/calendar";
import { rescheduleMeetingAction } from "@/actions/meetings";
import { rescheduleTaskAction } from "@/actions/tasks";
import { MiniMonth } from "./mini-month";
import { EventDetails } from "./event-details";
import { QuickCreate, type MoreOptions, type QuickDraft } from "./quick-create";
import { LAYER_COLORS, LAYER_LABELS, VIEWS, defaultSlot, inTz, readPrefs, timeRange, toLocalValue, viewTitle, writePrefs, type CalView, type Layer, type SelectedEvent } from "./calendar-utils";

type Prefs = { view: CalView; layers: Record<Layer, boolean>; team: string[] };
const PREFS_KEY = "pq:agenda";
const DEFAULT_PREFS: Prefs = { view: "timeGridWeek", layers: { meeting: true, task: true, step: true }, team: [] };

type Anchor = { left: number; top: number; width: number; height: number };
type PopState = { kind: "event"; event: SelectedEvent; anchor: Anchor } | { kind: "create"; draft: QuickDraft; anchor: Anchor } | null;
type MoveArg = EventDropArg | EventResizeDoneArg;

export type GoogleStatus = { email: string; connected: boolean; lastSync: string | null } | null;

const rectOf = (el: Element | null | undefined, fallback?: { x: number; y: number }): Anchor => {
  const r = el?.getBoundingClientRect();
  if (r && r.width) return { left: r.left, top: r.top, width: r.width, height: r.height };
  return { left: fallback?.x ?? window.innerWidth / 2, top: fallback?.y ?? window.innerHeight / 3, width: 1, height: 1 };
};

function KindIcon({ info, className }: { info: CalendarEventInfo; className?: string }) {
  if (info.kind === "step") return <Mail className={className} />;
  if (info.kind === "task") return info.subtype === "CALL" || info.subtype === "CALLBACK" ? <Phone className={className} /> : <ListChecks className={className} />;
  if (info.subtype === "PHONE") return <Phone className={className} />;
  if (info.subtype === "IN_PERSON") return <MapPin className={className} />;
  return <Video className={className} />;
}

export function CrmCalendar({ google }: { google: GoogleStatus }) {
  const { me, users } = useAppData();
  const tz = me.timezone;
  const manager = isManagerRole(me.role);
  const calRef = useRef<FullCalendar>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [range, setRange] = useState<{ view: CalView; title: string; start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pop, setPop] = useState<PopState>(null);
  const [more, setMore] = useState<MoreOptions | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [move, setMove] = useState<MoveArg | null>(null);
  const [reschedule, setReschedule] = useState<SelectedEvent | null>(null);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const teammates = useMemo(() => users.filter((u) => u.id !== me.id), [users, me.id]);

  // Préférences (vue, agendas affichés) conservées dans le navigateur ; vue « Jour » par défaut sur mobile
  useEffect(() => {
    const stored = readPrefs(PREFS_KEY, DEFAULT_PREFS);
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du stockage local au montage
    setPrefs({ ...stored, view: mobile ? "timeGridDay" : stored.view, team: manager ? stored.team.filter((id) => usersById[id]) : [] });
    setReady(true);
  }, [manager, usersById]);

  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(PREFS_KEY, next);
      return next;
    });

  const api = () => calRef.current?.getApi();
  const refetch = useCallback(() => calRef.current?.getApi().refetchEvents(), []);

  const decorate = useCallback(
    (e: CalendarEvent): EventInput => {
      const p = e.extendedProps;
      const color = p.ownerId === me.id ? LAYER_COLORS[p.kind] : (usersById[p.ownerId]?.color ?? "#616161");
      // Une journée entière n'est « passée » qu'à partir du lendemain
      const endMs = e.allDay ? DateTime.fromISO(e.start, { zone: tz }).startOf("day").plus({ days: 1 }).toMillis() : new Date(e.end ?? e.start).getTime();
      const past = endMs < Date.now();
      const struck = p.status === "CANCELLED" || p.status === "DONE";
      const lightText = !(p.kind === "task" && p.ownerId === me.id);
      return {
        ...e,
        backgroundColor: past || struck ? `color-mix(in srgb, ${color} 24%, white)` : color,
        borderColor: color,
        textColor: past || struck ? `color-mix(in srgb, ${color} 45%, #1f1f1f)` : lightText ? "#ffffff" : "#3c2f00",
        classNames: ["pq-ev", `pq-${p.kind}`, past && "pq-past", struck && "pq-struck", p.status === "PENDING_APPROVAL" && "pq-approval"].filter(Boolean) as string[],
      };
    },
    [me.id, usersById, tz],
  );

  const fetchEvents = useCallback(
    async (info: EventSourceFuncArg): Promise<EventInput[]> => {
      try {
        const events = await calendarEventsAction(
          { start: info.start.toISOString(), end: info.end.toISOString() },
          { userIds: [me.id, ...prefs.team], meetings: prefs.layers.meeting, tasks: prefs.layers.task, steps: prefs.layers.step },
        );
        return events.map(decorate);
      } catch {
        toast.error("Impossible de charger l'agenda. Réessayez dans un instant.");
        return [];
      }
    },
    [me.id, prefs.team, prefs.layers, decorate],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    const view = arg.view.type as CalView;
    setRange({
      view,
      title: viewTitle(view, arg.view.currentStart, arg.view.currentEnd, tz),
      start: inTz(arg.view.currentStart, tz).toISODate()!,
      end: inTz(arg.view.currentEnd, tz).toISODate()!,
    });
    if (view !== prefs.view) updatePrefs({ view });
  };

  const changeView = (view: CalView) => {
    api()?.changeView(view);
    setPop(null);
  };

  const openCreate = (startAt: Date, endAt: Date, allDay: boolean, anchor: Anchor) => {
    const day = inTz(startAt, tz).toISODate()!;
    const clicked = inTz(startAt, tz);
    // Un simple clic crée un créneau aligné sur la demi-heure, comme Google Agenda
    const simpleClick = !allDay && endAt.getTime() - startAt.getTime() <= 15 * 60_000;
    let start = allDay ? defaultSlot(day, tz) : (simpleClick ? clicked.set({ minute: clicked.minute < 30 ? 0 : 30 }) : clicked).toFormat("HH:mm");
    let endMin = allDay ? 30 : Math.max(30, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
    if (!allDay && endAt.getTime() - startAt.getTime() > 12 * 3600_000) endMin = 30;
    if (start === "23:45") start = "23:30";
    const end = DateTime.fromISO(`${day}T${start}`).plus({ minutes: endMin });
    setPop({ kind: "create", draft: { date: day, start, end: end.hasSame(DateTime.fromISO(day), "day") ? end.toFormat("HH:mm") : "23:45", allDay }, anchor });
  };

  const onSelect = (arg: DateSelectArg) => {
    const point = arg.jsEvent ? { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY } : undefined;
    requestAnimationFrame(() => {
      const el = document.querySelector(".fc .fc-event-mirror") ?? document.querySelector(".fc .fc-highlight");
      openCreate(arg.start, arg.end, arg.allDay, rectOf(el, point));
    });
  };

  const createNow = () => {
    const now = DateTime.now().setZone(tz);
    const day = range && (now.toISODate()! < range.start || now.toISODate()! >= range.end) ? range.start : now.toISODate()!;
    const start = defaultSlot(day, tz);
    const startAt = DateTime.fromISO(`${day}T${start}`, { zone: tz });
    openCreate(startAt.toJSDate(), startAt.plus({ minutes: 30 }).toJSDate(), false, rectOf(null));
  };

  const toSelected = (ev: EventApi, color?: string): SelectedEvent => ({
    id: ev.id,
    title: ev.title,
    start: ev.start!,
    end: ev.end,
    allDay: ev.allDay,
    color: color ?? ev.borderColor,
    info: ev.extendedProps as CalendarEventInfo,
  });

  const onEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    api()?.unselect();
    setPop({ kind: "event", event: toSelected(arg.event), anchor: rectOf(arg.el) });
  };

  const applyMove = async (arg: MoveArg, notify: boolean) => {
    const info = arg.event.extendedProps as CalendarEventInfo;
    const start = arg.event.start!;
    const res =
      info.kind === "meeting"
        ? await rescheduleMeetingAction(info.entityId, toLocalValue(start, tz), Math.round(((arg.event.end ?? start).getTime() - start.getTime()) / 60_000) || info.durationMin, notify)
        : await rescheduleTaskAction(info.entityId, arg.event.allDay ? arg.event.startStr.slice(0, 10) : toLocalValue(start, tz));
    if (res.ok) {
      toast.success(info.kind === "meeting" ? (notify ? "Rendez-vous déplacé, contact prévenu" : "Rendez-vous déplacé") : "Tâche replanifiée", {
        action: { label: "Annuler", onClick: () => undoMove(arg) },
      });
      refetch();
    } else {
      toast.error(res.error);
      arg.revert();
    }
  };

  const undoMove = async (arg: MoveArg) => {
    const info = arg.event.extendedProps as CalendarEventInfo;
    const old = arg.oldEvent;
    const res =
      info.kind === "meeting"
        ? await rescheduleMeetingAction(info.entityId, toLocalValue(old.start!, tz), Math.round(((old.end ?? old.start!).getTime() - old.start!.getTime()) / 60_000) || info.durationMin, false)
        : await rescheduleTaskAction(info.entityId, old.allDay ? old.startStr.slice(0, 10) : toLocalValue(old.start!, tz));
    if (!res.ok) toast.error(res.error);
    refetch();
  };

  const onMove = (arg: MoveArg) => {
    setPop(null);
    const info = arg.event.extendedProps as CalendarEventInfo;
    if (info.kind === "meeting" && info.contact?.email) setMove(arg);
    else void applyMove(arg, false);
  };

  const closePop = useCallback(() => {
    setPop(null);
    calRef.current?.getApi().unselect();
  }, []);

  // Raccourcis clavier de Google Agenda : T, J/N, K/P, D, W, M, A, C
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector("[role=dialog], [data-slot=popover-content], [data-slot=dropdown-menu-content]")) return;
      const cal = calRef.current?.getApi();
      if (!cal) return;
      const key = e.key.toLowerCase();
      const views: Record<string, CalView> = { d: "timeGridDay", w: "timeGridWeek", s: "timeGridWeek", m: "dayGridMonth", a: "listWeek" };
      if (key === "t") cal.today();
      else if (key === "j" || key === "n") cal.next();
      else if (key === "k" || key === "p") cal.prev();
      else if (views[key]) cal.changeView(views[key]);
      else if (key === "c") createNow();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const eventContent = (arg: EventContentArg) => {
    const info = arg.event.extendedProps as CalendarEventInfo;
    const start = arg.event.start!;
    const end = arg.event.end;
    const viewType = arg.view.type;
    if (viewType === "listWeek") {
      return (
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-medium", (info.status === "CANCELLED" || info.status === "DONE") && "line-through opacity-60")}>{arg.event.title}</span>
          {info.contact && arg.event.title.indexOf(info.contact.name) === -1 && <span className="truncate text-muted-foreground">· {info.contact.name}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{info.subtypeLabel}</span>
        </span>
      );
    }
    if (viewType === "dayGridMonth" && !arg.event.allDay) {
      return (
        <span className="flex min-w-0 items-center gap-1.5 px-1">
          <span className="size-2 shrink-0 rounded-full" style={{ background: arg.borderColor }} />
          <span className="shrink-0 text-muted-foreground">{inTz(start, tz).toFormat("HH:mm")}</span>
          <span className={cn("truncate font-medium text-foreground", (info.status === "CANCELLED" || info.status === "DONE") && "line-through opacity-60")}>{arg.event.title}</span>
        </span>
      );
    }
    if (arg.event.allDay) {
      return (
        <span className="flex min-w-0 items-center gap-1 px-1.5 font-medium">
          <KindIcon info={info} className="size-3 shrink-0 opacity-80" />
          <span className="truncate">{arg.event.title}</span>
        </span>
      );
    }
    const minutes = end ? (end.getTime() - start.getTime()) / 60_000 : 30;
    const compact = minutes < 45;
    if (arg.isMirror) {
      return (
        <div className="px-1.5 py-0.5 leading-tight">
          <div className="truncate font-medium">(Sans titre)</div>
          <div className="truncate opacity-90">{timeRange(start, end, tz)}</div>
        </div>
      );
    }
    return (
      <div className={cn("h-full overflow-hidden px-1.5 leading-tight", compact ? "flex items-start gap-1 py-px" : "py-0.5")}>
        {compact ? (
          <span className="min-w-0 truncate">
            <span className="font-medium">{arg.event.title}</span>
            <span className="opacity-90">, {inTz(start, tz).toFormat("HH:mm")}</span>
          </span>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <KindIcon info={info} className="size-3 shrink-0 opacity-80" />
              <span className="truncate font-medium">{arg.event.title}</span>
            </div>
            <div className="truncate opacity-90">{timeRange(start, end, tz)}</div>
            {minutes >= 60 && info.contact && arg.event.title.indexOf(info.contact.name) === -1 && <div className="truncate opacity-90">{info.contact.name}</div>}
          </>
        )}
      </div>
    );
  };

  const nowHour = DateTime.now().setZone(tz).hour;
  const viewLabel = VIEWS.find((v) => v.id === (range?.view ?? prefs.view))?.label ?? "Semaine";

  return (
    <div className="pq-agenda flex h-[calc(100dvh-7.25rem)] min-h-[560px] gap-4 lg:h-[calc(100dvh-7.75rem)]">
      {/* Colonne de gauche */}
      <aside className="hidden w-[244px] shrink-0 flex-col gap-5 overflow-y-auto pb-2 lg:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-tour="agenda-create"
              className="flex h-14 w-fit items-center gap-3 rounded-2xl bg-white pl-4 pr-6 text-[14px] font-medium text-foreground shadow-[0_1px_3px_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)] transition-shadow hover:bg-[#f6fafe] hover:shadow-[0_1px_3px_rgba(60,64,67,.3),0_6px_10px_4px_rgba(60,64,67,.15)]"
            >
              <Plus className="size-6 text-[#1a73e8]" strokeWidth={2.2} /> Créer <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => setMore({ start: "", durationMin: 30, title: "", type: "VIDEO", contact: null })}>
              <CalendarCheck /> Rendez-vous
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setNewTask(true)}>
              <ListChecks /> Tâche
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div data-tour="agenda-mini">
          <MiniMonth tz={tz} rangeStart={range?.start ?? null} rangeEnd={range?.end ?? null} onPick={(day) => api()?.gotoDate(day)} />
        </div>

        <section data-tour="agenda-layers">
          <h3 className="mb-1 px-2 text-[13px] font-medium text-foreground">Mes agendas</h3>
          {(Object.keys(LAYER_LABELS) as Layer[]).map((layer) => (
            <ColorCheck key={layer} color={LAYER_COLORS[layer]} checked={prefs.layers[layer]} onChange={(v) => updatePrefs({ layers: { ...prefs.layers, [layer]: v } })}>
              {LAYER_LABELS[layer]}
            </ColorCheck>
          ))}
        </section>

        {manager && teammates.length > 0 && (
          <section>
            <h3 className="mb-1 px-2 text-[13px] font-medium text-foreground">Agendas de l&apos;équipe</h3>
            {teammates.map((u) => (
              <ColorCheck
                key={u.id}
                color={u.color}
                checked={prefs.team.includes(u.id)}
                onChange={(v) => updatePrefs({ team: v ? [...prefs.team, u.id] : prefs.team.filter((id) => id !== u.id) })}
              >
                {u.firstName} {u.lastName}
              </ColorCheck>
            ))}
          </section>
        )}

        <div className="mt-auto space-y-2 px-2 text-[12px] leading-snug text-muted-foreground">
          {google?.connected ? (
            <p className="flex gap-2">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Synchronisé avec Google Agenda
                <br />
                <span className="text-foreground/80">{google.email}</span>
                {google.lastSync && (
                  <>
                    <br />
                    {google.lastSync}
                  </>
                )}
              </span>
            </p>
          ) : (
            <p>
              Google Agenda non connecté —{" "}
              <Link href="/parametres/integrations" className="text-[#1a73e8] hover:underline">
                connecter
              </Link>
            </p>
          )}
          <Link href="/parametres/rendez-vous" className="flex items-center gap-2 text-[#1a73e8] hover:underline">
            <Link2 className="size-3.5" /> Mon lien de prise de RDV
          </Link>
        </div>
      </aside>

      {/* Calendrier */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card surface">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <Button variant="outline" className="h-9 rounded-full px-4 text-[13px]" onClick={() => api()?.today()} title="Aujourd'hui (T)">
            Aujourd&apos;hui
          </Button>
          <div className="flex">
            <button type="button" aria-label="Période précédente" title="Précédent (K)" onClick={() => api()?.prev()} className="grid size-9 place-items-center rounded-full text-foreground/80 hover:bg-muted">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" aria-label="Période suivante" title="Suivant (J)" onClick={() => api()?.next()} className="grid size-9 place-items-center rounded-full text-foreground/80 hover:bg-muted">
              <ChevronRight className="size-5" />
            </button>
          </div>
          <h2 className="min-w-0 truncate text-[19px] text-foreground sm:text-[22px]" aria-live="polite">
            {range?.title ?? ""}
          </h2>
          {loading && <span className="size-4 animate-spin rounded-full border-2 border-[#1a73e8]/25 border-t-[#1a73e8]" aria-label="Chargement" />}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-9 rounded-full lg:hidden" aria-label="Créer" onClick={createNow}>
              <Plus />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-tour="agenda-views" variant="outline" className="h-9 rounded-full px-4 text-[13px]">
                  {viewLabel} <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {VIEWS.map((v) => (
                  <DropdownMenuItem key={v.id} onClick={() => changeView(v.id)} className={cn((range?.view ?? prefs.view) === v.id && "bg-accent")}>
                    {v.label}
                    <DropdownMenuShortcut>{v.key}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div data-tour="agenda-grid" className="relative min-h-0 flex-1">
          {ready && (
            <FullCalendar
              ref={calRef}
              plugins={[luxonPlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              locale={frLocale}
              timeZone={tz}
              initialView={prefs.view}
              headerToolbar={false}
              height="100%"
              events={fetchEvents}
              loading={setLoading}
              datesSet={onDatesSet}
              nowIndicator
              navLinks
              navLinkDayClick="timeGridDay"
              weekends
              firstDay={1}
              slotDuration="00:30:00"
              snapDuration="00:15:00"
              slotLabelInterval="01:00"
              slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
              eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
              scrollTime={`${String(Math.max(0, Math.min(nowHour - 2, 8))).padStart(2, "0")}:00:00`}
              scrollTimeReset={false}
              allDayText=""
              dayMaxEvents
              views={{
                // Contenus personnalisés par vue : la vue Planning garde ses en-têtes de jour par défaut
                timeGrid: {
                  dayMaxEvents: false,
                  dayMaxEventRows: 3,
                  dayHeaderContent: (arg: DayHeaderContentArg) => {
                    const d = inTz(arg.date, tz);
                    return (
                      <span className={cn("pq-dayhead", arg.isToday && "is-today", arg.isPast && !arg.isToday && "is-past")}>
                        <span className="pq-dayhead-wd">{d.toFormat("ccc").replace(".", "")}</span>
                        <span className="pq-dayhead-num">{d.day}</span>
                      </span>
                    );
                  },
                },
                dayGridMonth: {
                  dayHeaderContent: (arg: DayHeaderContentArg) => <span className="pq-monthhead">{inTz(arg.date, tz).toFormat("ccc").replace(".", "")}</span>,
                  dayCellContent: (arg: DayCellContentArg) => <span className={cn("pq-daynum", arg.isToday && "is-today")}>{arg.dayNumberText}</span>,
                },
              }}
              eventMaxStack={4}
              eventMinHeight={20}
              eventShortHeight={30}
              selectable
              selectMirror
              unselectAuto
              unselectCancel=".pq-pop"
              editable
              eventDurationEditable
              eventAllow={(span, ev) => !(ev && (ev.extendedProps as CalendarEventInfo).kind === "meeting" && span.allDay)}
              select={onSelect}
              eventClick={onEventClick}
              eventDrop={onMove}
              eventResize={onMove}
              eventContent={eventContent}
              moreLinkContent={(arg) => `${arg.num} autre${arg.num > 1 ? "s" : ""}`}
              noEventsContent="Aucun événement sur cette période"
            />
          )}
        </div>
      </div>

      {/* Fiche d'événement / création rapide */}
      <Popover open={Boolean(pop)} onOpenChange={(o) => !o && closePop()}>
        {pop && (
          <PopoverAnchor asChild>
            <div aria-hidden style={{ position: "fixed", left: pop.anchor.left, top: pop.anchor.top, width: pop.anchor.width, height: pop.anchor.height, pointerEvents: "none" }} />
          </PopoverAnchor>
        )}
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="pq-pop w-[min(420px,calc(100vw-32px))] rounded-2xl border-0 p-0 shadow-[0_24px_38px_3px_rgba(0,0,0,.14),0_9px_46px_8px_rgba(0,0,0,.12),0_11px_15px_-7px_rgba(0,0,0,.2)]"
          onOpenAutoFocus={(e) => pop?.kind === "event" && e.preventDefault()}
        >
          {pop?.kind === "event" && (
            <EventDetails
              key={pop.event.id}
              event={pop.event}
              tz={tz}
              onClose={closePop}
              onChanged={refetch}
              onReschedule={() => {
                setReschedule(pop.event);
                setPop(null);
              }}
            />
          )}
          {pop?.kind === "create" && (
            <QuickCreate
              key={`${pop.draft.date}-${pop.draft.start}-${pop.draft.end}`}
              draft={pop.draft}
              tz={tz}
              onClose={closePop}
              onCreated={(day) => {
                refetch();
                if (range && (day < range.start || day >= range.end)) api()?.gotoDate(day);
              }}
              onMore={(opts) => {
                setPop(null);
                api()?.unselect();
                setMore(opts);
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      {more && (
        <MeetingDialog
          open
          onOpenChange={(o) => !o && setMore(null)}
          defaultStart={more.start || undefined}
          defaultDurationMin={more.durationMin}
          defaultTitle={more.title}
          defaultType={more.type}
          contact={more.contact}
          onCreated={() => refetch()}
        />
      )}
      {newTask && (
        <TaskDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setNewTask(false);
              refetch();
            }
          }}
        />
      )}
      {reschedule && (
        <RescheduleDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setReschedule(null);
              refetch();
            }
          }}
          meetingId={reschedule.info.entityId}
          start={toLocalValue(reschedule.start, tz)}
          durationMin={reschedule.info.durationMin}
        />
      )}

      {/* Déplacement d'un RDV : prévenir le contact ? (comme « Envoyer des e-mails de mise à jour aux invités ? ») */}
      <Dialog
        open={Boolean(move)}
        onOpenChange={(o) => {
          if (!o && move) {
            move.revert();
            setMove(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Prévenir le contact ?</DialogTitle>
            <DialogDescription>
              {move &&
                `${(move.event.extendedProps as CalendarEventInfo).contact?.name} recevra un email avec le nouvel horaire : ${inTz(move.event.start!, tz).toFormat("cccc d LLLL")} à ${inTz(move.event.start!, tz).toFormat("HH:mm")}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                move?.revert();
                setMove(null);
              }}
            >
              Revenir
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (move) void applyMove(move, false);
                  setMove(null);
                }}
              >
                Ne pas envoyer
              </Button>
              <Button
                onClick={() => {
                  if (move) void applyMove(move, true);
                  setMove(null);
                }}
              >
                Envoyer
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ColorCheck({ color, checked, onChange, children }: { color: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-3 rounded-md px-2 text-[13px] text-foreground/90 hover:bg-muted/70">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className="grid size-[18px] shrink-0 place-items-center rounded-[3px] border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
        style={{ borderColor: color, background: checked ? color : "transparent" }}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="size-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="truncate">{children}</span>
    </label>
  );
}
