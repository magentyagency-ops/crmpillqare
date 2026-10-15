"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, CheckSquare, Mail, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmButton, FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { deleteSequenceAction, saveSequenceAction, toggleSequenceAction } from "@/actions/sequences";
import { SEQUENCE_TRIGGER_LABELS, STAGE_LABELS } from "@/lib/labels";
import { TEMPLATE_VARIABLE_HELP } from "@/lib/email/render";
import type { SequenceStepType, SequenceTrigger } from "@/generated/prisma/enums";

export function SequenceToggle({ id, active }: { id: string; active: boolean }) {
  const toggle = useAction((v: boolean) => toggleSequenceAction(id, v));
  return <Switch checked={active} disabled={toggle.pending} onCheckedChange={(v) => toggle.run(v)} aria-label="Actif" />;
}

export type StepDraft = {
  type: SequenceStepType;
  delayDays: string;
  delayHours: string;
  delayMinutes: string;
  sendTime: string;
  subject: string;
  body: string;
  taskTitle: string;
  taskDescription: string;
  requiresApproval: boolean;
  aiPersonalize: boolean;
};

export type ScenarioDraft = {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  trigger: SequenceTrigger;
  triggerStage: string;
  contactKind: string;
  segmentIds: string[];
  priority: string;
  stopOnReply: boolean;
  stopOnStageChange: boolean;
  stopOnMeetingBooked: boolean;
  businessHoursOnly: boolean;
  steps: StepDraft[];
};

const emptyStep = (type: SequenceStepType): StepDraft => ({
  type,
  delayDays: "2",
  delayHours: "0",
  delayMinutes: "0",
  sendTime: "09:30",
  subject: "",
  body: type === "EMAIL" ? "{{contact.greeting}}\n\n\n\nBien cordialement," : "",
  taskTitle: type === "CALL" ? "Appeler {{contact.fullName}}" : type === "TASK" ? "Relance : {{contact.fullName}}" : "",
  taskDescription: "",
  requiresApproval: false,
  aiPersonalize: true,
});

const STEP_ICON = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare } as const;

export function ScenarioEditor({ initial }: { initial: ScenarioDraft }) {
  const { segments } = useAppData();
  const router = useRouter();
  const [s, setS] = useState<ScenarioDraft>(initial);
  const set = <K extends keyof ScenarioDraft>(k: K, v: ScenarioDraft[K]) => setS((p) => ({ ...p, [k]: v }));
  const setStep = (i: number, patch: Partial<StepDraft>) => setS((p) => ({ ...p, steps: p.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const move = (i: number, d: -1 | 1) =>
    setS((p) => {
      const steps = [...p.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...p, steps };
    });
  const save = useAction(saveSequenceAction, { onSuccess: (d) => d && router.push(`/relances/scenarios/${d.id}`) });
  const del = useAction(() => deleteSequenceAction(s.id!), { onSuccess: () => router.push("/relances/scenarios"), refresh: false });

  const cumulative = s.steps.reduce<number[]>((acc, st) => [...acc, (acc[acc.length - 1] ?? 0) + Number(st.delayDays || 0)], []);
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({
          id: s.id ?? null,
          name: s.name,
          description: s.description,
          active: s.active,
          trigger: s.trigger,
          triggerStage: (s.triggerStage || null) as "PROSPECT" | null,
          contactKind: (s.contactKind || null) as "B2B" | null,
          segmentIds: s.segmentIds,
          priority: s.priority,
          stopOnReply: s.stopOnReply,
          stopOnStageChange: s.stopOnStageChange,
          stopOnMeetingBooked: s.stopOnMeetingBooked,
          businessHoursOnly: s.businessHoursOnly,
          steps: s.steps.map((st) => ({
            type: st.type,
            delayDays: st.delayDays,
            delayHours: st.delayHours,
            delayMinutes: st.delayMinutes,
            sendTime: st.sendTime,
            subject: st.subject,
            body: st.body,
            taskTitle: st.taskTitle,
            taskDescription: st.taskDescription,
            requiresApproval: st.requiresApproval,
            aiPersonalize: st.aiPersonalize,
          })),
        });
      }}
    >
      <div className="rounded-xl bg-card p-5 surface">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Nom du scénario" required>
            <Input className="h-9" value={s.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField label="Description">
            <Input className="h-9" value={s.description} onChange={(e) => set("description", e.target.value)} />
          </FormField>
          <FormField label="Déclencheur" required>
            <SelectField value={s.trigger} onChange={(v) => set("trigger", v as SequenceTrigger)} options={Object.entries(SEQUENCE_TRIGGER_LABELS).map(([value, label]) => ({ value, label }))} />
          </FormField>
          {s.trigger === "STAGE_ENTERED" && (
            <FormField label="Étape du pipeline" required>
              <SelectField
                value={s.triggerStage}
                onChange={(v) => set("triggerStage", v)}
                placeholder="Choisir…"
                options={(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"] as const).map((st) => ({ value: st, label: STAGE_LABELS[st] }))}
              />
            </FormField>
          )}
          <FormField label="Type de client">
            <SelectField value={s.contactKind} onChange={(v) => set("contactKind", v)} placeholder="B2B et B2C" options={[{ value: "B2B", label: "Professionnels (B2B)" }, { value: "B2C", label: "Particuliers (B2C)" }]} />
          </FormField>
          <FormField label="Priorité" hint="Si plusieurs scénarios correspondent, le plus prioritaire est utilisé.">
            <Input className="h-9" type="number" value={s.priority} onChange={(e) => set("priority", e.target.value)} />
          </FormField>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-foreground/80">Cibles (vide = toutes)</div>
          <div className="flex flex-wrap gap-2">
            {segments.map((seg) => (
              <label key={seg.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                <Checkbox
                  checked={s.segmentIds.includes(seg.id)}
                  onCheckedChange={(c) => set("segmentIds", c ? [...s.segmentIds, seg.id] : s.segmentIds.filter((x) => x !== seg.id))}
                />
                {seg.name}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={s.active} onCheckedChange={(v) => set("active", v)} /> Actif
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.stopOnReply} onCheckedChange={(v) => set("stopOnReply", Boolean(v))} /> Arrêter si le contact répond
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.stopOnMeetingBooked} onCheckedChange={(v) => set("stopOnMeetingBooked", Boolean(v))} /> Arrêter si un RDV est pris
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.businessHoursOnly} onCheckedChange={(v) => set("businessHoursOnly", Boolean(v))} /> Envoyer uniquement en heures ouvrées
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.stopOnStageChange} onCheckedChange={(v) => set("stopOnStageChange", Boolean(v))} /> Arrêter si le dossier change d&apos;étape
          </label>
        </div>
      </div>

      <div className="space-y-3">
        {s.steps.map((st, i) => {
          const Icon = STEP_ICON[st.type];
          return (
            <div key={i} className="rounded-xl bg-card p-4 surface">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
                <Icon className="size-4 text-muted-foreground" />
                <SelectField
                  ariaLabel={`Type de l'étape ${i + 1}`}
                  value={st.type}
                  onChange={(v) => setStep(i, { type: v as SequenceStepType })}
                  options={[{ value: "EMAIL", label: "Email automatique" }, { value: "CALL", label: "Appel (tâche)" }, { value: "TASK", label: "Tâche" }]}
                  className="w-48"
                />
                <span className="text-sm text-muted-foreground">après</span>
                <Input className="h-9 w-16" aria-label={`Délai en jours (étape ${i + 1})`} type="number" min={0} value={st.delayDays} onChange={(e) => setStep(i, { delayDays: e.target.value })} />
                <span className="text-sm text-muted-foreground">jour(s) +</span>
                <Input className="h-9 w-16" aria-label={`Délai en heures (étape ${i + 1})`} type="number" min={0} max={23} value={st.delayHours} onChange={(e) => setStep(i, { delayHours: e.target.value })} />
                <span className="text-sm text-muted-foreground">h +</span>
                <Input className="h-9 w-16" aria-label={`Délai en minutes (étape ${i + 1})`} type="number" min={0} max={59} value={st.delayMinutes} onChange={(e) => setStep(i, { delayMinutes: e.target.value })} />
                <span className="text-sm text-muted-foreground">min, vers</span>
                <Input className="h-9 w-24" aria-label={`Heure d'envoi (étape ${i + 1})`} type="time" value={st.sendTime} onChange={(e) => setStep(i, { sendTime: e.target.value })} />
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">≈ J+{cumulative[i]}</span>
                <div className="ml-auto flex gap-1">
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Monter l'étape ${i + 1}`} onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Descendre l'étape ${i + 1}`} onClick={() => move(i, 1)} disabled={i === s.steps.length - 1}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Supprimer l'étape ${i + 1}`} onClick={() => setS((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {st.type === "EMAIL" ? (
                <div className="space-y-2">
                  <FormField label="Objet" hint={i > 0 ? "Laissez vide pour répondre dans le fil du premier email (« Re: … »)." : undefined}>
                    <Input className="h-9" value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} />
                  </FormField>
                  <FormField label="Message">
                    <Textarea rows={7} value={st.body} onChange={(e) => setStep(i, { body: e.target.value })} />
                  </FormField>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={st.requiresApproval} onCheckedChange={(v) => setStep(i, { requiresApproval: Boolean(v) })} />
                    Le commercial valide (et peut modifier) l&apos;email avant envoi
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-0.5" checked={st.aiPersonalize} onCheckedChange={(v) => setStep(i, { aiPersonalize: Boolean(v) })} />
                    <span>
                      ✨ Personnaliser avec l&apos;IA pour chaque contact
                      <span className="block text-xs text-muted-foreground">
                        Le message ci-dessus sert de base : l&apos;IA l&apos;adapte à la cible, au besoin et aux derniers échanges du contact, sans rien inventer. En cas de souci, le modèle part tel quel.
                      </span>
                    </span>
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <FormField label="Intitulé de la tâche">
                    <Input className="h-9" value={st.taskTitle} onChange={(e) => setStep(i, { taskTitle: e.target.value })} />
                  </FormField>
                  <FormField label="Consignes">
                    <Input className="h-9" value={st.taskDescription} onChange={(e) => setStep(i, { taskDescription: e.target.value })} />
                  </FormField>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setS((p) => ({ ...p, steps: [...p.steps, emptyStep("EMAIL")] }))}>
            <Plus /> Email
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setS((p) => ({ ...p, steps: [...p.steps, emptyStep("CALL")] }))}>
            <Plus /> Appel
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setS((p) => ({ ...p, steps: [...p.steps, emptyStep("TASK")] }))}>
            <Plus /> Tâche
          </Button>
        </div>
      </div>

      <details className="rounded-xl bg-card p-4 text-sm surface">
        <summary className="cursor-pointer font-medium">Variables disponibles</summary>
        <ul className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
          {TEMPLATE_VARIABLE_HELP.map((v) => (
            <li key={v.key}>
              <code className="rounded bg-muted px-1 text-xs">{`{{${v.key}}}`}</code> — {v.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Valeur de repli : {"{{company.name|votre établissement}}"}. Les emails partent en heures ouvrées (réglables dans Paramètres) depuis la boîte du commercial.</p>
      </details>

      <div className="flex flex-wrap justify-between gap-2">
        {s.id ? (
          <ConfirmButton title="Supprimer ce scénario ?" description="Impossible s'il est utilisé par des relances en cours." destructive onConfirm={() => del.run()}>
            <Trash2 /> Supprimer
          </ConfirmButton>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.pending}>
          {save.pending && <Spinner />} Enregistrer le scénario
        </Button>
      </div>
    </form>
  );
}
