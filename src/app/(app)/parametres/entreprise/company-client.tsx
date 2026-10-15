"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField } from "@/components/common/fields";
import { SectionCard } from "@/components/common/ui-bits";
import { useAction } from "@/hooks/use-action";
import { updateSettingsAction } from "@/actions/settings";
import type { CompanySettings, QuoteSettings } from "@/lib/settings";

export function CompanyForms({ company, quotes }: { company: CompanySettings; quotes: QuoteSettings }) {
  const [c, setC] = useState(company);
  const [q, setQ] = useState(quotes);
  const saveC = useAction(() => updateSettingsAction("company", c));
  const saveQ = useAction(() => updateSettingsAction("quotes", q));
  const field = (k: keyof CompanySettings, label: string) => (
    <FormField label={label}>
      <Input className="h-9" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </FormField>
  );
  return (
    <div className="space-y-6">
      <SectionCard
        title="Informations légales (en-tête et pied des devis, emails)"
        actions={
          <Button size="sm" disabled={saveC.pending} onClick={() => saveC.run()}>
            {saveC.pending && <Spinner />} Enregistrer
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field("name", "Nom commercial")}
          {field("legalName", "Raison sociale")}
          {field("address", "Adresse")}
          <div className="grid grid-cols-[110px_1fr] gap-3">
            {field("postalCode", "Code postal")}
            {field("city", "Ville")}
          </div>
          {field("phone", "Téléphone")}
          {field("email", "Email")}
          {field("website", "Site web")}
          {field("siret", "SIRET")}
          {field("vatNumber", "N° de TVA intracommunautaire")}
          {field("iban", "IBAN (règlement par virement)")}
          {field("bic", "BIC")}
        </div>
      </SectionCard>
      <SectionCard
        title="Devis"
        actions={
          <Button size="sm" disabled={saveQ.pending} onClick={() => saveQ.run()}>
            {saveQ.pending && <Spinner />} Enregistrer
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:max-w-md">
            <FormField label="Préfixe de numérotation" hint="Ex. DEV → DEV-2026-0001">
              <Input className="h-9" value={q.prefix} onChange={(e) => setQ({ ...q, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            </FormField>
            <FormField label="Validité (jours)">
              <Input className="h-9" type="number" min={1} value={q.validityDays} onChange={(e) => setQ({ ...q, validityDays: Number(e.target.value) || 30 })} />
            </FormField>
          </div>
          <FormField label="Conditions par défaut">
            <Textarea rows={4} value={q.defaultTerms} onChange={(e) => setQ({ ...q, defaultTerms: e.target.value })} />
          </FormField>
          <FormField label="Remarques par défaut">
            <Textarea rows={2} value={q.defaultNotes} onChange={(e) => setQ({ ...q, defaultNotes: e.target.value })} />
          </FormField>
          <FormField label="Mention de pied de page">
            <Input className="h-9" value={q.footer} onChange={(e) => setQ({ ...q, footer: e.target.value })} />
          </FormField>
        </div>
      </SectionCard>
    </div>
  );
}
