"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AsyncPicker } from "@/components/common/async-picker";
import { FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { dealsForContactAction } from "@/actions/deals";
import { productsForQuoteAction } from "@/actions/quotes";
import { createTrialAction } from "@/actions/trials";
import { STAGE_LABELS } from "@/lib/labels";
import type { DealStage } from "@/generated/prisma/enums";

type Item = { productId: string; name: string; quantity: string; serialNumbers: string; returnExpected: boolean };
type Checkpoint = { title: string; dueAt: string };

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour ouvré : un samedi ou un dimanche est reporté au lundi suivant. */
function weekday(day: string) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 6 ? addDays(day, 2) : dow === 0 ? addDays(day, 1) : day;
}

export function TrialForm({ initialContact, initialDealId, companyId, today }: { initialContact: PickerOption | null; initialDealId: string | null; companyId: string | null; today: string }) {
  const { me, users } = useAppData();
  const router = useRouter();
  const [contact, setContact] = useState<PickerOption | null>(initialContact);
  const [deals, setDeals] = useState<{ id: string; title: string; stage: DealStage }[]>([]);
  const [dealId, setDealId] = useState(initialDealId ?? "");
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(me.id);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 42));
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState("");
  const [objectives, setObjectives] = useState("");
  const [criteria, setCriteria] = useState("");
  const [products, setProducts] = useState<Awaited<ReturnType<typeof productsForQuoteAction>>>([]);
  const [items, setItems] = useState<Item[]>([{ productId: "", name: "", quantity: "1", serialNumbers: "", returnExpected: true }]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([
    { title: "Livraison et installation du matériel", dueAt: weekday(addDays(today, 3)) },
    { title: "Point de démarrage avec les équipes", dueAt: weekday(addDays(today, 7)) },
    { title: "Bilan intermédiaire", dueAt: weekday(addDays(today, 21)) },
    { title: "Bilan final et proposition commerciale", dueAt: weekday(addDays(today, 42)) },
  ]);

  useEffect(() => {
    productsForQuoteAction().then(setProducts);
  }, []);
  useEffect(() => {
    if (!contact) return;
    dealsForContactAction(contact.id).then((list) => {
      setDeals(list);
      if (!initialDealId) setDealId(list.find((d) => d.stage !== "WON" && d.stage !== "LOST")?.id ?? "");
    });
  }, [contact, initialDealId]);

  const save = useAction(createTrialAction, { onSuccess: (d) => d && router.push(`/essais/${d.id}`) });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({
          title: title || `Essai — ${contact?.sublabel?.split(" · ")[0] || contact?.label || ""}`,
          contactId: contact?.id ?? null,
          dealId: dealId || null,
          companyId,
          ownerId,
          startDate,
          endDate,
          location,
          participants,
          objectives,
          successCriteria: criteria,
          items: items.filter((i) => i.name.trim()).map((i) => ({ ...i, quantity: Number(i.quantity) || 1, productId: i.productId || null })),
          checkpoints: checkpoints.filter((c) => c.title.trim() && c.dueAt),
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 rounded-xl bg-card p-5 surface md:grid-cols-2">
        <FormField label="Contact" required>
          <AsyncPicker value={contact} onChange={setContact} search={searchContactsAction} placeholder="Rechercher…" />
        </FormField>
        <FormField label="Dossier">
          <SelectField value={dealId} onChange={setDealId} placeholder="Aucun" options={deals.map((d) => ({ value: d.id, label: `${d.title} (${STAGE_LABELS[d.stage]})` }))} />
        </FormField>
        <FormField label="Intitulé" hint="Par défaut : « Essai — organisation »">
          <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. : Pilote 6 semaines — unité protégée" />
        </FormField>
        <FormField label="Responsable">
          <SelectField value={ownerId} onChange={setOwnerId} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Début">
            <Input className="h-9" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Fin prévue">
            <Input className="h-9" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <FormField label="Lieu / service">
            <Input className="h-9" value={location} onChange={(e) => setLocation(e.target.value)} />
          </FormField>
          <FormField label="Patients / résidents">
            <Input className="h-9" inputMode="numeric" value={participants} onChange={(e) => setParticipants(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Objectifs">
          <Textarea rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
        </FormField>
        <FormField label="Critères de succès">
          <Textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </FormField>
      </div>

      <div className="space-y-3 rounded-xl bg-card p-5 surface">
        <div className="text-sm font-semibold text-brand-navy">Matériel prêté / envoyé</div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-1 items-start gap-2 rounded-lg border p-2 md:grid-cols-[220px_1fr_80px_1fr_auto_auto]">
            <SelectField
              value={it.productId}
              onChange={(id) => {
                const p = products.find((x) => x.id === id);
                setItems(items.map((x, j) => (j === i ? { ...x, productId: id, name: p?.name ?? x.name } : x)));
              }}
              placeholder="Produit…"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Input className="h-9" value={it.name} placeholder="Désignation" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input className="h-9" inputMode="numeric" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <Input className="h-9" value={it.serialNumbers} placeholder="N° de série (séparés par des virgules)" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, serialNumbers: e.target.value } : x)))} />
            <label className="flex h-9 items-center gap-1.5 text-xs whitespace-nowrap">
              <Checkbox checked={it.returnExpected} onCheckedChange={(c) => setItems(items.map((x, j) => (j === i ? { ...x, returnExpected: Boolean(c) } : x)))} /> À récupérer
            </label>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { productId: "", name: "", quantity: "1", serialNumbers: "", returnExpected: true }])}>
          <Plus /> Ajouter du matériel
        </Button>
      </div>

      <div className="space-y-3 rounded-xl bg-card p-5 surface">
        <div className="text-sm font-semibold text-brand-navy">Jalons et échéances</div>
        <p className="text-xs text-muted-foreground">Chaque jalon crée une tâche datée pour le responsable de l&apos;essai.</p>
        {checkpoints.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_170px_auto] gap-2">
            <Input className="h-9" value={c.title} onChange={(e) => setCheckpoints(checkpoints.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Input className="h-9" type="date" value={c.dueAt} onChange={(e) => setCheckpoints(checkpoints.map((x, j) => (j === i ? { ...x, dueAt: e.target.value } : x)))} />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setCheckpoints(checkpoints.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setCheckpoints([...checkpoints, { title: "", dueAt: endDate }])}>
          <Plus /> Ajouter un jalon
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.pending || !contact}>
          {save.pending && <Spinner />} Créer l&apos;essai
        </Button>
      </div>
    </form>
  );
}
