"use client";

import { useCallback, useState } from "react";
import { CalendarCheck2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { SlotPicker, formatSlotLong } from "@/components/public/slot-picker";
import { bookAction, getSlotsAction } from "@/actions/public";
import { capitalizeFirst } from "@/lib/format";

export function Booking({ slug, today, durationMin, meetingType }: { slug: string; today: string; durationMin: number; meetingType: "VIDEO" | "PHONE" | "IN_PERSON" }) {
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", message: "", website: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; videoUrl: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback((from: string) => getSlotsAction(slug, from, 7), [slug]);

  if (done && slot) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CalendarCheck2 className="size-12 text-emerald-600" />
        <h2 className="text-xl font-bold text-brand-navy">Rendez-vous confirmé !</h2>
        <p className="text-sm">
          <span>{capitalizeFirst(formatSlotLong(slot))}</span> ({durationMin} min)
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Une confirmation vient de vous être envoyée par email{meetingType === "VIDEO" ? " avec le lien de la visio" : ""}. Vous recevrez aussi un rappel la veille.
        </p>
        {done.videoUrl && (
          <a href={done.videoUrl} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Video className="size-4" /> {done.videoUrl}
          </a>
        )}
        <a href={`/rdv/gerer/${done.token}`} className="text-xs text-muted-foreground hover:underline">
          Modifier ou annuler ce rendez-vous
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!slot ? (
        <SlotPicker key={reloadKey} load={load} today={today} onPick={setSlot} selected={slot} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            const res = await bookAction({ slug, start: slot, ...form });
            setPending(false);
            if (res.ok && res.data) setDone(res.data);
            else if (!res.ok) {
              setError(res.error);
              if (/créneau/i.test(res.error)) {
                setSlot(null);
                setReloadKey((k) => k + 1);
              }
            }
          }}
        >
          <div className="flex items-center justify-between rounded-lg bg-primary/5 p-3 text-sm">
            <span>
              <strong>{capitalizeFirst(formatSlotLong(slot))}</strong> · {durationMin} min
            </span>
            <button type="button" className="text-primary hover:underline" onClick={() => setSlot(null)}>
              Changer
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-firstName">Prénom *</Label>
              <Input id="bk-firstName" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-lastName">Nom *</Label>
              <Input id="bk-lastName" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-email">Email *</Label>
              <Input id="bk-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-phone">Téléphone{meetingType === "PHONE" ? " *" : ""}</Label>
              <Input id="bk-phone" required={meetingType === "PHONE"} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-company">Établissement / société (si professionnel)</Label>
            <Input id="bk-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} autoComplete="organization" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-message">Votre besoin en quelques mots</Label>
            <Textarea id="bk-message" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" aria-hidden="true" />
          {error && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Spinner />} Confirmer le rendez-vous
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">Vos informations servent uniquement à organiser ce rendez-vous et à vous recontacter.</p>
        </form>
      )}
    </div>
  );
}
