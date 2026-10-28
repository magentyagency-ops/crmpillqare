"use client";

import { createContext, useContext, useState } from "react";
import { Archive, Ban, RotateCcw, Tag, Trash2, UserCog, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { bulkContactsAction } from "@/actions/contacts";
import type { BulkOp } from "@/lib/contacts-bulk";
import type { ContactSearch } from "@/lib/contacts-query";

/** Sélection de contacts dans la liste : cases à cocher, « tout sélectionner » (y compris au-delà de la page) et actions groupées. */
type Sel = { ids: Set<string>; all: boolean; toggle: (id: string) => void; setPage: (on: boolean) => void; selectAll: () => void; clear: () => void; pageIds: string[] };
const Ctx = createContext<Sel | null>(null);
const useSel = () => useContext(Ctx)!;

export function SelectionProvider({ pageIds, children }: { pageIds: string[]; children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const value: Sel = {
    ids,
    all,
    pageIds,
    toggle: (id) => {
      setAll(false);
      setIds((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    },
    setPage: (on) => {
      setAll(false);
      setIds(on ? new Set(pageIds) : new Set());
    },
    selectAll: () => setAll(true),
    clear: () => {
      setAll(false);
      setIds(new Set());
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RowCheckbox({ id }: { id: string }) {
  const s = useSel();
  return <Checkbox aria-label="Sélectionner" checked={s.all || s.ids.has(id)} onCheckedChange={() => s.toggle(id)} />;
}

export function PageCheckbox() {
  const s = useSel();
  const on = s.all || (s.pageIds.length > 0 && s.pageIds.every((id) => s.ids.has(id)));
  return <Checkbox aria-label="Sélectionner la page" checked={on} onCheckedChange={(c) => s.setPage(Boolean(c))} />;
}

type Dlg = null | "owner" | "segment" | "status" | "tag" | "delete";

export function BulkBar({ total, filter, archived }: { total: number; filter: ContactSearch; archived: boolean }) {
  const s = useSel();
  const { me, users, segments } = useAppData();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [value, setValue] = useState("");
  const count = s.all ? total : s.ids.size;
  const bulk = useAction(bulkContactsAction, {
    success: false,
    onSuccess: (r) => {
      if (r) toast.success(r.message);
      setDlg(null);
      s.clear();
    },
  });
  if (!count) return null;
  const target = s.all ? { filter } : { ids: [...s.ids] };
  const run = (op: BulkOp) => bulk.run(target, op);
  const open = (d: Dlg, initial = "") => {
    setValue(initial);
    setDlg(d);
  };

  return (
    <>
      <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-sm">
        <span className="font-medium">{count} sélectionné(s)</span>
        {!s.all && s.ids.size === s.pageIds.length && total > s.pageIds.length && (
          <button className="text-primary underline-offset-2 hover:underline" onClick={s.selectAll}>
            Sélectionner les {total} contacts correspondant aux filtres
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => open("owner", me.id)}>
            <UserCog /> Attribuer
          </Button>
          <Button size="sm" variant="outline" onClick={() => open("segment", "")}>
            Cible
          </Button>
          <Button size="sm" variant="outline" onClick={() => open("status", "PROSPECT")}>
            Statut
          </Button>
          <Button size="sm" variant="outline" onClick={() => open("tag", "")}>
            <Tag /> Étiquette
          </Button>
          <Button size="sm" variant="outline" disabled={bulk.pending} onClick={() => run({ type: "doNotContact", value: true })}>
            <Ban /> Ne pas contacter
          </Button>
          {archived ? (
            <Button size="sm" variant="outline" disabled={bulk.pending} onClick={() => run({ type: "restore" })}>
              <RotateCcw /> Restaurer
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={bulk.pending} onClick={() => run({ type: "archive" })}>
              <Archive /> Archiver
            </Button>
          )}
          {me.role === "ADMIN" && (
            <Button size="sm" variant="destructive" onClick={() => open("delete")}>
              <Trash2 /> Supprimer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={s.clear} aria-label="Annuler la sélection">
            <X />
          </Button>
        </div>
      </div>

      <Dialog open={dlg !== null} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dlg === "delete" ? `Supprimer ${count} contact(s) ?` : dlg === "owner" ? "Attribuer à" : dlg === "segment" ? "Changer la cible" : dlg === "status" ? "Changer le statut" : "Ajouter une étiquette"}
            </DialogTitle>
            <DialogDescription>
              {dlg === "delete"
                ? "Suppression définitive, sans retour possible. Les contacts ayant des devis émis ou des commandes sont archivés à la place."
                : `${count} contact(s) concerné(s).`}
            </DialogDescription>
          </DialogHeader>
          {dlg === "owner" && <SelectField value={value} onChange={setValue} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />}
          {dlg === "segment" && <SelectField value={value} onChange={setValue} placeholder="Aucune cible" options={segments.map((x) => ({ value: x.id, label: x.name }))} />}
          {dlg === "status" && (
            <SelectField
              value={value}
              onChange={setValue}
              options={[
                { value: "PROSPECT", label: "Prospect" },
                { value: "CUSTOMER", label: "Client" },
                { value: "PARTNER", label: "Partenaire" },
                { value: "INACTIVE", label: "Inactif" },
              ]}
            />
          )}
          {dlg === "tag" && <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="ex. salon-2026" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Annuler
            </Button>
            <Button
              variant={dlg === "delete" ? "destructive" : "default"}
              disabled={bulk.pending || (dlg === "tag" && !value.trim())}
              onClick={() =>
                run(
                  dlg === "delete"
                    ? { type: "delete" }
                    : dlg === "owner"
                      ? { type: "owner", ownerId: value }
                      : dlg === "segment"
                        ? { type: "segment", segmentId: value || null }
                        : dlg === "status"
                          ? { type: "status", status: value as "PROSPECT" }
                          : { type: "addTag", tag: value.trim() },
                )
              }
            >
              {bulk.pending && <Spinner />} {dlg === "delete" ? "Supprimer définitivement" : "Appliquer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
