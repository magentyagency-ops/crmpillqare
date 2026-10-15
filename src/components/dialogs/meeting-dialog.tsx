"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AsyncPicker } from "@/components/common/async-picker";
import { DateTimeField, FormField, SelectField, QuickDates } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { createMeetingAction, rescheduleMeetingAction } from "@/actions/meetings";
import type { MeetingType } from "@/generated/prisma/enums";

export function MeetingDialog({
  open,
  onOpenChange,
  contact: initialContact,
  dealId,
  defaultStart,
  defaultDurationMin,
  defaultTitle,
  defaultType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: PickerOption | null;
  dealId?: string | null;
  defaultStart?: string;
  defaultDurationMin?: number;
  defaultTitle?: string;
  defaultType?: MeetingType;
  /** Rester sur la page (fiche, agenda) après la création au lieu d'ouvrir le RDV */
  onCreated?: (id: string) => void;
}) {
  const { me, users, integrations } = useAppData();
  const router = useRouter();
  const [type, setType] = useState<MeetingType>(defaultType ?? "VIDEO");
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [start, setStart] = useState(defaultStart ?? "");
  const [duration, setDuration] = useState(String(defaultDurationMin ?? 30));
  const [organizerId, setOrganizerId] = useState(me.id);
  const [contact, setContact] = useState<PickerOption | null>(initialContact ?? null);
  const [location, setLocation] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(true);

  const create = useAction(createMeetingAction, {
    success: false,
    onSuccess: (data) => {
      onOpenChange(false);
      if (!data) return;
      if (onCreated) {
        onCreated(data.id);
        toast.success("Rendez-vous planifié", { action: { label: "Ouvrir", onClick: () => router.push(`/agenda/${data.id}`) } });
      } else {
        toast.success("Rendez-vous planifié");
        router.push(`/agenda/${data.id}`);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Planifier un rendez-vous</DialogTitle>
          <DialogDescription>
            {integrations.google
              ? "Le RDV est ajouté à Google Agenda (avec lien Google Meet pour les visios) et le contact reçoit une confirmation et des rappels."
              : "Le contact reçoit une confirmation et des rappels. Connectez Google Agenda pour synchroniser votre calendrier et générer les liens Meet."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.run({
              title,
              type,
              start,
              durationMin: Number(duration),
              organizerId,
              contactId: contact?.id ?? null,
              dealId: dealId ?? null,
              location,
              videoUrl,
              attendees,
              description,
              sendConfirmation,
            });
          }}
        >
          <ToggleGroup type="single" variant="outline" value={type} onValueChange={(v) => v && setType(v as MeetingType)} className="w-full">
            <ToggleGroupItem value="VIDEO" className="flex-1">
              Visio
            </ToggleGroupItem>
            <ToggleGroupItem value="PHONE" className="flex-1">
              Téléphone
            </ToggleGroupItem>
            <ToggleGroupItem value="IN_PERSON" className="flex-1">
              Physique
            </ToggleGroupItem>
          </ToggleGroup>
          <FormField label="Contact">
            <AsyncPicker value={contact} onChange={setContact} search={searchContactsAction} placeholder="Rechercher un contact…" disabled={Boolean(initialContact && dealId)} />
          </FormField>
          <FormField label="Titre" hint="Par défaut : « RDV PillQare — organisation »">
            <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
            <FormField label="Date et heure" required>
              <DateTimeField value={start} onChange={setStart} allowNoTime={false} />
              <QuickDates tz={me.timezone} onPick={(day) => setStart(`${day}T${start.split("T")[1] || "10:00"}`)} />
            </FormField>
            <FormField label="Durée">
              <SelectField value={duration} onChange={setDuration} options={[...new Set(["15", "30", "45", "60", "90", "120", duration])].sort((a, b) => Number(a) - Number(b)).map((d) => ({ value: d, label: `${d} min` }))} />
            </FormField>
          </div>
          {type === "IN_PERSON" && (
            <FormField label="Lieu" required>
              <Input className="h-9" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Adresse du rendez-vous" />
            </FormField>
          )}
          {type === "PHONE" && (
            <FormField label="Numéro à appeler" hint="Par défaut : le téléphone du contact">
              <Input className="h-9" value={location} onChange={(e) => setLocation(e.target.value)} />
            </FormField>
          )}
          {type === "VIDEO" && (
            <FormField label="Lien de visio" hint={integrations.google ? "Laissez vide : un lien Google Meet est créé automatiquement." : "Collez un lien Meet / Teams / Zoom."}>
              <Input className="h-9" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
            </FormField>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Organisateur">
              <SelectField value={organizerId} onChange={setOrganizerId} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
            <FormField label="Autres participants" hint="Emails séparés par des virgules">
              <Input className="h-9" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Ordre du jour / notes">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sendConfirmation} onCheckedChange={(c) => setSendConfirmation(Boolean(c))} />
            Envoyer la confirmation au contact (rappels automatiques 24 h et 1 h avant)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.pending || !start.includes("T") || (type === "IN_PERSON" && !location)}>
              {create.pending && <Spinner />} Planifier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RescheduleDialog({ open, onOpenChange, meetingId, start, durationMin }: { open: boolean; onOpenChange: (v: boolean) => void; meetingId: string; start: string; durationMin: number }) {
  const [value, setValue] = useState(start);
  const [notify, setNotify] = useState(true);
  const save = useAction((s: string) => rescheduleMeetingAction(meetingId, s, durationMin, notify), { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Déplacer le rendez-vous</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <DateTimeField value={value} onChange={setValue} allowNoTime={false} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={notify} onCheckedChange={(c) => setNotify(Boolean(c))} /> Prévenir le contact par email
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={save.pending || !value.includes("T")} onClick={() => save.run(value)}>
            {save.pending && <Spinner />} Déplacer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
