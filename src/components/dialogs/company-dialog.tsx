"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { createCompanyAction, updateCompanyAction } from "@/actions/companies";

export type CompanyValue = {
  id?: string;
  name: string;
  segmentId: string;
  ownerId: string;
  siret: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  capacity: string;
  employees: string;
  notes: string;
};

export function CompanyDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial?: CompanyValue }) {
  const { me, users, segments } = useAppData();
  const router = useRouter();
  const [v, setV] = useState<CompanyValue>(
    initial ?? { name: "", segmentId: "", ownerId: me.id, siret: "", website: "", email: "", phone: "", address: "", postalCode: "", city: "", capacity: "", employees: "", notes: "" },
  );
  const set = <K extends keyof CompanyValue>(k: K, val: string) => setV((p) => ({ ...p, [k]: val }));
  const create = useAction(createCompanyAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      if (d) router.push(`/organisations/${d.id}`);
    },
  });
  const update = useAction((id: string, input: Parameters<typeof updateCompanyAction>[1]) => updateCompanyAction(id, input), { onSuccess: () => onOpenChange(false) });
  const pending = create.pending || update.pending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Modifier l'organisation" : "Nouvelle organisation"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const { id, ...input } = v;
            if (id) update.run(id, input);
            else create.run(input);
          }}
        >
          <FormField label="Nom" required>
            <Input className="h-9" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Cible">
              <SelectField value={v.segmentId} onChange={(x) => set("segmentId", x)} placeholder="Non classée" options={segments.filter((s) => s.kind === "B2B").map((s) => ({ value: s.id, label: s.name }))} />
            </FormField>
            <FormField label="Commercial responsable">
              <SelectField value={v.ownerId} onChange={(x) => set("ownerId", x)} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Téléphone">
              <Input className="h-9" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
            </FormField>
            <FormField label="Email">
              <Input className="h-9" value={v.email} onChange={(e) => set("email", e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Site web">
              <Input className="h-9" value={v.website} onChange={(e) => set("website", e.target.value)} />
            </FormField>
            <FormField label="SIRET">
              <Input className="h-9" value={v.siret} onChange={(e) => set("siret", e.target.value)} />
            </FormField>
          </div>
          <FormField label="Adresse">
            <Input className="h-9" value={v.address} onChange={(e) => set("address", e.target.value)} />
          </FormField>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <FormField label="Code postal">
              <Input className="h-9" value={v.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
            </FormField>
            <FormField label="Ville">
              <Input className="h-9" value={v.city} onChange={(e) => set("city", e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Lits / résidents / patients suivis">
              <Input className="h-9" inputMode="numeric" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </FormField>
            <FormField label="Salariés">
              <Input className="h-9" inputMode="numeric" value={v.employees} onChange={(e) => set("employees", e.target.value)} />
            </FormField>
          </div>
          <FormField label="Notes">
            <Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending || !v.name.trim()}>
              {pending && <Spinner />} Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
