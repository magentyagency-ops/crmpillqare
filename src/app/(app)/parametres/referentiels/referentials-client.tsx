"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { deleteSegmentAction, saveLostReasonAction, saveSegmentAction } from "@/actions/settings";

type Seg = { id?: string; name: string; kind: "B2B" | "B2C"; color: string; description: string; keywords: string; active: boolean; count?: number };

function SegmentRow({ seg }: { seg: Seg }) {
  const [v, setV] = useState(seg);
  const save = useAction(() => saveSegmentAction({ ...v, id: v.id ?? null, keywords: v.keywords.split(/[,;\n]+/) }));
  const del = useAction(() => deleteSegmentAction(v.id!));
  const dirty = JSON.stringify(v) !== JSON.stringify(seg);
  return (
    <div className="grid grid-cols-1 items-center gap-2 border-b py-2 last:border-b-0 md:grid-cols-[40px_1fr_110px_1.4fr_auto_auto]">
      <Input
        className="order-last h-8 text-xs md:col-span-6 md:col-start-2"
        value={v.keywords}
        onChange={(e) => setV({ ...v, keywords: e.target.value })}
        placeholder="Mots-clés de détection automatique, séparés par des virgules (ex. ehpad, maison de retraite)"
        aria-label="Mots-clés de détection"
      />
      <Input type="color" className="h-9 w-10 p-1" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} />
      <Input className="h-9" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <SelectField value={v.kind} onChange={(k) => setV({ ...v, kind: k as "B2B" })} options={[{ value: "B2B", label: "B2B" }, { value: "B2C", label: "B2C" }]} />
      <Input className="h-9" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Description" />
      <label className="flex items-center gap-1.5 text-xs">
        <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} /> {seg.count !== undefined ? `${seg.count} contact(s)` : ""}
      </label>
      <div className="flex gap-1">
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || save.pending} onClick={() => save.run()}>
          Enregistrer
        </Button>
        {v.id && (
          <ConfirmButton title="Supprimer cette cible ?" description="Si elle est utilisée, elle sera seulement désactivée." size="icon-sm" variant="ghost" destructive onConfirm={() => del.run()}>
            <Trash2 />
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}

export function SegmentsEditor({ segments }: { segments: Seg[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {segments.map((s) => (
        <SegmentRow key={s.id} seg={s} />
      ))}
      {adding && <SegmentRow seg={{ name: "", kind: "B2B", color: "#64748b", description: "", keywords: "", active: true }} />}
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)} disabled={adding}>
        <Plus /> Ajouter une cible
      </Button>
    </div>
  );
}

function ReasonRow({ r }: { r: { id?: string; label: string; active: boolean; count?: number } }) {
  const [v, setV] = useState(r);
  const save = useAction(() => saveLostReasonAction({ ...v, id: v.id ?? null }));
  const dirty = v.label !== r.label || v.active !== r.active;
  return (
    <div className="flex items-center gap-2 border-b py-2 last:border-b-0">
      <Input className="h-9" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
      <label className="flex shrink-0 items-center gap-1.5 text-xs">
        <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} /> {r.count !== undefined ? `${r.count} dossier(s)` : ""}
      </label>
      <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || save.pending} onClick={() => save.run()}>
        Enregistrer
      </Button>
    </div>
  );
}

export function LostReasonsEditor({ reasons }: { reasons: { id: string; label: string; active: boolean; count: number }[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {reasons.map((r) => (
        <ReasonRow key={r.id} r={r} />
      ))}
      {adding && <ReasonRow r={{ label: "", active: true }} />}
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)} disabled={adding}>
        <Plus /> Ajouter un motif
      </Button>
    </div>
  );
}
