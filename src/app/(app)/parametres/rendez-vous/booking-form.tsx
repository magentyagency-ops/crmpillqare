"use client";

import { useState } from "react";
import { Copy, ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { updateBookingAction } from "@/actions/settings";
import type { WorkingHours } from "@/lib/booking/slots";

const DAYS = [
  { key: "1", label: "Lundi" },
  { key: "2", label: "Mardi" },
  { key: "3", label: "Mercredi" },
  { key: "4", label: "Jeudi" },
  { key: "5", label: "Vendredi" },
  { key: "6", label: "Samedi" },
  { key: "0", label: "Dimanche" },
];

type Values = {
  bookingEnabled: boolean;
  bookingSlug: string;
  bookingTitle: string;
  bookingDescription: string;
  bookingDurationMin: string;
  bookingBufferMin: string;
  bookingMinNoticeHours: string;
  bookingMaxDaysAhead: string;
  bookingMeetingType: "VIDEO" | "PHONE" | "IN_PERSON";
  bookingLocation: string;
  videoRoomUrl: string;
  workingHours: WorkingHours;
};

export function BookingSettingsForm({ initial, appUrl, googleConnected }: { initial: Values; appUrl: string; googleConnected: boolean }) {
  const [v, setV] = useState(initial);
  const [slug, setSlug] = useState(initial.bookingSlug);
  const save = useAction(() => updateBookingAction(v), { onSuccess: (d) => d && setSlug(d.slug) });
  const url = `${appUrl}/rdv/${slug}`;
  const setRange = (day: string, i: number, j: 0 | 1, value: string) =>
    setV((p) => ({ ...p, workingHours: { ...p.workingHours, [day]: (p.workingHours[day] ?? []).map((r, k) => (k === i ? ((j === 0 ? [value, r[1]] : [r[0], value]) as [string, string]) : r)) } }));
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.run();
      }}
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 p-3 text-sm">
        <Switch checked={v.bookingEnabled} onCheckedChange={(c) => setV({ ...v, bookingEnabled: c })} />
        <span className="font-medium">{v.bookingEnabled ? "Prise de RDV en ligne active" : "Prise de RDV désactivée"}</span>
        <code className="rounded bg-background px-2 py-1 text-xs">{url}</code>
        <Button type="button" size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Lien copié"))}>
          <Copy /> Copier
        </Button>
        <Button type="button" size="xs" variant="outline" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Voir la page
          </a>
        </Button>
      </div>
      {!googleConnected && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">Connectez Google Agenda (Intégrations) pour que vos occupations personnelles bloquent les créneaux et générer automatiquement les liens Meet.</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Adresse du lien">
          <Input className="h-9" value={v.bookingSlug} onChange={(e) => setV({ ...v, bookingSlug: e.target.value })} />
        </FormField>
        <FormField label="Titre affiché">
          <Input className="h-9" value={v.bookingTitle} onChange={(e) => setV({ ...v, bookingTitle: e.target.value })} />
        </FormField>
        <FormField label="Type de rendez-vous">
          <SelectField value={v.bookingMeetingType} onChange={(x) => setV({ ...v, bookingMeetingType: x as Values["bookingMeetingType"] })} options={[{ value: "VIDEO", label: "Visio (Google Meet)" }, { value: "PHONE", label: "Téléphone" }, { value: "IN_PERSON", label: "Physique" }]} />
        </FormField>
        {v.bookingMeetingType === "IN_PERSON" && (
          <FormField label="Lieu">
            <Input className="h-9" value={v.bookingLocation} onChange={(e) => setV({ ...v, bookingLocation: e.target.value })} />
          </FormField>
        )}
        <FormField
          label="Lien de visio permanent (facultatif)"
          hint={googleConnected ? "Utilisé seulement si Google Meet ne peut pas générer de lien." : "Votre salle Meet, Zoom ou Teams : envoyé au contact pour chaque RDV en visio."}
        >
          <Input className="h-9" type="url" value={v.videoRoomUrl} onChange={(e) => setV({ ...v, videoRoomUrl: e.target.value })} placeholder="https://meet.google.com/abc-defg-hij" />
        </FormField>
      </div>
      <FormField label="Présentation (affichée sur la page)">
        <Textarea rows={3} value={v.bookingDescription} onChange={(e) => setV({ ...v, bookingDescription: e.target.value })} placeholder="Échange de 30 minutes pour découvrir le pilulier connecté PillQare et répondre à vos questions." />
      </FormField>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <FormField label="Durée (min)">
          <Input className="h-9" type="number" min={10} value={v.bookingDurationMin} onChange={(e) => setV({ ...v, bookingDurationMin: e.target.value })} />
        </FormField>
        <FormField label="Pause entre RDV (min)">
          <Input className="h-9" type="number" min={0} value={v.bookingBufferMin} onChange={(e) => setV({ ...v, bookingBufferMin: e.target.value })} />
        </FormField>
        <FormField label="Délai minimum (heures)">
          <Input className="h-9" type="number" min={0} value={v.bookingMinNoticeHours} onChange={(e) => setV({ ...v, bookingMinNoticeHours: e.target.value })} />
        </FormField>
        <FormField label="Réservable jusqu'à (jours)">
          <Input className="h-9" type="number" min={1} value={v.bookingMaxDaysAhead} onChange={(e) => setV({ ...v, bookingMaxDaysAhead: e.target.value })} />
        </FormField>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Disponibilités (heure locale)</div>
        <div className="space-y-2">
          {DAYS.map((d) => {
            const ranges = v.workingHours[d.key] ?? [];
            return (
              <div key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-24 font-medium">{d.label}</span>
                {ranges.length === 0 && <span className="text-muted-foreground">Indisponible</span>}
                {ranges.map((r, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-md border px-1.5 py-1">
                    <Input className="h-7 w-24" type="time" value={r[0]} onChange={(e) => setRange(d.key, i, 0, e.target.value)} />–
                    <Input className="h-7 w-24" type="time" value={r[1]} onChange={(e) => setRange(d.key, i, 1, e.target.value)} />
                    <button type="button" onClick={() => setV((p) => ({ ...p, workingHours: { ...p.workingHours, [d.key]: ranges.filter((_, k) => k !== i) } }))}>
                      <X className="size-3.5 text-muted-foreground" />
                    </button>
                  </span>
                ))}
                <Button type="button" size="xs" variant="ghost" onClick={() => setV((p) => ({ ...p, workingHours: { ...p.workingHours, [d.key]: [...ranges, ["09:00", "12:00"]] } }))}>
                  <Plus /> Plage
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      <Button type="submit" disabled={save.pending}>
        {save.pending && <Spinner />} Enregistrer
      </Button>
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Intégrer un bouton sur le site PillQare</div>
        <code className="block rounded bg-muted p-2 break-all">{`<a href="${url}" target="_blank" style="background:#12295A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-family:sans-serif">Prendre rendez-vous</a>`}</code>
        <p className="mt-1">Le lien est aussi inséré automatiquement dans les emails via la variable {"{{bookingLink}}"}.</p>
      </div>
    </form>
  );
}
