"use client";

import { useState } from "react";
import { AlertTriangle, Archive, CalendarClock, Check, Pencil, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DealDialog, NextActionDialog, StageDialog, type DealDialogInitial } from "@/components/dialogs/deal-dialogs";
import { ConfirmButton } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { archiveDealAction } from "@/actions/deals";
import { NEXT_ACTION_LABELS, STAGE_COLORS, STAGE_LABELS } from "@/lib/labels";
import { formatSmart } from "@/lib/dates";
import type { DealStage, NextActionType } from "@/generated/prisma/enums";

const FLOW: DealStage[] = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"];

export function StageStepper({ dealId, stage, hasNextAction, amount }: { dealId: string; stage: DealStage; hasNextAction: boolean; amount: string }) {
  const [target, setTarget] = useState<DealStage | null>(null);
  const currentIndex = FLOW.indexOf(stage);
  const closed = stage === "WON" || stage === "LOST";
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="flex flex-1 overflow-hidden rounded-lg surface">
        {FLOW.map((s, i) => {
          const done = closed ? stage === "WON" : i < currentIndex;
          const active = s === stage;
          return (
            <button
              key={s}
              onClick={() => s !== stage && setTarget(s)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 border-r px-2 py-2 text-xs font-medium transition-colors last:border-r-0",
                active ? cn(STAGE_COLORS[s].badge, "font-semibold") : done ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-card text-muted-foreground hover:bg-accent",
              )}
              title={`Passer en « ${STAGE_LABELS[s]} »`}
            >
              {done && !active && <Check className="size-3" />}
              {STAGE_LABELS[s]}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={stage === "WON" ? "default" : "outline"} className={stage === "WON" ? "bg-emerald-600 hover:bg-emerald-700" : "text-emerald-700"} onClick={() => stage !== "WON" && setTarget("WON")}>
          Signé
        </Button>
        <Button size="sm" variant={stage === "LOST" ? "destructive" : "outline"} className={stage !== "LOST" ? "text-rose-700" : ""} onClick={() => stage !== "LOST" && setTarget("LOST")}>
          Refusé
        </Button>
      </div>
      {target && <StageDialog open onOpenChange={(o) => !o && setTarget(null)} dealId={dealId} currentStage={stage} targetStage={target} hasNextAction={hasNextAction} amount={amount} />}
    </div>
  );
}

export function NextActionBanner({ dealId, closed, nextActionAt, nextActionType, nextActionLabel, overdue, tz }: { dealId: string; closed: boolean; nextActionAt: Date | null; nextActionType: NextActionType | null; nextActionLabel: string | null; overdue: boolean; tz: string }) {
  const [open, setOpen] = useState(false);
  if (closed) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm",
        !nextActionAt ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : overdue ? "bg-rose-50 text-rose-900 ring-1 ring-rose-200" : "bg-sky-50 text-sky-900 ring-1 ring-sky-200",
      )}
    >
      {nextActionAt ? <CalendarClock className="size-4" /> : <AlertTriangle className="size-4" />}
      <div className="flex-1">
        {nextActionAt ? (
          <>
            <span className="font-semibold">Prochaine action{overdue ? " (en retard)" : ""} : </span>
            {nextActionLabel || (nextActionType ? NEXT_ACTION_LABELS[nextActionType] : "")} · <strong>{formatSmart(nextActionAt, { tz })}</strong>
          </>
        ) : (
          <span className="font-semibold">Aucune prochaine action planifiée : ce dossier est bloqué.</span>
        )}
      </div>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock /> {nextActionAt ? "Ajouter une action" : "Planifier la prochaine action"}
      </Button>
      {open && <NextActionDialog open onOpenChange={setOpen} dealId={dealId} />}
    </div>
  );
}

export function DealEditButtons({ initial, archived }: { initial: DealDialogInitial & { id: string }; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const archive = useAction((v: boolean) => archiveDealAction(initial.id, v));
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> Modifier
      </Button>
      {archived ? (
        <Button size="sm" variant="outline" onClick={() => archive.run(false)}>
          <RotateCcw /> Restaurer
        </Button>
      ) : (
        <ConfirmButton title="Archiver ce dossier ?" description="Il n'apparaîtra plus dans le pipeline et ses relances automatiques seront arrêtées." onConfirm={() => archive.run(true)}>
          <Archive /> Archiver
        </ConfirmButton>
      )}
      {open && <DealDialog open onOpenChange={setOpen} initial={initial} />}
    </>
  );
}
