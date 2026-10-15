"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Play, RotateCw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { DateTimeField, FormField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { approveStepAction, previewStepRunAction, runStepNowAction, skipStepAction, updateStepRunAction } from "@/actions/sequences";
import type { StepRunStatus } from "@/generated/prisma/enums";

/** Validation (ou modification) d'une relance email avant envoi. */
function ReviewDialog({ runId, mode, scheduledAt, onClose }: { runId: string; mode: "approve" | "edit"; scheduledAt: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rawSubject, setRawSubject] = useState("");
  const [date, setDate] = useState(scheduledAt);
  const [threaded, setThreaded] = useState(false);
  useEffect(() => {
    previewStepRunAction(runId).then((res) => {
      setLoading(false);
      if (res.ok && res.data) {
        setTo(res.data.to);
        setRawSubject(res.data.rawSubject);
        setThreaded(!res.data.rawSubject);
        setSubject(res.data.rawSubject ? res.data.subject : "");
        setBody(res.data.body);
      }
    });
  }, [runId]);
  const approve = useAction(() => approveStepAction(runId, { subject: threaded ? null : subject, body }), { onSuccess: onClose });
  const save = useAction(() => updateStepRunAction(runId, { subject: threaded ? (rawSubject || null) : subject, body, scheduledAt: date }), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "approve" ? "Valider la relance" : "Modifier la relance"}</DialogTitle>
          <DialogDescription>{to ? `Destinataire : ${to}` : "Le contact n'a pas d'adresse email."} La signature du commercial est ajoutée automatiquement.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            {threaded ? (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Cette relance est envoyée en réponse dans le fil du premier email (« Re: … »).</p>
            ) : (
              <FormField label="Objet">
                <Input className="h-9" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </FormField>
            )}
            <FormField label="Message">
              <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
            </FormField>
            {mode === "edit" && (
              <FormField label="Date d'envoi">
                <DateTimeField value={date} onChange={setDate} allowNoTime={false} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          {mode === "approve" ? (
            <Button disabled={approve.pending || loading || !to} onClick={() => approve.run()}>
              {approve.pending ? <Spinner /> : <Check />} Valider et envoyer
            </Button>
          ) : (
            <Button disabled={save.pending || loading} onClick={() => save.run()}>
              {save.pending && <Spinner />} Enregistrer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StepRunActions({ runId, status, type, scheduledAtLocal }: { runId: string; status: StepRunStatus; type: "EMAIL" | "CALL" | "TASK"; scheduledAtLocal: string }) {
  const [review, setReview] = useState<"approve" | "edit" | null>(null);
  const skip = useAction(() => skipStepAction(runId));
  const now = useAction(() => runStepNowAction(runId));
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {status === "PENDING_APPROVAL" && (
        <Button size="xs" onClick={() => setReview("approve")}>
          <Check /> Valider
        </Button>
      )}
      {status === "SCHEDULED" && type === "EMAIL" && (
        <Button size="xs" variant="outline" onClick={() => setReview("edit")}>
          <Pencil /> Modifier
        </Button>
      )}
      {status === "SCHEDULED" && (
        <Button size="xs" variant="outline" disabled={now.pending} onClick={() => now.run()}>
          <Play /> {type === "EMAIL" ? "Envoyer maintenant" : "Créer la tâche"}
        </Button>
      )}
      {status === "FAILED" && (
        <Button size="xs" variant="outline" disabled={now.pending} onClick={() => now.run()}>
          <RotateCw /> Réessayer
        </Button>
      )}
      {(status === "SCHEDULED" || status === "PENDING_APPROVAL" || status === "FAILED") && (
        <Button size="xs" variant="ghost" disabled={skip.pending} onClick={() => skip.run()} title="Ignorer cette étape">
          <SkipForward />
        </Button>
      )}
      {review && <ReviewDialog runId={runId} mode={review} scheduledAt={scheduledAtLocal} onClose={() => setReview(null)} />}
    </div>
  );
}
