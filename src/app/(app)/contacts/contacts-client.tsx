"use client";

import { useState } from "react";
import { Download, FileUp, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { ContactDialog } from "@/components/dialogs/contact-dialog";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { importContactsAction } from "@/actions/contacts";

export function NewContactButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nouveau contact
      </Button>
      {open && <ContactDialog open onOpenChange={setOpen} />}
    </>
  );
}

export function ExportButton({ query }: { query: string }) {
  return (
    <Button size="sm" variant="outline" asChild>
      <a href={`/api/export/contacts${query ? `?${query}` : ""}`}>
        <Download /> Exporter
      </a>
    </Button>
  );
}

export function ImportButton() {
  const { me, users, segments } = useAppData();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [segmentId, setSegmentId] = useState("");
  const [ownerId, setOwnerId] = useState(me.id);
  const [kind, setKind] = useState("");
  const [createDeals, setCreateDeals] = useState(true);
  const [startSequences, setStartSequences] = useState(false);
  const importer = useAction(importContactsAction, {
    success: false,
    onSuccess: (r) => {
      if (r) toast.success(`Import terminé : ${r.created} créé(s), ${r.updated} mis à jour (doublons fusionnés), ${r.skipped} ignoré(s).`);
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileUp /> Importer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer des contacts (CSV)</DialogTitle>
            <DialogDescription>
              Colonnes reconnues automatiquement : prénom, nom, email, téléphone, société / établissement, fonction, code postal, ville, cible… Les contacts déjà présents
              (même email ou téléphone) sont complétés, jamais dupliqués.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Cible (si absente du fichier)">
                <SelectField value={segmentId} onChange={setSegmentId} placeholder="Détecter / aucune" options={segments.map((s) => ({ value: s.id, label: s.name }))} />
              </FormField>
              <FormField label="Type">
                <SelectField value={kind} onChange={setKind} placeholder="Détecter" options={[{ value: "B2B", label: "B2B" }, { value: "B2C", label: "B2C" }]} />
              </FormField>
            </div>
            <FormField label="Commercial responsable">
              <SelectField value={ownerId} onChange={setOwnerId} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createDeals} onCheckedChange={(c) => setCreateDeals(Boolean(c))} /> Créer un dossier « Prospect » pour chaque nouveau contact
            </label>
            {createDeals && (
              <>
                <p className="text-xs text-muted-foreground">Chaque dossier reçoit un « premier contact » à appeler (15 par jour ouvré à partir de demain).</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={startSequences} onCheckedChange={(c) => setStartSequences(Boolean(c))} /> Démarrer les relances automatiques de prospection
                </label>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={!file || importer.pending}
              onClick={async () => {
                if (!file) return;
                const text = await file.text();
                importer.run(text, { segmentId: segmentId || null, ownerId, kind: (kind || null) as "B2B" | "B2C" | null, createDeals, startSequences: createDeals && startSequences });
              }}
            >
              {importer.pending && <Spinner />} Importer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
