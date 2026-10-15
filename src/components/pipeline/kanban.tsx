"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, CalendarClock, Trophy, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import { UserAvatar } from "@/components/common/ui-bits";
import { StageDialog } from "@/components/dialogs/deal-dialogs";
import { BLOCKED_REASON_LABELS, NEXT_ACTION_LABELS, STAGE_COLORS, STAGE_LABELS, type BlockedReason } from "@/lib/labels";
import { formatEUR } from "@/lib/format";
import { formatSmart } from "@/lib/dates";
import type { DealStage, NextActionType } from "@/generated/prisma/enums";

export type KanbanDeal = {
  id: string;
  title: string;
  stage: DealStage;
  amount: number | null;
  contactName: string;
  companyName: string | null;
  owner: { firstName: string; lastName: string; color: string };
  nextActionAt: Date | null;
  nextActionType: NextActionType | null;
  nextActionLabel: string | null;
  segment: { name: string; color: string } | null;
  blocked: BlockedReason[];
  kind: "B2B" | "B2C";
};

const COLUMNS: DealStage[] = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"];

/** Changement d'étape sans glisser-déposer (tablette, téléphone, clavier). */
function StageMenu({ deal, onMove }: { deal: KanbanDeal; onMove: (to: DealStage) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Changer l'étape de « ${deal.title} »`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <ArrowRightLeft className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Passer à l&apos;étape</DropdownMenuLabel>
        {COLUMNS.filter((s) => s !== deal.stage).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
            {STAGE_LABELS[s]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMove("WON")} className="text-emerald-700">
          <Trophy /> Signé
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove("LOST")} className="text-rose-700">
          <XCircle /> Refusé
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DealCard({ deal, onDragStart, onMove, tz }: { deal: KanbanDeal; onDragStart: (e: React.DragEvent, id: string) => void; onMove: (to: DealStage) => void; tz: string }) {
  const overdue = deal.blocked.includes("OVERDUE_ACTION");
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className={cn("group cursor-grab rounded-xl bg-card p-3 surface surface-hover active:cursor-grabbing", deal.blocked.length > 0 && "border-amber-300")}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/pipeline/${deal.id}`} className="text-sm leading-snug font-medium hover:underline" draggable={false}>
          {deal.title}
        </Link>
        <span className="flex shrink-0 items-center gap-1">
          <StageMenu deal={deal} onMove={onMove} />
          <UserAvatar user={deal.owner} size="xs" />
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {deal.companyName ? `${deal.companyName} · ` : ""}
        {deal.contactName}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs">
          {deal.segment && <span className="size-2 rounded-full" style={{ backgroundColor: deal.segment.color }} title={deal.segment.name} />}
          <span className="text-muted-foreground">{deal.kind}</span>
        </span>
        {deal.amount ? <span className="text-sm font-semibold text-brand-navy tabular-nums">{formatEUR(deal.amount, { compact: true })}</span> : null}
      </div>
      <div className={cn("mt-2 flex items-center gap-1 border-t pt-2 text-[11px]", overdue ? "font-medium text-rose-600" : "text-muted-foreground")}>
        {deal.nextActionAt ? (
          <>
            <CalendarClock className="size-3 shrink-0" />
            <span className="truncate">
              {deal.nextActionType ? NEXT_ACTION_LABELS[deal.nextActionType] : "Action"} · {formatSmart(deal.nextActionAt, { tz })}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1 font-medium text-amber-700">
            <AlertTriangle className="size-3" /> Aucune prochaine action
          </span>
        )}
      </div>
      {deal.blocked.filter((b) => b !== "NO_NEXT_ACTION" && b !== "OVERDUE_ACTION").length > 0 && (
        <div className="mt-1 text-[10px] font-medium text-amber-700">
          {deal.blocked
            .filter((b) => b !== "NO_NEXT_ACTION" && b !== "OVERDUE_ACTION")
            .map((b) => BLOCKED_REASON_LABELS[b])
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

export function Kanban({ deals, tz }: { deals: KanbanDeal[]; tz: string }) {
  const [over, setOver] = useState<DealStage | null>(null);
  const [move, setMove] = useState<{ deal: KanbanDeal; to: DealStage } | null>(null);

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/deal", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e: React.DragEvent, stage: DealStage) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/deal");
    const deal = deals.find((d) => d.id === id);
    if (deal && deal.stage !== stage) setMove({ deal, to: stage });
  };
  const dropProps = (stage: DealStage) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(stage);
    },
    onDragLeave: () => setOver((s) => (s === stage ? null : s)),
    onDrop: (e: React.DragEvent) => onDrop(e, stage),
  });

  return (
    <>
      <div data-tour="kanban" className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((stage) => {
          const items = deals.filter((d) => d.stage === stage);
          const total = items.reduce((a, d) => a + (d.amount ?? 0), 0);
          return (
            <div
              key={stage}
              {...dropProps(stage)}
              className={cn("flex w-68 shrink-0 flex-col rounded-2xl bg-slate-100/80 p-2 transition-colors", over === stage && "bg-[#eef2fa] ring-2 ring-primary/25")}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className={cn("size-2 rounded-full", STAGE_COLORS[stage].dot)} />
                  {STAGE_LABELS[stage]}
                  <span className="rounded-md bg-white px-1.5 text-[11px] font-medium text-muted-foreground shadow-xs">{items.length}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatEUR(total, { compact: true })}</span>
              </div>
              <div className="flex min-h-24 flex-col gap-2">
                {items.map((d) => (
                  <DealCard key={d.id} deal={d} onDragStart={onDragStart} onMove={(to) => setMove({ deal: d, to })} tz={tz} />
                ))}
                {items.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-muted-foreground">Déposez un dossier ici</div>}
              </div>
            </div>
          );
        })}
        <div className="flex w-56 shrink-0 flex-col gap-3">
          <div {...dropProps("WON")} className={cn("flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-4 text-center text-emerald-800", over === "WON" && "bg-emerald-100")}>
            <Trophy className="mb-1 size-6" />
            <span className="text-sm font-semibold">Signé</span>
            <span className="text-xs opacity-75">Déposez ici un dossier gagné</span>
          </div>
          <div {...dropProps("LOST")} className={cn("flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/50 p-4 text-center text-rose-800", over === "LOST" && "bg-rose-100")}>
            <XCircle className="mb-1 size-6" />
            <span className="text-sm font-semibold">Refusé</span>
            <span className="text-xs opacity-75">Le motif sera demandé</span>
          </div>
        </div>
      </div>
      {move && (
        <StageDialog
          open
          onOpenChange={(o) => !o && setMove(null)}
          dealId={move.deal.id}
          currentStage={move.deal.stage}
          targetStage={move.to}
          hasNextAction={Boolean(move.deal.nextActionAt)}
          amount={move.deal.amount ? String(move.deal.amount) : ""}
          dealTitle={move.deal.title}
        />
      )}
    </>
  );
}
