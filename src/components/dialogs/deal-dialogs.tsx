"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AsyncPicker } from "@/components/common/async-picker";
import { DateTimeField, FormField, QuickDates, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { createDealAction, moveDealStageAction, setNextActionAction, updateDealAction } from "@/actions/deals";
import { NEXT_ACTION_LABELS, SOURCE_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import type { ContactSource, DealStage, NextActionType } from "@/generated/prisma/enums";

function NextActionFields({
  type,
  setType,
  due,
  setDue,
  label,
  setLabel,
  required = true,
}: {
  type: NextActionType;
  setType: (t: NextActionType) => void;
  due: string;
  setDue: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
  required?: boolean;
}) {
  const { me } = useAppData();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
        <FormField label="Prochaine action" required={required}>
          <SelectField value={type} onChange={(x) => setType(x as NextActionType)} options={Object.entries(NEXT_ACTION_LABELS).map(([value, l]) => ({ value, label: l }))} />
        </FormField>
        <FormField label="Échéance" required={required}>
          <DateTimeField value={due} onChange={setDue} />
          <QuickDates onPick={setDue} tz={me.timezone} />
        </FormField>
      </div>
      <FormField label="Précision (facultatif)">
        <Input className="h-9" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. : rappeler après validation en réunion d'équipe" />
      </FormField>
    </div>
  );
}

export type DealDialogInitial = {
  id?: string;
  title: string;
  contact: PickerOption | null;
  ownerId: string;
  stage: DealStage;
  amount: string;
  quantity: string;
  expectedCloseAt: string;
  source: ContactSource;
  notes: string;
  segmentId: string;
};

export function DealDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<DealDialogInitial>;
}) {
  const { me, users, segments } = useAppData();
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [v, setV] = useState<DealDialogInitial>({
    title: "",
    contact: null,
    ownerId: me.id,
    stage: "PROSPECT",
    amount: "",
    quantity: "",
    expectedCloseAt: "",
    source: "MANUAL",
    notes: "",
    segmentId: "",
    ...initial,
  });
  const [nextType, setNextType] = useState<NextActionType>("CALL");
  const [nextDue, setNextDue] = useState("");
  const [nextLabel, setNextLabel] = useState("");
  const set = <K extends keyof DealDialogInitial>(k: K, val: DealDialogInitial[K]) => setV((p) => ({ ...p, [k]: val }));

  const create = useAction(createDealAction, {
    onSuccess: (data) => {
      onOpenChange(false);
      if (data) router.push(`/pipeline/${data.id}`);
    },
  });
  const update = useAction((id: string, input: Parameters<typeof updateDealAction>[1]) => updateDealAction(id, input), { onSuccess: () => onOpenChange(false) });
  const pending = create.pending || update.pending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = {
      title: v.title || (v.contact ? `${v.contact.sublabel?.split(" · ")[0] || v.contact.label}` : ""),
      ownerId: v.ownerId,
      amount: v.amount,
      quantity: v.quantity,
      expectedCloseAt: v.expectedCloseAt,
      source: v.source,
      notes: v.notes,
      segmentId: v.segmentId,
    };
    if (editing) update.run(initial!.id!, base);
    else create.run({ ...base, contactId: v.contact?.id ?? "", stage: v.stage, nextAction: v.stage === "WON" || v.stage === "LOST" ? null : { type: nextType, dueAt: nextDue, label: nextLabel } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le dossier" : "Nouveau dossier commercial"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!editing && (
            <FormField label="Contact" required>
              <AsyncPicker value={v.contact} onChange={(o) => set("contact", o)} search={searchContactsAction} placeholder="Rechercher un contact…" />
            </FormField>
          )}
          <FormField label="Titre du dossier" hint={!editing ? "Laissez vide pour utiliser le nom de l'organisation / du contact." : undefined}>
            <Input className="h-9" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex. : Équipement de l'EHPAD Les Tilleuls" />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Commercial responsable" required>
              <SelectField value={v.ownerId} onChange={(x) => set("ownerId", x)} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
            {!editing ? (
              <FormField label="Étape">
                <SelectField value={v.stage} onChange={(x) => set("stage", x as DealStage)} options={STAGE_ORDER.filter((s) => s !== "LOST").map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />
              </FormField>
            ) : (
              <FormField label="Cible">
                <SelectField value={v.segmentId} onChange={(x) => set("segmentId", x)} placeholder="Non classé" options={segments.map((s) => ({ value: s.id, label: s.name }))} />
              </FormField>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Montant estimé (€ HT)">
              <Input className="h-9" inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} />
            </FormField>
            <FormField label="Quantité (piluliers)">
              <Input className="h-9" inputMode="numeric" value={v.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </FormField>
            <FormField label="Signature prévue">
              <Input className="h-9" type="date" value={v.expectedCloseAt} onChange={(e) => set("expectedCloseAt", e.target.value)} />
            </FormField>
          </div>
          <FormField label="Origine">
            <SelectField value={v.source} onChange={(x) => set("source", x as ContactSource)} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
          </FormField>
          <FormField label="Notes">
            <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
          {!editing && v.stage !== "WON" && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <NextActionFields type={nextType} setType={setNextType} due={nextDue} setDue={setNextDue} label={nextLabel} setLabel={setNextLabel} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} {editing ? "Enregistrer" : "Créer le dossier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Changement d'étape : motif obligatoire pour « Refusé », prochaine action pour les étapes ouvertes. */
export function StageDialog({
  open,
  onOpenChange,
  dealId,
  currentStage,
  targetStage,
  hasNextAction,
  amount,
  dealTitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dealId: string;
  currentStage: DealStage;
  targetStage: DealStage;
  hasNextAction: boolean;
  amount?: string;
  /** Rappelé dans la fenêtre (utile depuis le kanban) */
  dealTitle?: string;
}) {
  const { lostReasons } = useAppData();
  const [reasonId, setReasonId] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [finalAmount, setFinalAmount] = useState(amount ?? "");
  const [planNext, setPlanNext] = useState(!hasNextAction);
  const [nextType, setNextType] = useState<NextActionType>(targetStage === "QUOTE" ? "QUOTE" : targetStage === "FOLLOW_UP" ? "FOLLOW_UP" : "CALL");
  const [nextDue, setNextDue] = useState("");
  const [nextLabel, setNextLabel] = useState("");
  const [revisitAt, setRevisitAt] = useState("");
  const move = useAction((input: Parameters<typeof moveDealStageAction>[1]) => moveDealStageAction(dealId, input), { onSuccess: () => onOpenChange(false) });
  const closed = targetStage === "WON" || targetStage === "LOST";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {STAGE_LABELS[currentStage]} → {STAGE_LABELS[targetStage]}
          </DialogTitle>
          <DialogDescription>
            {dealTitle && <span className="block font-medium text-foreground">{dealTitle}</span>}
            {targetStage === "LOST"
              ? "Indiquez le motif du refus : il alimente l'analyse des pertes."
              : targetStage === "WON"
                ? "Bravo ! Confirmez le montant signé."
                : "Les relances automatiques s'adaptent à la nouvelle étape."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            move.run({
              stage: targetStage,
              lostReasonId: reasonId || null,
              lostReasonDetail: detail || null,
              note: note || null,
              amount: finalAmount || null,
              nextAction: !closed && planNext ? { type: nextType, dueAt: nextDue, label: nextLabel } : null,
              revisitAt: targetStage === "LOST" && revisitAt ? revisitAt : null,
            });
          }}
        >
          {targetStage === "LOST" && (
            <>
              <FormField label="Motif du refus" required>
                <SelectField value={reasonId} onChange={setReasonId} placeholder="Choisir un motif…" options={lostReasons.map((r) => ({ value: r.id, label: r.label }))} />
              </FormField>
              <FormField label="Précisions">
                <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Concurrent retenu, budget, contexte…" />
              </FormField>
              <FormField label="Recontacter plus tard (facultatif)" hint="Crée une relance sur la fiche du contact à cette date.">
                <DateTimeField value={revisitAt} onChange={setRevisitAt} />
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: "Dans 3 mois", months: 3 },
                    { label: "Dans 6 mois", months: 6 },
                    { label: "Dans 1 an", months: 12 },
                  ].map((o) => (
                    <button
                      key={o.months}
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + o.months);
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setRevisitAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                      }}
                      className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </FormField>
            </>
          )}
          {targetStage === "WON" && (
            <FormField label="Montant signé (€ HT)">
              <Input className="h-9" inputMode="decimal" value={finalAmount} onChange={(e) => setFinalAmount(e.target.value)} />
            </FormField>
          )}
          {targetStage !== "LOST" && (
            <FormField label="Commentaire (facultatif)">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          )}
          {!closed && (
            <div className="rounded-lg border bg-muted/40 p-3">
              {hasNextAction && (
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={planNext} onChange={(e) => setPlanNext(e.target.checked)} /> Planifier une nouvelle action
                </label>
              )}
              {planNext && <NextActionFields type={nextType} setType={setNextType} due={nextDue} setDue={setNextDue} label={nextLabel} setLabel={setNextLabel} />}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={move.pending || (targetStage === "LOST" && !reasonId) || (!closed && planNext && !nextDue)}>
              {move.pending && <Spinner />} Confirmer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NextActionDialog({ open, onOpenChange, dealId }: { open: boolean; onOpenChange: (v: boolean) => void; dealId: string }) {
  const [type, setType] = useState<NextActionType>("CALL");
  const [due, setDue] = useState("");
  const [label, setLabel] = useState("");
  const save = useAction((input: Parameters<typeof setNextActionAction>[1]) => setNextActionAction(dealId, input), { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Planifier la prochaine action</DialogTitle>
          <DialogDescription>Chaque dossier doit avoir une prochaine action datée.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.run({ type, dueAt: due, label });
          }}
        >
          <NextActionFields type={type} setType={setType} due={due} setDue={setDue} label={label} setLabel={setLabel} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.pending || !due}>
              {save.pending && <Spinner />} Planifier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
