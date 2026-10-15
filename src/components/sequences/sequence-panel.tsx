"use client";

import { useEffect, useState } from "react";
import { Mail, Pause, Phone, Play, Plus, Square, CheckSquare } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import {
  enrollAction,
  listSequencesForEnrollment,
  pauseEnrollmentAction,
  resumeEnrollmentAction,
  stopEnrollmentAction,
} from "@/actions/sequences";
import { STEP_RUN_STATUS_LABELS, STOP_REASON_LABELS } from "@/lib/labels";
import { formatSmart } from "@/lib/dates";
import type { EnrollmentStatus, EnrollmentStopReason, SequenceStepType, StepRunStatus } from "@/generated/prisma/enums";

export type EnrollmentView = {
  id: string;
  status: EnrollmentStatus;
  stopReason: EnrollmentStopReason | null;
  startedAt: Date;
  sequence: { name: string };
  runs: { id: string; position: number; type: SequenceStepType; status: StepRunStatus; scheduledAt: Date; executedAt: Date | null; repliedAt: Date | null; label: string }[];
};

const RUN_COLORS: Partial<Record<StepRunStatus, string>> = {
  SCHEDULED: "text-sky-700",
  PENDING_APPROVAL: "text-amber-700 font-medium",
  SENT: "text-emerald-700",
  DONE: "text-emerald-700",
  TASK_OPEN: "text-indigo-700",
  FAILED: "text-rose-600 font-medium",
  CANCELLED: "text-muted-foreground line-through",
  SKIPPED: "text-muted-foreground line-through",
};

const TYPE_ICON = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare } as const;

export function SequencePanel({ enrollments, contactId, dealId, tz }: { enrollments: EnrollmentView[]; contactId: string; dealId?: string | null; tz: string }) {
  const [enrollOpen, setEnrollOpen] = useState(false);
  const stop = useAction(stopEnrollmentAction);
  const pause = useAction(pauseEnrollmentAction);
  const resume = useAction(resumeEnrollmentAction);
  const now = new Date();
  return (
    <div className="space-y-3">
      {enrollments.length === 0 && <p className="text-sm text-muted-foreground">Aucune relance automatique pour l&apos;instant.</p>}
      {enrollments.map((e) => (
        <div key={e.id} className="rounded-lg border p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{e.sequence.name}</div>
              <div className="text-xs text-muted-foreground">
                {e.status === "ACTIVE" && "En cours"}
                {e.status === "PAUSED" && "En pause"}
                {e.status === "COMPLETED" && "Terminée"}
                {e.status === "STOPPED" && `Arrêtée — ${e.stopReason ? STOP_REASON_LABELS[e.stopReason] : ""}`}
              </div>
            </div>
            {(e.status === "ACTIVE" || e.status === "PAUSED") && (
              <div className="flex gap-1">
                {e.status === "ACTIVE" ? (
                  <Button size="icon-xs" variant="ghost" title="Mettre en pause" onClick={() => pause.run(e.id)}>
                    <Pause />
                  </Button>
                ) : (
                  <Button size="icon-xs" variant="ghost" title="Reprendre" onClick={() => resume.run(e.id)}>
                    <Play />
                  </Button>
                )}
                <Button size="icon-xs" variant="ghost" title="Arrêter" onClick={() => stop.run(e.id)}>
                  <Square />
                </Button>
              </div>
            )}
          </div>
          <ol className="space-y-1">
            {e.runs.map((r) => {
              const Icon = TYPE_ICON[r.type];
              const late = (r.status === "SCHEDULED" || r.status === "PENDING_APPROVAL") && r.scheduledAt < now;
              return (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className={cn("shrink-0", RUN_COLORS[r.status], late && "text-rose-600")}>
                    {r.repliedAt ? "Répondu ✓" : STEP_RUN_STATUS_LABELS[r.status]}
                    {" · "}
                    {formatSmart(r.executedAt ?? r.scheduledAt, { tz })}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-full" onClick={() => setEnrollOpen(true)}>
        <Plus /> Programmer des relances
      </Button>
      {enrollOpen && <EnrollDialog open onOpenChange={setEnrollOpen} contactId={contactId} dealId={dealId} />}
    </div>
  );
}

function EnrollDialog({ open, onOpenChange, contactId, dealId }: { open: boolean; onOpenChange: (v: boolean) => void; contactId: string; dealId?: string | null }) {
  const [sequences, setSequences] = useState<{ id: string; name: string }[] | null>(null);
  const [sequenceId, setSequenceId] = useState("");
  const enroll = useAction(enrollAction, { onSuccess: () => onOpenChange(false) });
  useEffect(() => {
    listSequencesForEnrollment().then(setSequences);
  }, []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Programmer des relances</DialogTitle>
        </DialogHeader>
        {sequences === null ? (
          <Spinner />
        ) : (
          <SelectField value={sequenceId} onChange={setSequenceId} placeholder="Choisir un scénario…" options={sequences.map((s) => ({ value: s.id, label: s.name }))} />
        )}
        <p className="text-xs text-muted-foreground">Les relances s&apos;arrêtent automatiquement si le contact répond, prend RDV ou si le dossier change d&apos;étape.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={!sequenceId || enroll.pending} onClick={() => enroll.run({ sequenceId, contactId, dealId })}>
            {enroll.pending && <Spinner />} Programmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
