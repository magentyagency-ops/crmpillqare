"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClipboardPaste, FileAudio, Mic, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AsyncPicker } from "@/components/common/async-picker";
import { FormField, SelectField } from "@/components/common/fields";
import { Recorder } from "@/components/assistant/recorder";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { dealsForContactAction } from "@/actions/deals";
import { createAiSessionAction } from "@/actions/assistant";
import { STAGE_LABELS } from "@/lib/labels";
import type { DealStage } from "@/generated/prisma/enums";

type Kind = "CALL" | "VIDEO" | "IN_PERSON";
type Mode = "LIVE" | "UPLOAD" | "PASTE";

export function NewSession({
  initialKind,
  initialContact,
  initialDealId,
  meeting,
  ai,
  transcription,
}: {
  initialKind: Kind;
  initialContact: PickerOption | null;
  initialDealId: string | null;
  meeting: { id: string; title: string } | null;
  ai: boolean;
  transcription: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [mode, setMode] = useState<Mode>("LIVE");
  const [contact, setContact] = useState<PickerOption | null>(initialContact);
  const [dealsFor, setDealsFor] = useState<{ contactId: string; list: { id: string; title: string; stage: DealStage }[] } | null>(null);
  const deals = contact && dealsFor?.contactId === contact.id ? dealsFor.list : [];
  const [dealId, setDealId] = useState(initialDealId ?? "");
  const [consent, setConsent] = useState(false);
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    dealsForContactAction(contact.id).then((list) => {
      if (cancelled) return;
      setDealsFor({ contactId: contact.id, list });
      setDealId((current) => current || (list.find((d) => d.stage !== "WON" && d.stage !== "LOST")?.id ?? ""));
    });
    return () => {
      cancelled = true;
    };
  }, [contact]);

  const create = async () => {
    setBusy(true);
    const res = await createAiSessionAction({
      kind,
      contactId: contact?.id ?? null,
      dealId: dealId || null,
      meetingId: meeting?.id ?? null,
      source: mode,
      consent: mode === "PASTE" ? true : consent,
      transcript: mode === "PASTE" ? pasted : null,
    });
    if (!res.ok || !res.data) {
      setBusy(false);
      toast.error(res.ok ? "Erreur" : res.error);
      return;
    }
    const id = res.data.id;
    if (mode === "LIVE") {
      setSessionId(id);
      setBusy(false);
      return;
    }
    if (mode === "PASTE") {
      router.push(`/assistant/${id}`);
      return;
    }
    // Import : envoi avec suivi de progression
    const duration = await new Promise<number | null>((resolve) => {
      try {
        const audio = new Audio(URL.createObjectURL(file!));
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
        audio.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    const fd = new FormData();
    fd.append("file", file!);
    if (duration) fd.append("durationSec", String(duration));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/assistant/${id}/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) router.push(`/assistant/${id}`);
      else {
        let message = "Import impossible";
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
        } catch {
          // réponse non JSON
        }
        toast.error(message);
        setBusy(false);
        setProgress(null);
      }
    };
    xhr.onerror = () => {
      toast.error("Erreur réseau pendant l'import.");
      setBusy(false);
      setProgress(null);
    };
    xhr.send(fd);
  };

  if (sessionId) {
    return <Recorder sessionId={sessionId} kind={kind} serverTranscription={transcription} />;
  }

  const canStart = mode === "PASTE" ? pasted.trim().length >= 40 : mode === "UPLOAD" ? Boolean(file) && consent && transcription : consent;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-5 rounded-xl bg-card p-5 surface lg:col-span-2">
        {!ai && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            L&apos;IA n&apos;est pas configurée (clé ANTHROPIC_API_KEY) : la transcription sera conservée mais le compte rendu devra être rédigé manuellement.
          </div>
        )}
        <FormField label="Type d'échange">
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as Kind)} className="w-full">
            <ToggleGroupItem value="CALL" className="flex-1">
              Appel téléphonique
            </ToggleGroupItem>
            <ToggleGroupItem value="VIDEO" className="flex-1">
              Visio
            </ToggleGroupItem>
            <ToggleGroupItem value="IN_PERSON" className="flex-1">
              RDV physique
            </ToggleGroupItem>
          </ToggleGroup>
        </FormField>
        {meeting && <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">Rendez-vous lié : {meeting.title}</div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Contact">
            <AsyncPicker
              value={contact}
              onChange={(c) => {
                setContact(c);
                setDealId("");
              }}
              search={searchContactsAction} placeholder="Rechercher un contact…" />
          </FormField>
          <FormField label="Dossier">
            <SelectField value={dealId} onChange={setDealId} placeholder="Aucun" options={deals.map((d) => ({ value: d.id, label: `${d.title} (${STAGE_LABELS[d.stage]})` }))} />
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "LIVE", icon: Mic, title: "Enregistrer", text: "Pendant l'appel, la visio ou le RDV" },
              { value: "UPLOAD", icon: FileAudio, title: "Importer un audio", text: "Enregistrement d'appel ou de réunion" },
              { value: "PASTE", icon: ClipboardPaste, title: "Coller des notes", text: "Transcription Meet/Teams ou notes" },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn("rounded-lg border p-3 text-left transition-colors", mode === m.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent")}
            >
              <m.icon className="mb-1 size-5 text-primary" />
              <div className="text-sm font-semibold">{m.title}</div>
              <div className="text-xs text-muted-foreground">{m.text}</div>
            </button>
          ))}
        </div>

        {mode === "UPLOAD" && (
          <div className="space-y-2">
            {!transcription && <p className="text-sm text-rose-600">Aucun service de transcription configuré : l&apos;import audio est indisponible.</p>}
            <input type="file" accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            {progress !== null && (
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">{progress < 100 ? `Envoi… ${progress} %` : "Transcription en cours, cela peut prendre une à deux minutes…"}</p>
              </div>
            )}
          </div>
        )}
        {mode === "PASTE" && (
          <Textarea rows={12} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Collez ici la transcription de la réunion ou vos notes prises pendant l'échange…" />
        )}
        {mode !== "PASTE" && (
          <label className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
            <Checkbox checked={consent} onCheckedChange={(c) => setConsent(Boolean(c))} className="mt-0.5" />
            <span>
              <ShieldCheck className="mr-1 inline size-4 text-emerald-700" />
              J&apos;ai informé mon interlocuteur que l&apos;échange est enregistré afin d&apos;en rédiger le compte rendu. L&apos;audio n&apos;est pas conservé : seule la
              transcription est enregistrée.
            </span>
          </label>
        )}
        <div className="flex justify-end">
          <Button size="lg" disabled={!canStart || busy} onClick={create}>
            {busy && <Spinner />}
            {mode === "LIVE" ? "Préparer l'enregistrement" : mode === "UPLOAD" ? "Importer et analyser" : "Générer le compte rendu"}
          </Button>
        </div>
      </div>
      <div className="space-y-3 rounded-xl bg-card p-5 text-sm surface">
        <div className="font-semibold text-brand-navy">Comment ça marche ?</div>
        <ol className="list-decimal space-y-2 pl-4 text-muted-foreground">
          <li>Pendant l&apos;échange, l&apos;assistant transcrit la conversation au fil de l&apos;eau.</li>
          <li>À la fin, l&apos;IA rédige le compte rendu : résumé, besoins, objections, prochaines actions et un email de suivi.</li>
          <li>Vous relisez, corrigez, choisissez les tâches à créer et validez l&apos;email avant envoi.</li>
          <li>Le compte rendu est enregistré sur la fiche du contact et du dossier.</li>
        </ol>
        <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          <strong>Visio :</strong> cochez « Capturer le son de la visio » puis choisissez l&apos;onglet de la réunion en cochant « Partager l&apos;audio ». Avec Google Meet, la
          transcription Meet est aussi récupérée automatiquement après le RDV (si activée).
          <br />
          <strong>RDV physique :</strong> ouvrez le CRM sur votre téléphone et posez-le entre vous.
          <br />
          <strong>Appel :</strong> mettez le haut-parleur ou importez l&apos;enregistrement de l&apos;appel.
        </div>
      </div>
    </div>
  );
}
