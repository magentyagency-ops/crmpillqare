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
  const [reading, setReading] = useState(false);
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
        <FileUp /> Importer Excel / CSV
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer des contacts (Excel ou CSV)</DialogTitle>
            <DialogDescription>
              L'IA lit toutes les feuilles du fichier, repère les en-têtes et range chaque colonne dans le bon champ (prénom, nom, email, téléphone, établissement, fonction, ville, cible…). Les autres informations utiles sont gardées en note. Les contacts déjà présents
              (même email ou téléphone) sont complétés, jamais dupliqués.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
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
              disabled={!file || importer.pending || reading}
              onClick={async () => {
                if (!file) return;
                let input: string | { sheets: { name: string; rows: string[][] }[] };
                setReading(true);
                try {
                  if (/\.csv$/i.test(file.name)) input = await file.text();
                  else {
                    const XLSX = await import("xlsx");
                    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: true });
                    input = {
                      sheets: wb.SheetNames.map((name) => ({
                        name,
                        rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: false, defval: "", blankrows: false }).map((r) => r.map((c) => String(c ?? ""))),
                      })),
                    };
                  }
                } catch (error) {
                  toast.error(`Fichier illisible : ${error instanceof Error ? error.message : String(error)}`);
                  return;
                } finally {
                  setReading(false);
                }
                toast.info("Lecture du fichier par l'IA… (quelques secondes à une minute)");
                importer.run(input, { segmentId: segmentId || null, ownerId, kind: (kind || null) as "B2B" | "B2C" | null, createDeals, startSequences: createDeals && startSequences });
              }}
            >
              {(importer.pending || reading) && <Spinner />} {importer.pending ? "Import en cours…" : "Importer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
