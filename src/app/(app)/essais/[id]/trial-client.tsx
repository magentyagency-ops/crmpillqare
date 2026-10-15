"use client";

import { useState } from "react";
import { Check, Plus, Trash2, Truck, PackageCheck, Undo2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import {
  addCheckpointAction,
  addTrialItemAction,
  completeCheckpointAction,
  deleteCheckpointAction,
  deleteTrialItemAction,
  saveTrialFeedbackAction,
  setTrialStatusAction,
  updateTrialItemAction,
} from "@/actions/trials";
import { TRIAL_STATUS_LABELS } from "@/lib/labels";
import type { TrialStatus } from "@/generated/prisma/enums";

const FLOW: TrialStatus[] = ["PLANNED", "EQUIPMENT_SENT", "IN_PROGRESS", "EVALUATION"];

export function TrialStatusStepper({ id, status }: { id: string; status: TrialStatus }) {
  const change = useAction((s: TrialStatus) => setTrialStatusAction(id, s as "PLANNED"));
  const idx = FLOW.indexOf(status);
  const closed = ["CONVERTED", "ENDED", "CANCELLED"].includes(status);
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="flex flex-1 overflow-hidden rounded-lg surface">
        {FLOW.map((s, i) => (
          <button
            key={s}
            disabled={change.pending}
            onClick={() => s !== status && change.run(s)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 border-r px-2 py-2 text-xs font-medium last:border-r-0",
              s === status ? "bg-indigo-100 font-semibold text-indigo-900" : i < idx || closed ? "bg-emerald-50 text-emerald-800" : "bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            {(i < idx || (closed && status !== "CANCELLED")) && <Check className="size-3" />}
            {TRIAL_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={status === "CONVERTED" ? "default" : "outline"} className={status === "CONVERTED" ? "bg-emerald-600" : "text-emerald-700"} onClick={() => change.run("CONVERTED")} disabled={change.pending || status === "CONVERTED"}>
          Converti
        </Button>
        <Button size="sm" variant="outline" onClick={() => change.run("ENDED")} disabled={change.pending || status === "ENDED"}>
          Terminé
        </Button>
        <Button size="sm" variant="outline" className="text-rose-700" onClick={() => change.run("CANCELLED")} disabled={change.pending || status === "CANCELLED"}>
          Annulé
        </Button>
      </div>
    </div>
  );
}

export type TrialItemView = {
  id: string;
  name: string;
  quantity: number;
  serialNumbers: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  returnExpected: boolean;
  returnedAt: string | null;
  returnedQuantity: number | null;
};

export function TrialItems({ trialId, items, products }: { trialId: string; items: TrialItemView[]; products: { id: string; name: string }[] }) {
  const update = useAction((id: string, input: Parameters<typeof updateTrialItemAction>[1]) => updateTrialItemAction(id, input));
  const remove = useAction(deleteTrialItemAction);
  const add = useAction((input: Parameters<typeof addTrialItemAction>[1]) => addTrialItemAction(trialId, input), { onSuccess: () => setDraft({ productId: "", name: "", quantity: "1", serialNumbers: "" }) });
  const [draft, setDraft] = useState({ productId: "", name: "", quantity: "1", serialNumbers: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [serials, setSerials] = useState("");
  const [tracking, setTracking] = useState("");
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">Aucun matériel.</p>}
      {items.map((it) => (
        <div key={it.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">
                {it.quantity} × {it.name}
              </div>
              {it.serialNumbers && <div className="text-xs text-muted-foreground">N° de série : {it.serialNumbers}</div>}
              {it.trackingNumber && <div className="text-xs text-muted-foreground">Suivi colis : {it.trackingNumber}</div>}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className={cn("rounded px-1.5 py-0.5", it.shippedAt ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground")}>{it.shippedAt ? `Expédié ${it.shippedAt}` : "Non expédié"}</span>
              {it.deliveredAt && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800">Livré {it.deliveredAt}</span>}
              {it.returnExpected && (
                <span className={cn("rounded px-1.5 py-0.5", it.returnedAt ? "bg-emerald-100 text-emerald-800" : it.shippedAt ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>
                  {it.returnedAt ? `Retourné ${it.returnedAt}${it.returnedQuantity !== null && it.returnedQuantity !== it.quantity ? ` (${it.returnedQuantity}/${it.quantity})` : ""}` : "Retour attendu"}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!it.shippedAt && (
              <Button size="xs" variant="outline" onClick={() => update.run(it.id, { shipped: true })}>
                <Truck /> Expédié
              </Button>
            )}
            {it.shippedAt && !it.deliveredAt && (
              <Button size="xs" variant="outline" onClick={() => update.run(it.id, { delivered: true })}>
                <PackageCheck /> Livré
              </Button>
            )}
            {it.returnExpected && it.shippedAt && !it.returnedAt && (
              <Button size="xs" variant="outline" onClick={() => update.run(it.id, { returned: true })}>
                <Undo2 /> Retourné
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setEditing(editing === it.id ? null : it.id);
                setSerials(it.serialNumbers ?? "");
                setTracking(it.trackingNumber ?? "");
              }}
            >
              N° de série / suivi
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={() => remove.run(it.id)}>
              <Trash2 />
            </Button>
          </div>
          {editing === it.id && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input className="h-8" value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="N° de série" />
              <Input className="h-8" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="N° de suivi du colis" />
              <Button size="sm" onClick={() => update.run(it.id, { serialNumbers: serials || null, trackingNumber: tracking || null }).then(() => setEditing(null))}>
                Enregistrer
              </Button>
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-dashed p-3 md:grid-cols-[200px_1fr_70px_1fr_auto]">
        <SelectField
          value={draft.productId}
          onChange={(id) => setDraft({ ...draft, productId: id, name: products.find((p) => p.id === id)?.name ?? draft.name })}
          placeholder="Produit…"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Input className="h-9" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Désignation" />
        <Input className="h-9" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
        <Input className="h-9" value={draft.serialNumbers} onChange={(e) => setDraft({ ...draft, serialNumbers: e.target.value })} placeholder="N° de série" />
        <Button
          size="sm"
          disabled={!draft.name.trim() || add.pending}
          onClick={() => add.run({ productId: draft.productId || null, name: draft.name, quantity: Number(draft.quantity) || 1, serialNumbers: draft.serialNumbers || null, returnExpected: true })}
        >
          <Plus /> Ajouter
        </Button>
      </div>
    </div>
  );
}

export function TrialCheckpoints({ trialId, checkpoints }: { trialId: string; checkpoints: { id: string; title: string; dueAt: string; dueLabel: string; done: boolean; overdue: boolean; notes: string | null }[] }) {
  const complete = useAction((id: string) => completeCheckpointAction(id));
  const remove = useAction(deleteCheckpointAction);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const add = useAction(() => addCheckpointAction(trialId, title, due), {
    onSuccess: () => {
      setTitle("");
      setDue("");
    },
  });
  return (
    <div className="space-y-2">
      {checkpoints.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50">
          <Checkbox checked={c.done} disabled={c.done || complete.pending} onCheckedChange={() => complete.run(c.id)} />
          <div className={cn("flex-1 text-sm", c.done && "text-muted-foreground line-through")}>{c.title}</div>
          <span className={cn("text-xs", c.overdue && !c.done ? "font-medium text-rose-600" : "text-muted-foreground")}>{c.dueLabel}</span>
          <Button size="icon-xs" variant="ghost" onClick={() => remove.run(c.id)}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_150px_auto] gap-2 pt-1">
        <Input className="h-8" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouveau jalon" />
        <Input className="h-8" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!title.trim() || !due || add.pending} onClick={() => add.run()}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

export function TrialFeedback({ id, initial }: { id: string; initial: { feedback: string; rating: number | null; result: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null } }) {
  const [feedback, setFeedback] = useState(initial.feedback);
  const [rating, setRating] = useState<number | null>(initial.rating);
  const [result, setResult] = useState<string>(initial.result ?? "");
  const save = useAction(() => saveTrialFeedbackAction(id, { feedback: feedback || null, rating, result: (result || null) as "POSITIVE" | null }));
  return (
    <div className="space-y-3">
      <FormField label="Retours des utilisateurs / de l'établissement">
        <Textarea rows={5} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Note globale">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} className={cn("h-8 flex-1 rounded-md text-sm font-semibold", rating && n <= rating ? "bg-amber-400 text-amber-950" : "bg-muted text-muted-foreground")}>
                {n}
              </button>
            ))}
          </div>
        </FormField>
        <FormField label="Résultat">
          <SelectField value={result} onChange={setResult} placeholder="—" options={[{ value: "POSITIVE", label: "Positif" }, { value: "NEUTRAL", label: "Mitigé" }, { value: "NEGATIVE", label: "Négatif" }]} />
        </FormField>
      </div>
      <Button size="sm" disabled={save.pending} onClick={() => save.run()}>
        {save.pending && <Spinner />} Enregistrer le retour
      </Button>
    </div>
  );
}
