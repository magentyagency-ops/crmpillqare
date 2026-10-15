"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmButton, FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { deleteTemplateAction, saveTemplateAction } from "@/actions/emails";
import { TEMPLATE_CATEGORY_LABELS } from "@/lib/labels";
import { TEMPLATE_VARIABLE_HELP } from "@/lib/email/render";
import type { TemplateCategory } from "@/generated/prisma/enums";

type Tpl = { id?: string; name: string; category: TemplateCategory; subject: string; body: string; shared: boolean };

export function TemplatesManager({ templates, canShare }: { templates: Tpl[]; canShare: boolean }) {
  const [editing, setEditing] = useState<Tpl | null>(null);
  const del = useAction(deleteTemplateAction);
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setEditing({ name: "", category: "PROSPECTION", subject: "", body: "{{contact.greeting}}\n\n\n\nBien cordialement,", shared: canShare })}>
        <Plus /> Nouveau modèle
      </Button>
      <ul className="divide-y rounded-lg border">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t.name} <span className="ml-1 text-xs font-normal text-muted-foreground">{TEMPLATE_CATEGORY_LABELS[t.category]}{t.shared ? " · partagé" : " · personnel"}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{t.subject}</div>
            </div>
            {(canShare || !t.shared) && (
              <>
                <Button size="icon-xs" variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil />
                </Button>
                <ConfirmButton title="Supprimer ce modèle ?" size="icon-sm" variant="ghost" destructive onConfirm={() => del.run(t.id!)}>
                  <Trash2 />
                </ConfirmButton>
              </>
            )}
          </li>
        ))}
        {templates.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun modèle.</li>}
      </ul>
      {editing && <TemplateDialog value={editing} canShare={canShare} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateDialog({ value, canShare, onClose }: { value: Tpl; canShare: boolean; onClose: () => void }) {
  const [v, setV] = useState(value);
  const save = useAction(() => saveTemplateAction({ ...v, id: v.id ?? null }), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{v.id ? "Modifier le modèle" : "Nouveau modèle"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nom">
              <Input className="h-9" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </FormField>
            <FormField label="Catégorie">
              <SelectField value={v.category} onChange={(c) => setV({ ...v, category: c as TemplateCategory })} options={Object.entries(TEMPLATE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
          </div>
          <FormField label="Objet">
            <Input className="h-9" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
          </FormField>
          <FormField label="Message">
            <Textarea rows={12} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          </FormField>
          {canShare && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.shared} onCheckedChange={(c) => setV({ ...v, shared: Boolean(c) })} /> Partagé avec toute l&apos;équipe
            </label>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Variables disponibles</summary>
            <ul className="mt-1 grid grid-cols-2 gap-1">
              {TEMPLATE_VARIABLE_HELP.map((h) => (
                <li key={h.key}>
                  <code>{`{{${h.key}}}`}</code> — {h.label}
                </li>
              ))}
            </ul>
          </details>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={save.pending} onClick={() => save.run()}>
            {save.pending && <Spinner />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
