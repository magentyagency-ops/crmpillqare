"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { saveProductAction } from "@/actions/settings";
import { formatEUR } from "@/lib/format";
import { PRODUCT_TYPE_LABELS } from "@/lib/labels";
import type { ProductType } from "@/generated/prisma/enums";

type P = { id?: string; name: string; sku: string; description: string; type: ProductType; unitPriceHT: string; vatRate: string; unit: string; active: boolean; shopifyVariantId: string };

export function ProductsEditor({ products }: { products: P[] }) {
  const [edit, setEdit] = useState<P | null>(null);
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setEdit({ name: "", sku: "", description: "", type: "HARDWARE", unitPriceHT: "0", vatRate: "20", unit: "unité", active: true, shopifyVariantId: "" })}>
        <Plus /> Nouveau produit
      </Button>
      <ul className="divide-y rounded-lg border">
        {products.map((p) => {
          const ht = Number(p.unitPriceHT);
          const ttc = ht * (1 + Number(p.vatRate) / 100);
          return (
            <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${p.active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {PRODUCT_TYPE_LABELS[p.type]} {p.sku && `· ${p.sku}`} {p.shopifyVariantId && "· lié à Shopify"}
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">
                {formatEUR(ht)} HT
                <div className="text-xs text-muted-foreground">{formatEUR(ttc)} TTC</div>
              </div>
              <Button size="icon-xs" variant="ghost" onClick={() => setEdit(p)}>
                <Pencil />
              </Button>
            </li>
          );
        })}
      </ul>
      {edit && <ProductDialog value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProductDialog({ value, onClose }: { value: P; onClose: () => void }) {
  const [v, setV] = useState(value);
  const [ttc, setTtc] = useState((Number(value.unitPriceHT) * (1 + Number(value.vatRate) / 100)).toFixed(2));
  const save = useAction(() => saveProductAction({ ...v, id: v.id ?? null }), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{v.id ? "Modifier le produit" : "Nouveau produit"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Nom">
            <Input className="h-9" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Référence (SKU)">
              <Input className="h-9" value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} />
            </FormField>
            <FormField label="Type">
              <SelectField value={v.type} onChange={(t) => setV({ ...v, type: t as ProductType })} options={Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            <FormField label="Prix unitaire HT (€)">
              <Input
                className="h-9"
                inputMode="decimal"
                value={v.unitPriceHT}
                onChange={(e) => {
                  setV({ ...v, unitPriceHT: e.target.value });
                  setTtc((Number(e.target.value.replace(",", ".")) * (1 + Number(v.vatRate) / 100)).toFixed(2));
                }}
              />
            </FormField>
            <FormField label="Prix TTC (€)" hint="Calcule le HT automatiquement">
              <Input
                className="h-9"
                inputMode="decimal"
                value={ttc}
                onChange={(e) => {
                  setTtc(e.target.value);
                  setV({ ...v, unitPriceHT: (Number(e.target.value.replace(",", ".")) / (1 + Number(v.vatRate) / 100)).toFixed(2) });
                }}
              />
            </FormField>
            <FormField label="TVA (%)">
              <Input className="h-9" inputMode="decimal" value={v.vatRate} onChange={(e) => setV({ ...v, vatRate: e.target.value })} />
            </FormField>
            <FormField label="Unité">
              <Input className="h-9" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Description (reprise sur les devis)">
            <Textarea rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </FormField>
          <FormField label="ID de variante Shopify (rapprochement des commandes)">
            <Input className="h-9" value={v.shopifyVariantId} onChange={(e) => setV({ ...v, shopifyVariantId: e.target.value })} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} /> Actif
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={save.pending || !v.name} onClick={() => save.run()}>
            {save.pending && <Spinner />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
