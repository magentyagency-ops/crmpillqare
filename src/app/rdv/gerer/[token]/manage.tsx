"use client";

import { useCallback, useState } from "react";
import { CalendarClock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { SlotPicker, formatSlotLong } from "@/components/public/slot-picker";
import { cancelByTokenAction, getManageSlotsAction, rescheduleByTokenAction } from "@/actions/public";

export function ManageBooking({ token, today, canReschedule }: { token: string; today: string; canReschedule: boolean }) {
  const [mode, setMode] = useState<"menu" | "reschedule" | "cancel" | "done">("menu");
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((from: string) => getManageSlotsAction(token, from), [token]);

  if (mode === "done") return <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>;

  return (
    <div className="space-y-4">
      {mode === "menu" && (
        <div className="flex flex-wrap gap-2">
          {canReschedule && (
            <Button onClick={() => setMode("reschedule")}>
              <CalendarClock /> Choisir un autre créneau
            </Button>
          )}
          <Button variant="outline" className="text-rose-700" onClick={() => setMode("cancel")}>
            <XCircle /> Annuler le rendez-vous
          </Button>
        </div>
      )}
      {mode === "reschedule" && (
        <>
          <SlotPicker load={load} today={today} onPick={setSlot} selected={slot} />
          {slot && (
            <Button
              className="w-full"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const res = await rescheduleByTokenAction(token, slot);
                setPending(false);
                if (res.ok) {
                  setMessage(`Votre rendez-vous est déplacé au ${formatSlotLong(slot)}. Une confirmation vous a été envoyée.`);
                  setMode("done");
                } else setError(res.error);
              }}
            >
              {pending && <Spinner />} Confirmer le nouveau créneau
            </Button>
          )}
          <button className="text-sm text-muted-foreground hover:underline" onClick={() => setMode("menu")}>
            Retour
          </button>
        </>
      )}
      {mode === "cancel" && (
        <div className="space-y-3">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Un mot sur la raison de l'annulation ? (facultatif)" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMode("menu")}>
              Retour
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const res = await cancelByTokenAction(token, reason);
                setPending(false);
                if (res.ok) {
                  setMessage("Votre rendez-vous est annulé. Nous restons à votre disposition pour en reprendre un.");
                  setMode("done");
                } else setError(res.error);
              }}
            >
              {pending && <Spinner />} Confirmer l&apos;annulation
            </Button>
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
