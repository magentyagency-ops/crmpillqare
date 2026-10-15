"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AsyncPicker } from "@/components/common/async-picker";
import { FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { dealsForContactAction } from "@/actions/deals";
import { createQuoteAction, productsForQuoteAction, updateQuoteAction } from "@/actions/quotes";
import { computeQuoteTotals } from "@/lib/quotes/totals";
import { formatEUR } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/labels";
import type { DealStage } from "@/generated/prisma/enums";

export type QuoteLine = { productId: string; name: string; description: string; quantity: string; unit: string; unitPriceHT: string; discountPct: string; vatRate: string };

export type QuoteDraft = {
  id?: string;
  title: string;
  contact: PickerOption | null;
  dealId: string;
  ownerId: string;
  validUntil: string;
  globalDiscountPct: string;
  notes: string;
  terms: string;
  items: QuoteLine[];
};

const num = (v: string) => {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const emptyLine = (): QuoteLine => ({ productId: "", name: "", description: "", quantity: "1", unit: "unité", unitPriceHT: "0", discountPct: "0", vatRate: "20" });

export function QuoteEditor({ initial }: { initial: QuoteDraft }) {
  const { users } = useAppData();
  const router = useRouter();
  const [q, setQ] = useState<QuoteDraft>(initial.items.length ? initial : { ...initial, items: [emptyLine()] });
  const [dealsFor, setDealsFor] = useState<{ contactId: string; list: { id: string; title: string; stage: DealStage }[] } | null>(null);
  const deals = q.contact && dealsFor?.contactId === q.contact.id ? dealsFor.list : [];
  const contactId = q.contact?.id ?? null;
  const [products, setProducts] = useState<Awaited<ReturnType<typeof productsForQuoteAction>>>([]);
  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => setQ((p) => ({ ...p, [k]: v }));
  const setLine = (i: number, patch: Partial<QuoteLine>) => setQ((p) => ({ ...p, items: p.items.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  useEffect(() => {
    productsForQuoteAction().then(setProducts);
  }, []);
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    dealsForContactAction(contactId).then((list) => {
      if (cancelled) return;
      setDealsFor({ contactId, list });
      setQ((p) => (p.dealId || !list.length ? p : { ...p, dealId: list.find((d) => d.stage !== "WON" && d.stage !== "LOST")?.id ?? "" }));
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const totals = useMemo(
    () => computeQuoteTotals(q.items.map((l) => ({ quantity: num(l.quantity), unitPriceHT: num(l.unitPriceHT), discountPct: num(l.discountPct), vatRate: num(l.vatRate) })), num(q.globalDiscountPct)),
    [q.items, q.globalDiscountPct],
  );

  const save = useAction(
    async (draft: QuoteDraft) => {
      const input = {
        title: draft.title,
        contactId: draft.contact?.id ?? "",
        dealId: draft.dealId || null,
        ownerId: draft.ownerId || null,
        validUntil: draft.validUntil,
        globalDiscountPct: draft.globalDiscountPct,
        notes: draft.notes,
        terms: draft.terms,
        items: draft.items
          .filter((l) => l.name.trim())
          .map((l) => ({
            productId: l.productId || null,
            name: l.name,
            description: l.description,
            quantity: num(l.quantity),
            unit: l.unit,
            unitPriceHT: num(l.unitPriceHT),
            discountPct: num(l.discountPct),
            vatRate: num(l.vatRate),
          })),
      };
      return draft.id ? updateQuoteAction(draft.id, input) : createQuoteAction(input);
    },
    { onSuccess: (d) => d && router.push(`/devis/${d.id}`) },
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.run(q);
      }}
    >
      <div className="grid grid-cols-1 gap-4 rounded-xl bg-card p-5 surface md:grid-cols-2">
        <FormField label="Client" required>
          <AsyncPicker value={q.contact} onChange={(o) => setQ((p) => ({ ...p, contact: o, dealId: "" }))} search={searchContactsAction} placeholder="Rechercher un contact…" />
        </FormField>
        <FormField label="Dossier">
          <SelectField value={q.dealId} onChange={(v) => set("dealId", v)} placeholder="Aucun" options={deals.map((d) => ({ value: d.id, label: `${d.title} (${STAGE_LABELS[d.stage]})` }))} />
        </FormField>
        <FormField label="Objet du devis">
          <Input className="h-9" value={q.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex. : Équipement de 20 résidents en piluliers connectés" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Valable jusqu'au">
            <Input className="h-9" type="date" value={q.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
          </FormField>
          <FormField label="Commercial">
            <SelectField value={q.ownerId} onChange={(v) => set("ownerId", v)} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
          </FormField>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-6" />
              <th className="px-2 py-2 text-left font-medium">Désignation</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Qté</th>
              <th className="w-28 px-2 py-2 text-right font-medium">PU HT (€)</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Remise %</th>
              <th className="w-20 px-2 py-2 text-right font-medium">TVA %</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Total HT</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {q.items.map((l, i) => (
              <tr key={i} className="border-b align-top last:border-b-0">
                <td className="pt-3 pl-2 text-muted-foreground">
                  <GripVertical className="size-4" />
                </td>
                <td className="space-y-1.5 px-2 py-2">
                  <SelectField
                    value={l.productId}
                    onChange={(id) => {
                      const p = products.find((x) => x.id === id);
                      setLine(i, p ? { productId: p.id, name: p.name, description: p.description ?? "", unitPriceHT: String(p.unitPriceHT), vatRate: String(p.vatRate), unit: p.unit } : { productId: "" });
                    }}
                    placeholder="Produit du catalogue (facultatif)…"
                    ariaLabel={`Produit (ligne ${i + 1})`}
                    options={products.map((p) => ({ value: p.id, label: `${p.name} — ${formatEUR(p.unitPriceHT)} HT` }))}
                  />
                  <Input className="h-8" aria-label={`Désignation (ligne ${i + 1})`} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Désignation" />
                  <Textarea rows={2} aria-label={`Description (ligne ${i + 1})`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description (facultatif)" className="text-xs" />
                </td>
                <td className="px-2 py-2">
                  <Input className="h-8 text-right" aria-label={`Quantité (ligne ${i + 1})`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <Input className="h-8 text-right" aria-label={`Prix unitaire HT (ligne ${i + 1})`} inputMode="decimal" value={l.unitPriceHT} onChange={(e) => setLine(i, { unitPriceHT: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <Input className="h-8 text-right" aria-label={`Remise % (ligne ${i + 1})`} inputMode="decimal" value={l.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <Input className="h-8 text-right" aria-label={`TVA % (ligne ${i + 1})`} inputMode="decimal" value={l.vatRate} onChange={(e) => setLine(i, { vatRate: e.target.value })} />
                </td>
                <td className="px-2 py-3 text-right font-medium tabular-nums">{formatEUR(totals.lineTotals[i] ?? 0)}</td>
                <td className="px-2 py-2">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => setQ((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} disabled={q.items.length === 1}>
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col gap-4 border-t p-4 md:flex-row md:items-start md:justify-between">
          <Button type="button" size="sm" variant="outline" onClick={() => setQ((p) => ({ ...p, items: [...p.items, emptyLine()] }))}>
            <Plus /> Ajouter une ligne
          </Button>
          <div className="w-full space-y-1.5 text-sm md:w-80">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sous-total HT</span>
              <span className="tabular-nums">{formatEUR(totals.subtotalHT)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Remise globale (%)</span>
              <Input className="h-8 w-20 text-right" aria-label="Remise globale (%)" inputMode="decimal" value={q.globalDiscountPct} onChange={(e) => set("globalDiscountPct", e.target.value)} />
            </div>
            {totals.discountHT > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Remise</span>
                <span className="tabular-nums">- {formatEUR(totals.discountHT)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>Total HT</span>
              <span className="tabular-nums">{formatEUR(totals.totalHT)}</span>
            </div>
            {totals.vat.map((v) => (
              <div key={v.rate} className="flex justify-between text-muted-foreground">
                <span>TVA {v.rate} %</span>
                <span className="tabular-nums">{formatEUR(v.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1.5 text-base font-bold text-brand-navy">
              <span>Total TTC</span>
              <span className="tabular-nums">{formatEUR(totals.totalTTC)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl bg-card p-5 surface md:grid-cols-2">
        <FormField label="Remarques (visibles sur le devis)">
          <Textarea rows={4} value={q.notes} onChange={(e) => set("notes", e.target.value)} />
        </FormField>
        <FormField label="Conditions">
          <Textarea rows={4} value={q.terms} onChange={(e) => set("terms", e.target.value)} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.pending || !q.contact}>
          {save.pending && <Spinner />} Enregistrer le devis
        </Button>
      </div>
    </form>
  );
}
