"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, Clock, MapPin, Phone, UserRound, Video, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AsyncPicker } from "@/components/common/async-picker";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { createMeetingAction } from "@/actions/meetings";
import { createTaskAction } from "@/actions/tasks";
import type { MeetingType, TaskType } from "@/generated/prisma/enums";
import { DatePicker, TimePicker, toMin } from "@/components/common/date-time-pickers";

export type QuickDraft = { date: string; start: string; end: string; allDay: boolean };

export type MoreOptions = { start: string; durationMin: number; title: string; type: MeetingType; contact: PickerOption | null };


const MEETING_TYPES: { id: MeetingType; label: string; icon: typeof Video }[] = [
  { id: "VIDEO", label: "Visio", icon: Video },
  { id: "PHONE", label: "Téléphone", icon: Phone },
  { id: "IN_PERSON", label: "Physique", icon: MapPin },
];

const TASK_TYPES: { id: TaskType; label: string }[] = [
  { id: "CALL", label: "Appel" },
  { id: "EMAIL", label: "Email" },
  { id: "FOLLOW_UP", label: "Relance" },
  { id: "TODO", label: "À faire" },
];

/** Création rapide au clic sur un créneau (fenêtre « Ajouter un titre » de Google Agenda). */
export function QuickCreate({
  draft,
  tz,
  onClose,
  onCreated,
  onMore,
}: {
  draft: QuickDraft;
  tz: string;
  onClose: () => void;
  onCreated: (date: string) => void;
  onMore: (opts: MoreOptions) => void;
}) {
  const [tab, setTab] = useState<"meeting" | "task">("meeting");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [taskAllDay, setTaskAllDay] = useState(draft.allDay);
  const [type, setType] = useState<MeetingType>("VIDEO");
  const [taskType, setTaskType] = useState<TaskType>("CALL");
  const [contact, setContact] = useState<PickerOption | null>(null);
  const [location, setLocation] = useState("");
  const [confirm, setConfirm] = useState(true);

  const [now] = useState(() => Date.now());
  const duration = toMin(end) - toMin(start);
  const startDt = DateTime.fromISO(`${date}T${start}`, { zone: tz });
  const past = tab === "meeting" ? startDt.isValid && startDt.toMillis() < now : false;

  const done = () => {
    onCreated(date);
    onClose();
  };
  const createMeeting = useAction(createMeetingAction, { onSuccess: done });
  const createTask = useAction(createTaskAction, { success: "Tâche créée", onSuccess: done });
  const pending = createMeeting.pending || createTask.pending;

  const changeStart = (v: string) => {
    // Conserve la durée, comme Google Agenda
    const next = Math.min(toMin(v) + Math.max(duration, 15), 24 * 60 - 1);
    setStart(v);
    setEnd(`${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`);
  };

  const canSave =
    !pending &&
    Boolean(date) &&
    (tab === "meeting" ? duration >= 5 && (type !== "IN_PERSON" || location.trim().length > 0) : title.trim().length > 0);

  const submit = () => {
    if (!canSave) return;
    if (tab === "meeting") {
      createMeeting.run({
        title: title.trim() || undefined,
        type,
        start: `${date}T${start}`,
        durationMin: duration,
        contactId: contact?.id ?? null,
        location: type === "VIDEO" ? undefined : location.trim() || undefined,
        sendConfirmation: Boolean(contact) && confirm,
      });
    } else {
      createTask.run({ title: title.trim(), type: taskType, dueAt: taskAllDay ? date : `${date}T${start}`, contactId: contact?.id ?? null });
    }
  };

  return (
    <div
      className="pq-pop"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex justify-end px-2 pt-2">
        <button type="button" aria-label="Fermer" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-[18px]" />
        </button>
      </div>
      <div className="space-y-3 px-5 pb-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tab === "meeting" ? "Ajouter un titre" : "Titre de la tâche"}
          aria-label="Titre"
          className="w-full border-0 border-b border-border bg-transparent pb-1.5 text-[20px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-b-2 focus:border-[#1a73e8]"
        />
        <div className="flex gap-1.5">
          {(
            [
              ["meeting", "Rendez-vous"],
              ["task", "Tâche"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", tab === id ? "bg-[#e8f0fe] text-[#1967d2]" : "text-muted-foreground hover:bg-muted")}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <Clock className="mt-1.5 size-[18px] shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <DatePicker variant="chip" tz={tz} value={date} onChange={(d) => d && setDate(d)} />
              {!(tab === "task" && taskAllDay) && (
                <>
                  <TimePicker variant="chip" ariaLabel="Début" value={start} onChange={changeStart} />
                  {tab === "meeting" && (
                    <>
                      <span className="text-muted-foreground">–</span>
                      <TimePicker variant="chip" ariaLabel="Fin" from={start} value={end} onChange={setEnd} />
                    </>
                  )}
                </>
              )}
            </div>
            {tab === "task" && (
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Checkbox checked={taskAllDay} onCheckedChange={(c) => setTaskAllDay(Boolean(c))} /> Toute la journée
              </label>
            )}
          </div>
        </div>

        {tab === "meeting" ? (
          <div className="flex flex-wrap gap-1.5 pl-[30px]">
            {MEETING_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
                  type === t.id ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1967d2]" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 pl-[30px]">
            {TASK_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTaskType(t.id)}
                className={cn(
                  "h-8 rounded-full border px-3 text-[12.5px] transition-colors",
                  taskType === t.id ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1967d2]" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <UserRound className="size-[18px] shrink-0 text-muted-foreground" />
          <AsyncPicker value={contact} onChange={setContact} search={searchContactsAction} placeholder="Ajouter un contact" className="h-9 flex-1" />
        </div>

        {tab === "meeting" && type !== "VIDEO" && (
          <div className="flex items-center gap-3">
            {type === "PHONE" ? <Phone className="size-[18px] shrink-0 text-muted-foreground" /> : <MapPin className="size-[18px] shrink-0 text-muted-foreground" />}
            <Input
              className="h-9"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={type === "PHONE" ? "Numéro (par défaut : celui du contact)" : "Adresse du rendez-vous (obligatoire)"}
            />
          </div>
        )}

        {tab === "meeting" && contact && (
          <label className="flex items-center gap-2 pl-[30px] text-[13px] text-muted-foreground">
            <Checkbox checked={confirm} onCheckedChange={(c) => setConfirm(Boolean(c))} /> Envoyer la confirmation et les rappels au contact
          </label>
        )}

        {past && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="size-4 shrink-0" /> Ce créneau est déjà passé : le RDV sera classé comme réalisé.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {tab === "meeting" && (
            <Button
              type="button"
              variant="ghost"
              className="text-[#1967d2] hover:bg-[#e8f0fe] hover:text-[#1967d2]"
              onClick={() => onMore({ start: `${date}T${start}`, durationMin: Math.max(duration, 15), title, type, contact })}
            >
              Plus d&apos;options
            </Button>
          )}
          <Button type="button" className="rounded-full bg-[#1a73e8] px-6 hover:bg-[#1765cc]" disabled={!canSave} onClick={submit}>
            {pending && <Spinner />} Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
