"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle2, MailCheck, Pencil, UserX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { FormField } from "@/components/common/fields";
import { RescheduleDialog } from "@/components/dialogs/meeting-dialog";
import { useAction } from "@/hooks/use-action";
import { cancelMeetingAction, resendMeetingConfirmationAction, setMeetingOutcomeAction, updateMeetingDetailsAction } from "@/actions/meetings";
import type { MeetingStatus } from "@/generated/prisma/enums";

export function MeetingActions({
  id,
  status,
  past,
  start,
  durationMin,
  hasContactEmail,
  details,
}: {
  id: string;
  status: MeetingStatus;
  past: boolean;
  start: string;
  durationMin: number;
  hasContactEmail: boolean;
  details: { title: string; description: string; videoUrl: string; location: string };
}) {
  const [reschedule, setReschedule] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [edit, setEdit] = useState(false);
  const outcome = useAction((o: "COMPLETED" | "NO_SHOW") => setMeetingOutcomeAction(id, o));
  const resend = useAction(() => resendMeetingConfirmationAction(id));
  const scheduled = status === "SCHEDULED";
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
        <Pencil /> Modifier
      </Button>
      {(scheduled || status === "CANCELLED") && (
        <Button size="sm" variant="outline" onClick={() => setReschedule(true)}>
          <CalendarClock /> {status === "CANCELLED" ? "Reprogrammer" : "Déplacer"}
        </Button>
      )}
      {scheduled && hasContactEmail && (
        <Button size="sm" variant="outline" disabled={resend.pending} onClick={() => resend.run()}>
          <MailCheck /> Renvoyer la confirmation
        </Button>
      )}
      {(past || status !== "SCHEDULED") && status !== "CANCELLED" && (
        <>
          <Button size="sm" variant="outline" disabled={outcome.pending || status === "COMPLETED"} onClick={() => outcome.run("COMPLETED")}>
            <CheckCircle2 /> Réalisé
          </Button>
          <Button size="sm" variant="outline" disabled={outcome.pending || status === "NO_SHOW"} onClick={() => outcome.run("NO_SHOW")}>
            <UserX /> Absent
          </Button>
        </>
      )}
      {scheduled && (
        <Button size="sm" variant="outline" className="text-rose-700" onClick={() => setCancel(true)}>
          <XCircle /> Annuler
        </Button>
      )}
      {reschedule && <RescheduleDialog open onOpenChange={setReschedule} meetingId={id} start={start} durationMin={durationMin} />}
      {cancel && <CancelDialog id={id} onClose={() => setCancel(false)} />}
      {edit && <EditDialog id={id} initial={details} onClose={() => setEdit(false)} />}
    </>
  );
}

function CancelDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const cancel = useAction(() => cancelMeetingAction(id, reason || null, notify), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Annuler le rendez-vous</DialogTitle>
        </DialogHeader>
        <FormField label="Motif (facultatif)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={notify} onCheckedChange={(c) => setNotify(Boolean(c))} /> Prévenir le contact par email (avec le lien pour reprendre RDV)
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Retour
          </Button>
          <Button variant="destructive" disabled={cancel.pending} onClick={() => cancel.run()}>
            {cancel.pending && <Spinner />} Annuler le RDV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ id, initial, onClose }: { id: string; initial: { title: string; description: string; videoUrl: string; location: string }; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const save = useAction(() => updateMeetingDetailsAction(id, v), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier le rendez-vous</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Titre">
            <Input className="h-9" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </FormField>
          <FormField label="Lien de visio">
            <Input className="h-9" value={v.videoUrl} onChange={(e) => setV({ ...v, videoUrl: e.target.value })} />
          </FormField>
          <FormField label="Lieu">
            <Input className="h-9" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
          </FormField>
          <FormField label="Ordre du jour / notes de préparation">
            <Textarea rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={save.pending} onClick={() => save.run()}>
            {save.pending && <Spinner />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
