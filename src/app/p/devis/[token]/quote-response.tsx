"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { acceptQuotePublicAction, markQuoteViewedAction, refuseQuotePublicAction } from "@/actions/quotes";
import type { QuoteStatus } from "@/generated/prisma/enums";

/**
 * Marque le devis comme consulté depuis le navigateur du client (et non lors du pré-chargement
 * des liens par les antivirus de messagerie, qui n'exécutent pas le JavaScript).
 */
export function ViewTracker({ token }: { token: string }) {
  useEffect(() => {
    const t = setTimeout(() => markQuoteViewedAction(token).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [token]);
  return null;
}

export function QuoteResponse({
  token,
  status,
  expired,
  acceptedByName,
  acceptedAt,
  ownerName,
  ownerContact,
}: {
  token: string;
  status: QuoteStatus;
  expired: boolean;
  acceptedByName: string | null;
  acceptedAt: string | null;
  ownerName: string;
  ownerContact: string;
}) {
  const [mode, setMode] = useState<"accept" | "refuse" | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const accept = useAction(() => acceptQuotePublicAction(token, name));
  const refuse = useAction(() => refuseQuotePublicAction(token, reason));

  if (status === "ACCEPTED") {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200">
        <CheckCircle2 className="mt-0.5 size-5" />
        <div>
          <div className="font-semibold">Devis accepté{acceptedAt ? ` le ${acceptedAt}` : ""}{acceptedByName ? ` par ${acceptedByName}` : ""}.</div>
          <div className="text-sm">Merci pour votre confiance ! {ownerName} revient vers vous pour la suite ({ownerContact}).</div>
        </div>
      </div>
    );
  }
  if (status === "REFUSED") {
    return (
      <div className="rounded-xl bg-slate-50 p-5 text-sm ring-1 ring-slate-200">
        Vous avez décliné cette proposition. Une question ? Contactez {ownerName} ({ownerContact}).
      </div>
    );
  }
  if (expired) {
    return (
      <div className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900 ring-1 ring-amber-200">
        Ce devis a expiré. Contactez {ownerName} ({ownerContact}) pour recevoir une proposition actualisée.
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-card p-5 surface">
      {mode === null && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <div className="font-semibold">Cette proposition vous convient ?</div>
            <div className="text-muted-foreground">Acceptez-la en ligne en quelques secondes, ou indiquez-nous ce qui ne va pas.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMode("refuse")}>
              <XCircle /> Décliner
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setMode("accept")}>
              <CheckCircle2 /> Accepter le devis
            </Button>
          </div>
        </div>
      )}
      {mode === "accept" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            accept.run();
          }}
        >
          <div className="font-semibold">Bon pour accord</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vos prénom et nom" className="h-10" autoFocus />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={agree} onCheckedChange={(c) => setAgree(Boolean(c))} className="mt-0.5" />
            J&apos;accepte ce devis et ses conditions. Cette acceptation vaut bon pour accord (date, nom et adresse IP enregistrés).
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Retour
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={!agree || name.trim().length < 3 || accept.pending}>
              {accept.pending && <Spinner />} Valider mon acceptation
            </Button>
          </div>
        </form>
      )}
      {mode === "refuse" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            refuse.run();
          }}
        >
          <div className="font-semibold">Pouvez-vous nous dire pourquoi ?</div>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Prix, calendrier, besoin différent… (facultatif)" />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Retour
            </Button>
            <Button type="submit" variant="destructive" disabled={refuse.pending}>
              {refuse.pending && <Spinner />} Décliner la proposition
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
