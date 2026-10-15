"use client";

import Link from "next/link";
import { useState } from "react";
import { AlignLeft, Bell, CalendarClock, Check, ExternalLink, MapPin, Phone, RotateCcw, Trash2, User, UserRound, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { cancelMeetingAction, setMeetingOutcomeAction } from "@/actions/meetings";
import { completeTaskAction, reopenTaskAction } from "@/actions/tasks";
import { capitalize, inTz, timeRange, type SelectedEvent } from "./calendar-utils";

const STATUS_LABEL: Record<string, string> = {
  CANCELLED: "Annulé",
  COMPLETED: "Réalisé",
  NO_SHOW: "Contact absent",
  DONE: "Terminée",
  PENDING_APPROVAL: "À valider avant envoi",
};

function Row({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-1.5">
      <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-[13px] leading-5">{children}</div>
    </div>
  );
}

/** Fiche d'un événement (clic dans l'agenda) : détails et actions rapides, à la manière de Google Agenda. */
export function EventDetails({ event, tz, onClose, onChanged, onReschedule }: { event: SelectedEvent; tz: string; onClose: () => void; onChanged: () => void; onReschedule: () => void }) {
  const { info } = event;
  const [now] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(Boolean(info.contact?.email));
  const done = () => {
    onChanged();
    onClose();
  };
  const cancel = useAction(() => cancelMeetingAction(info.entityId, reason.trim() || null, notify), { onSuccess: done });
  const outcome = useAction((o: "COMPLETED" | "NO_SHOW") => setMeetingOutcomeAction(info.entityId, o), { onSuccess: done });
  const complete = useAction(() => completeTaskAction(info.entityId), { success: "Tâche terminée", onSuccess: done });
  const reopen = useAction(() => reopenTaskAction(info.entityId), { onSuccess: done });

  const day = capitalize(inTz(event.start, tz).toFormat("cccc d LLLL"));
  const when = event.allDay || !info.hasTime ? day : `${day} · ${timeRange(event.start, event.end, tz)}`;
  const isMeeting = info.kind === "meeting";
  const active = isMeeting ? info.status === "SCHEDULED" : info.kind === "task" ? info.status === "OPEN" : true;
  const past = (event.end ?? event.start).getTime() < now;
  const busy = cancel.pending || outcome.pending || complete.pending || reopen.pending;

  return (
    <div className="pq-pop text-sm">
      <div className="flex items-center justify-end gap-0.5 px-2 pt-2">
        {isMeeting && active && (
          <button type="button" title="Déplacer" onClick={onReschedule} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <CalendarClock className="size-[18px]" />
          </button>
        )}
        {isMeeting && active && (
          <button type="button" title="Annuler le rendez-vous" onClick={() => setCancelling(true)} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <Trash2 className="size-[18px]" />
          </button>
        )}
        <Link href={info.url} title="Ouvrir" className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
          <ExternalLink className="size-[18px]" />
        </Link>
        <button type="button" title="Fermer" onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-[18px]" />
        </button>
      </div>

      <div className="px-5 pb-4">
        <div className="flex gap-4">
          <span className="mt-1.5 size-3.5 shrink-0 rounded-[4px]" style={{ background: event.color }} />
          <div className="min-w-0">
            <h3 className={`text-[19px] leading-snug text-foreground ${info.status === "CANCELLED" || info.status === "DONE" ? "line-through decoration-1 opacity-70" : ""}`}>{event.title}</h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{when}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {info.subtypeLabel}
              {STATUS_LABEL[info.status] ? ` · ${STATUS_LABEL[info.status]}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-3 pl-0.5">
          {info.videoUrl && active && (
            <Row icon={Video}>
              <Button asChild size="sm" className="h-9 rounded-full bg-[#1a73e8] px-5 hover:bg-[#1765cc]">
                <a href={info.videoUrl} target="_blank" rel="noreferrer">
                  Rejoindre la visio
                </a>
              </Button>
              <p className="mt-1 truncate text-[12px] text-muted-foreground">{info.videoUrl.replace(/^https?:\/\//, "")}</p>
            </Row>
          )}
          {info.location && <Row icon={info.subtype === "PHONE" ? Phone : MapPin}>{info.location}</Row>}
          {info.contact && (
            <Row icon={UserRound}>
              <Link href={`/contacts/${info.contact.id}`} className="font-medium text-foreground hover:underline">
                {info.contact.name}
              </Link>
              {(info.contact.email || info.contact.phone) && <p className="truncate text-[12px] text-muted-foreground">{[info.contact.email, info.contact.phone].filter(Boolean).join(" · ")}</p>}
            </Row>
          )}
          {info.description && (
            <Row icon={AlignLeft}>
              <p className="line-clamp-4 whitespace-pre-line text-muted-foreground">{info.description}</p>
            </Row>
          )}
          {isMeeting && info.contact?.email && active && <Row icon={Bell}>Rappels envoyés au contact 24 h et 1 h avant</Row>}
          <Row icon={User}>{info.ownerName}</Row>
        </div>

        {cancelling ? (
          <div className="mt-3 space-y-3 rounded-xl border bg-muted/40 p-3">
            <p className="font-medium">Annuler ce rendez-vous ?</p>
            <Input className="h-9 bg-white" placeholder="Motif (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} />
            {info.contact?.email && (
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={notify} onCheckedChange={(c) => setNotify(Boolean(c))} /> Prévenir {info.contact.name} par email
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
                Retour
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => cancel.run()}>
                {cancel.pending && <Spinner />} Annuler le RDV
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {isMeeting && active && past && (
              <>
                <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => outcome.run("NO_SHOW")}>
                  Contact absent
                </Button>
                <Button size="sm" className="rounded-full" disabled={busy} onClick={() => outcome.run("COMPLETED")}>
                  {outcome.pending ? <Spinner /> : <Check />} RDV réalisé
                </Button>
              </>
            )}
            {info.kind === "task" && info.status === "OPEN" && (
              <Button size="sm" className="rounded-full" disabled={busy} onClick={() => complete.run()}>
                {complete.pending ? <Spinner /> : <Check />} Marquer comme faite
              </Button>
            )}
            {info.kind === "task" && info.status === "DONE" && (
              <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => reopen.run()}>
                {reopen.pending ? <Spinner /> : <RotateCcw />} Rouvrir
              </Button>
            )}
            {info.kind === "step" && (
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link href={info.url}>{info.status === "PENDING_APPROVAL" ? "Valider la relance" : "Voir les relances"}</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
