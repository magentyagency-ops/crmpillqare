"use client";

import { useState } from "react";
import { Code2, Copy, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmButton, FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { deleteFormAction, saveFormAction } from "@/actions/settings";
import { ASSIGNMENT_LABELS } from "@/lib/labels";
import type { AssignmentStrategy, ContactKind } from "@/generated/prisma/enums";

type F = {
  id?: string;
  name: string;
  key: string;
  active: boolean;
  description: string;
  contactKind: ContactKind;
  segmentId: string;
  assignmentStrategy: AssignmentStrategy;
  fixedOwnerId: string;
  createDeal: boolean;
  sendConfirmation: boolean;
  confirmationSubject: string;
  confirmationBody: string;
  callbackDelayMinutes: string;
  successMessage: string;
  redirectUrl: string;
  allowedOrigins: string;
  count?: number;
};

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("Copié"));
}

function EmbedDialog({ form, appUrl, onClose }: { form: F; appUrl: string; onClose: () => void }) {
  const endpoint = `${appUrl}/api/public/forms/${form.key}`;
  const iframe = `<iframe src="${appUrl}/f/${form.key}?embed=1" style="width:100%;min-height:560px;border:0" title="${form.name}"></iframe>`;
  const html = `<form action="${endpoint}" method="post">
  <input name="firstName" placeholder="Prénom" required>
  <input name="lastName" placeholder="Nom" required>
  <input name="email" type="email" placeholder="Email" required>
  <input name="phone" type="tel" placeholder="Téléphone">
  <input name="company" placeholder="Établissement (si professionnel)">
  <textarea name="message" placeholder="Votre demande"></textarea>
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Envoyer</button>
</form>`;
  const js = `// Envoi depuis un formulaire existant du site (fetch)
await fetch("${endpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    firstName, lastName, email, phone, company, message,
    utm_source: new URLSearchParams(location.search).get("utm_source"),
    page_url: location.href,
  }),
}).then(r => r.json()); // { ok: true, message } ou { ok: false, error }`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Intégrer « {form.name} » sur le site</DialogTitle>
          <DialogDescription>Trois options au choix. Les champs reconnus automatiquement : prénom, nom, email, téléphone, société/établissement, fonction, message, code postal, ville, cible. Les autres champs sont ajoutés en note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {[
            { title: "1. Formulaire prêt à l'emploi (iframe)", code: iframe },
            { title: "2. Formulaire HTML (sans JavaScript)", code: html },
            { title: "3. Formulaire existant du site (JavaScript)", code: js },
          ].map((b) => (
            <div key={b.title}>
              <div className="mb-1 flex items-center justify-between font-medium">
                {b.title}
                <Button size="xs" variant="outline" onClick={() => copy(b.code)}>
                  <Copy /> Copier
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{b.code}</pre>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Pensez à autoriser le domaine du site (ex. https://pillqare.com) dans « Origines autorisées ». Point d&apos;accès : <code>{endpoint}</code>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormDialog({ value, users, segments, onClose }: { value: F; users: { id: string; firstName: string; lastName: string }[]; segments: { id: string; name: string }[]; onClose: () => void }) {
  const [v, setV] = useState(value);
  const save = useAction(
    () =>
      saveFormAction({
        ...v,
        id: v.id ?? null,
        callbackDelayMinutes: Number(v.callbackDelayMinutes) || 0,
        allowedOrigins: v.allowedOrigins.split(/[\s,]+/).filter(Boolean),
      }),
    { onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{v.id ? "Modifier le formulaire" : "Nouveau formulaire"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nom">
              <Input className="h-9" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </FormField>
            <FormField label="Identifiant (dans l'URL)">
              <Input className="h-9" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} />
            </FormField>
            <FormField label="Type de contact par défaut">
              <SelectField value={v.contactKind} onChange={(k) => setV({ ...v, contactKind: k as ContactKind })} options={[{ value: "B2C", label: "Particulier (B2C)" }, { value: "B2B", label: "Professionnel (B2B)" }]} />
            </FormField>
            <FormField label="Cible par défaut">
              <SelectField value={v.segmentId} onChange={(s) => setV({ ...v, segmentId: s })} placeholder="Selon le champ « cible » envoyé" options={segments.map((s) => ({ value: s.id, label: s.name }))} />
            </FormField>
            <FormField label="Attribution">
              <SelectField value={v.assignmentStrategy} onChange={(a) => setV({ ...v, assignmentStrategy: a as AssignmentStrategy })} options={Object.entries(ASSIGNMENT_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            {v.assignmentStrategy === "FIXED" && (
              <FormField label="Commercial">
                <SelectField value={v.fixedOwnerId} onChange={(o) => setV({ ...v, fixedOwnerId: o })} placeholder="Choisir…" options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
              </FormField>
            )}
            <FormField label="Tâche de rappel dans (minutes ouvrées)">
              <Input className="h-9" type="number" min={0} value={v.callbackDelayMinutes} onChange={(e) => setV({ ...v, callbackDelayMinutes: e.target.value })} />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} /> Actif
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={v.createDeal} onCheckedChange={(c) => setV({ ...v, createDeal: c })} /> Créer un dossier « Prospect »
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={v.sendConfirmation} onCheckedChange={(c) => setV({ ...v, sendConfirmation: c })} /> Email de confirmation au prospect
            </label>
          </div>
          {v.sendConfirmation && (
            <>
              <FormField label="Objet de la confirmation" hint="Vide = texte par défaut">
                <Input className="h-9" value={v.confirmationSubject} onChange={(e) => setV({ ...v, confirmationSubject: e.target.value })} placeholder="Nous avons bien reçu votre demande — {{org.name}}" />
              </FormField>
              <FormField label="Message de confirmation" hint="Variables : {{contact.greeting}}, {{user.fullName}}, {{bookingLink}}…">
                <Textarea rows={6} value={v.confirmationBody} onChange={(e) => setV({ ...v, confirmationBody: e.target.value })} />
              </FormField>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Message affiché après envoi">
              <Input className="h-9" value={v.successMessage} onChange={(e) => setV({ ...v, successMessage: e.target.value })} />
            </FormField>
            <FormField label="Redirection après envoi (facultatif)">
              <Input className="h-9" value={v.redirectUrl} onChange={(e) => setV({ ...v, redirectUrl: e.target.value })} placeholder="https://pillqare.com/merci" />
            </FormField>
          </div>
          <FormField label="Origines autorisées (une par ligne)" hint="Domaines du site autorisés à envoyer des demandes (CORS). Vide = tous.">
            <Textarea rows={3} value={v.allowedOrigins} onChange={(e) => setV({ ...v, allowedOrigins: e.target.value })} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={save.pending || !v.name || !v.key} onClick={() => save.run()}>
            {save.pending && <Spinner />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormsManager({ forms, users, segments, appUrl }: { forms: F[]; users: { id: string; firstName: string; lastName: string }[]; segments: { id: string; name: string }[]; appUrl: string }) {
  const [edit, setEdit] = useState<F | null>(null);
  const [embed, setEmbed] = useState<F | null>(null);
  const del = useAction(deleteFormAction);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        onClick={() =>
          setEdit({
            name: "",
            key: "",
            active: true,
            description: "",
            contactKind: "B2C",
            segmentId: "",
            assignmentStrategy: "ROUND_ROBIN",
            fixedOwnerId: "",
            createDeal: true,
            sendConfirmation: true,
            confirmationSubject: "",
            confirmationBody: "",
            callbackDelayMinutes: "120",
            successMessage: "",
            redirectUrl: "",
            allowedOrigins: "https://pillqare.com\nhttps://www.pillqare.com",
          })
        }
      >
        <Plus /> Nouveau formulaire
      </Button>
      <ul className="divide-y rounded-lg border">
        {forms.map((f) => (
          <li key={f.id} className={`flex flex-wrap items-center gap-3 px-3 py-3 ${f.active ? "" : "opacity-50"}`}>
            <div className="min-w-60 flex-1">
              <div className="text-sm font-medium">{f.name}</div>
              <div className="text-xs text-muted-foreground">
                {appUrl}/api/public/forms/{f.key} · {f.count ?? 0} demande(s) sur 30 jours · {ASSIGNMENT_LABELS[f.assignmentStrategy]}
              </div>
            </div>
            <Button size="xs" variant="outline" onClick={() => setEmbed(f)}>
              <Code2 /> Intégrer
            </Button>
            <Button size="xs" variant="outline" asChild>
              <a href={`/f/${f.key}`} target="_blank" rel="noreferrer">
                <ExternalLink /> Tester
              </a>
            </Button>
            <Button size="xs" variant="outline" onClick={() => setEdit(f)}>
              <Pencil /> Modifier
            </Button>
            <ConfirmButton title="Supprimer ce formulaire ?" description="Les demandes reçues sont supprimées ; les contacts créés sont conservés." size="icon-sm" variant="ghost" destructive onConfirm={() => del.run(f.id!)}>
              <Trash2 />
            </ConfirmButton>
          </li>
        ))}
      </ul>
      {edit && <FormDialog value={edit} users={users} segments={segments} onClose={() => setEdit(null)} />}
      {embed && <EmbedDialog form={embed} appUrl={appUrl} onClose={() => setEmbed(null)} />}
    </div>
  );
}
