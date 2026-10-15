"use client";

import { useState } from "react";
import Link from "next/link";
import { Phone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { DateTimeField, FormField, QuickDates, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { logCallAction } from "@/actions/contacts";
import { CALL_OUTCOME_LABELS, NEXT_ACTION_LABELS } from "@/lib/labels";
import type { CallOutcome, NextActionType } from "@/generated/prisma/enums";

/** Journal d'appel : résultat, notes, et prochaine action (dossier toujours planifié). */
export function CallLogDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  phone,
  dealId,
  taskId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  contactName: string;
  phone?: string | null;
  dealId?: string | null;
  taskId?: string | null;
}) {
  const { me } = useAppData();
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [outcome, setOutcome] = useState<CallOutcome>("REACHED");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [planNext, setPlanNext] = useState(true);
  const [nextType, setNextType] = useState<NextActionType>("CALL");
  const [nextDue, setNextDue] = useState("");
  const [nextLabel, setNextLabel] = useState("");
  const save = useAction(logCallAction, { onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Appel avec {contactName}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3">
            {phone && (
              <a href={`tel:${phone}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Phone className="size-3.5" /> {phone}
              </a>
            )}
            <Link href={`/assistant/nouveau?kind=CALL&contactId=${contactId}${dealId ? `&dealId=${dealId}` : ""}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Sparkles className="size-3.5" /> Enregistrer avec l&apos;assistant IA (compte rendu automatique)
            </Link>
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.run({
              contactId,
              dealId: dealId ?? null,
              taskId: taskId ?? null,
              direction,
              outcome,
              durationMin: duration,
              notes,
              nextAction: planNext && nextDue ? { type: nextType, dueAt: nextDue, label: nextLabel } : null,
            });
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_110px]">
            <FormField label="Sens">
              <SelectField value={direction} onChange={(x) => setDirection(x as "OUTBOUND" | "INBOUND")} options={[{ value: "OUTBOUND", label: "Sortant" }, { value: "INBOUND", label: "Entrant" }]} />
            </FormField>
            <FormField label="Résultat">
              <SelectField value={outcome} onChange={(x) => setOutcome(x as CallOutcome)} options={Object.entries(CALL_OUTCOME_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            <FormField label="Durée (min)">
              <Input className="h-9" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Notes de l'appel">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Besoins, objections, informations clés…" />
          </FormField>
          <div className="rounded-lg border bg-muted/40 p-3">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={planNext} onCheckedChange={(c) => setPlanNext(Boolean(c))} /> Planifier la prochaine action
            </label>
            {planNext && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
                  <FormField label="Action">
                    <SelectField value={nextType} onChange={(x) => setNextType(x as NextActionType)} options={Object.entries(NEXT_ACTION_LABELS).map(([value, label]) => ({ value, label }))} />
                  </FormField>
                  <FormField label="Échéance">
                    <DateTimeField value={nextDue} onChange={setNextDue} />
                    <QuickDates onPick={setNextDue} tz={me.timezone} />
                  </FormField>
                </div>
                <Input className="h-9" value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} placeholder="Précision (facultatif)" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.pending || (planNext && !nextDue)}>
              {save.pending && <Spinner />} Enregistrer l&apos;appel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
