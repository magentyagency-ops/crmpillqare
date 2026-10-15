"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AsyncPicker } from "@/components/common/async-picker";
import { DateTimeField, FormField, QuickDates, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { createContactAction, searchCompaniesAction, updateContactAction, type PickerOption } from "@/actions/contacts";
import { CONTACT_STATUS_LABELS, NEXT_ACTION_LABELS, SOURCE_LABELS } from "@/lib/labels";
import type { ContactKind, ContactSource, ContactStatus, NextActionType } from "@/generated/prisma/enums";

export type ContactDialogValue = {
  id?: string;
  kind: ContactKind;
  status: ContactStatus;
  civility: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: PickerOption | null;
  companyName: string;
  segmentId: string;
  ownerId: string;
  source: ContactSource;
  address: string;
  postalCode: string;
  city: string;
  notes: string;
  tags: string;
};

export function emptyContact(ownerId: string): ContactDialogValue {
  return {
    kind: "B2B",
    status: "PROSPECT",
    civility: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobTitle: "",
    company: null,
    companyName: "",
    segmentId: "",
    ownerId,
    source: "MANUAL",
    address: "",
    postalCode: "",
    city: "",
    notes: "",
    tags: "",
  };
}

export function ContactDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: ContactDialogValue;
  onSaved?: (result: { id: string; dealId?: string | null }) => void;
}) {
  const { me, users, segments } = useAppData();
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [v, setV] = useState<ContactDialogValue>(initial ?? emptyContact(me.id));
  const [withDeal, setWithDeal] = useState(!editing);
  const [dealTitle, setDealTitle] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [nextType, setNextType] = useState<NextActionType>("CALL");
  const [nextDue, setNextDue] = useState("");
  const [nextLabel, setNextLabel] = useState("");
  const set = <K extends keyof ContactDialogValue>(k: K, val: ContactDialogValue[K]) => setV((p) => ({ ...p, [k]: val }));

  const create = useAction(createContactAction, {
    onSuccess: (data) => {
      onOpenChange(false);
      if (data) {
        onSaved?.(data);
        if (!onSaved) router.push(`/contacts/${data.id}`);
      }
    },
  });
  const update = useAction((id: string, input: Parameters<typeof updateContactAction>[1]) => updateContactAction(id, input), {
    onSuccess: () => {
      onOpenChange(false);
      onSaved?.({ id: initial!.id! });
    },
  });
  const pending = create.pending || update.pending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      kind: v.kind,
      status: v.status,
      civility: v.civility,
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      phone: v.phone,
      jobTitle: v.jobTitle,
      companyId: v.company?.id ?? null,
      companyName: v.company ? null : v.companyName,
      segmentId: v.segmentId,
      ownerId: v.ownerId,
      source: v.source,
      address: v.address,
      postalCode: v.postalCode,
      city: v.city,
      notes: v.notes,
      tags: v.tags,
    };
    if (editing) update.run(initial!.id!, input);
    else create.run({ ...input, createDeal: withDeal, dealTitle, dealAmount, nextAction: withDeal ? { type: nextType, dueAt: nextDue, label: nextLabel } : null });
  };

  const segmentOptions = segments.filter((s) => s.kind === v.kind).map((s) => ({ value: s.id, label: s.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le contact" : "Nouveau contact"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={v.kind}
            onValueChange={(val) => val && setV((p) => ({ ...p, kind: val as ContactKind, segmentId: "" }))}
            className="w-full"
          >
            <ToggleGroupItem value="B2B" className="flex-1">
              Professionnel (B2B)
            </ToggleGroupItem>
            <ToggleGroupItem value="B2C" className="flex-1">
              Particulier (B2C)
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[110px_1fr_1fr]">
            <FormField label="Civilité">
              <SelectField value={v.civility} onChange={(x) => set("civility", x)} placeholder="—" options={[{ value: "Madame", label: "Madame" }, { value: "Monsieur", label: "Monsieur" }, { value: "Docteur", label: "Docteur" }]} />
            </FormField>
            <FormField label="Prénom">
              <Input className="h-9" value={v.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
            </FormField>
            <FormField label="Nom">
              <Input className="h-9" value={v.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Email">
              <Input className="h-9" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
            </FormField>
            <FormField label="Téléphone">
              <Input className="h-9" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
            </FormField>
          </div>
          {v.kind === "B2B" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Organisation" hint="Recherchez une organisation existante ou créez-la.">
                <AsyncPicker
                  value={v.company ?? (v.companyName ? { id: "", label: `${v.companyName} (nouvelle)` } : null)}
                  onChange={(o) => setV((p) => ({ ...p, company: o && o.id ? o : null, companyName: o && o.id ? "" : p.companyName }))}
                  search={searchCompaniesAction}
                  placeholder="Pharmacie, EHPAD…"
                  onCreate={(text) => setV((p) => ({ ...p, company: null, companyName: text }))}
                  createLabel="Nouvelle organisation"
                />
              </FormField>
              <FormField label="Fonction">
                <Input className="h-9" value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Pharmacien titulaire, directeur…" />
              </FormField>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Cible">
              <SelectField value={v.segmentId} onChange={(x) => set("segmentId", x)} placeholder="Non classé" options={segmentOptions} />
            </FormField>
            <FormField label="Commercial responsable" required>
              <SelectField value={v.ownerId} onChange={(x) => set("ownerId", x)} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
            <FormField label="Statut">
              <SelectField value={v.status} onChange={(x) => set("status", x as ContactStatus)} options={Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px_1fr]">
            <FormField label="Adresse">
              <Input className="h-9" value={v.address} onChange={(e) => set("address", e.target.value)} />
            </FormField>
            <FormField label="Code postal">
              <Input className="h-9" value={v.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
            </FormField>
            <FormField label="Ville">
              <Input className="h-9" value={v.city} onChange={(e) => set("city", e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Origine">
              <SelectField value={v.source} onChange={(x) => set("source", x as ContactSource)} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            <FormField label="Étiquettes" hint="Séparées par des virgules">
              <Input className="h-9" value={v.tags} onChange={(e) => set("tags", e.target.value)} placeholder="salon 2026, partenaire…" />
            </FormField>
          </div>
          <FormField label="Notes">
            <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>

          {!editing && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={withDeal} onCheckedChange={(c) => setWithDeal(Boolean(c))} />
                Créer un dossier commercial (prospect dans le pipeline)
              </label>
              {withDeal && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                    <FormField label="Titre du dossier">
                      <Input className="h-9" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder="Généré automatiquement si vide" />
                    </FormField>
                    <FormField label="Montant estimé (€ HT)">
                      <Input className="h-9" inputMode="decimal" value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
                    <FormField label="Prochaine action" required>
                      <SelectField value={nextType} onChange={(x) => setNextType(x as NextActionType)} options={Object.entries(NEXT_ACTION_LABELS).map(([value, label]) => ({ value, label }))} />
                    </FormField>
                    <FormField label="Échéance" required>
                      <DateTimeField value={nextDue} onChange={setNextDue} />
                      <QuickDates onPick={setNextDue} tz={me.timezone} />
                    </FormField>
                  </div>
                  <FormField label="Précision (facultatif)">
                    <Input className="h-9" value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} placeholder="Ex. : appeler pour présenter le pilulier" />
                  </FormField>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} {editing ? "Enregistrer" : "Créer le contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
