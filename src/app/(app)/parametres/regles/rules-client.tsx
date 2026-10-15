"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField, SelectField } from "@/components/common/fields";
import { SectionCard } from "@/components/common/ui-bits";
import { useAction } from "@/hooks/use-action";
import { updateSettingsAction } from "@/actions/settings";
import { STAGE_LABELS } from "@/lib/labels";
import type { SettingsMap } from "@/lib/settings";

type Initial = Pick<SettingsMap, "pipeline" | "followups" | "meetings" | "digest" | "visibility" | "assignment" | "shopify" | "ai">;

function SaveButton<K extends keyof SettingsMap>({ k, value }: { k: K; value: Partial<SettingsMap[K]> }) {
  const save = useAction(() => updateSettingsAction(k, value));
  return (
    <Button size="sm" disabled={save.pending} onClick={() => save.run()}>
      {save.pending && <Spinner />} Enregistrer
    </Button>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} /> {children}
    </label>
  );
}

export function RulesForms({ initial, admin, users }: { initial: Initial; admin: boolean; users: { id: string; firstName: string; lastName: string }[] }) {
  const [pipeline, setPipeline] = useState(initial.pipeline);
  const [followups, setFollowups] = useState(initial.followups);
  const [meetings, setMeetings] = useState(initial.meetings);
  const [digest, setDigest] = useState(initial.digest);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [assignment, setAssignment] = useState(initial.assignment);
  const [shopify, setShopify] = useState(initial.shopify);
  const [ai, setAi] = useState(initial.ai);
  return (
    <div className="space-y-6">
      <SectionCard title="Pipeline et dossiers bloqués" actions={<SaveButton k="pipeline" value={pipeline} />}>
        <div className="space-y-4">
          <Toggle checked={pipeline.requireNextAction} onChange={(v) => setPipeline({ ...pipeline, requireNextAction: v })}>
            Exiger une prochaine action datée à la création d&apos;un dossier
          </Toggle>
          <FormField label="Un dossier est « inactif » sans activité depuis (jours)" className="max-w-xs">
            <Input className="h-9" type="number" min={1} value={pipeline.staleDays} onChange={(e) => setPipeline({ ...pipeline, staleDays: Number(e.target.value) || 14 })} />
          </FormField>
          <div>
            <div className="mb-1.5 text-xs font-medium text-foreground/80">Durée maximale conseillée par étape (jours) avant alerte</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"] as const).map((s) => (
                <FormField key={s} label={STAGE_LABELS[s]}>
                  <Input
                    className="h-9"
                    type="number"
                    min={0}
                    value={pipeline.stageMaxDays[s] ?? ""}
                    onChange={(e) => setPipeline({ ...pipeline, stageMaxDays: { ...pipeline.stageMaxDays, [s]: Number(e.target.value) || undefined } })}
                  />
                </FormField>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Relances automatiques" actions={<SaveButton k="followups" value={followups} />}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FormField label="Envois à partir de">
              <Input className="h-9" type="time" value={followups.windowStart} onChange={(e) => setFollowups({ ...followups, windowStart: e.target.value })} />
            </FormField>
            <FormField label="Jusqu'à">
              <Input className="h-9" type="time" value={followups.windowEnd} onChange={(e) => setFollowups({ ...followups, windowEnd: e.target.value })} />
            </FormField>
            <FormField label="« Sans réponse » après (jours)">
              <Input className="h-9" type="number" min={1} value={followups.noReplyDays} onChange={(e) => setFollowups({ ...followups, noReplyDays: Number(e.target.value) || 3 })} />
            </FormField>
          </div>
          <Toggle checked={followups.skipWeekends} onChange={(v) => setFollowups({ ...followups, skipWeekends: v })}>
            Ne rien envoyer le week-end
          </Toggle>
          <Toggle checked={followups.replyTask} onChange={(v) => setFollowups({ ...followups, replyTask: v })}>
            Créer une tâche « Répondre » quand un prospect répond
          </Toggle>
          <Toggle checked={followups.unsubscribeFooter} onChange={(v) => setFollowups({ ...followups, unsubscribeFooter: v })}>
            Ajouter un lien de désinscription aux relances automatiques (recommandé, RGPD)
          </Toggle>
        </div>
      </SectionCard>

      <SectionCard title="Rendez-vous et comptes rendus" actions={<SaveButton k="meetings" value={meetings} />}>
        <div className="space-y-3">
          <Toggle checked={meetings.reminder24h} onChange={(v) => setMeetings({ ...meetings, reminder24h: v })}>
            Rappel au contact 24 h avant le RDV
          </Toggle>
          <Toggle checked={meetings.reminder1h} onChange={(v) => setMeetings({ ...meetings, reminder1h: v })}>
            Rappel au contact 1 h avant le RDV
          </Toggle>
          <Toggle checked={meetings.reportTask} onChange={(v) => setMeetings({ ...meetings, reportTask: v })}>
            Créer une tâche « compte rendu » après chaque RDV
          </Toggle>
          <Toggle checked={meetings.autoReportFromMeet} onChange={(v) => setMeetings({ ...meetings, autoReportFromMeet: v })}>
            Récupérer la transcription Google Meet et générer le compte rendu IA automatiquement
          </Toggle>
        </div>
      </SectionCard>

      <SectionCard title="Planning quotidien et synthèses" actions={<SaveButton k="digest" value={digest} />}>
        <div className="space-y-3">
          <Toggle checked={digest.enabled} onChange={(v) => setDigest({ ...digest, enabled: v })}>
            Envoyer chaque matin (jours ouvrés) le planning de la journée à chaque commercial
          </Toggle>
          <FormField label="Heure d'envoi" className="max-w-40">
            <Input className="h-9" type="time" value={digest.hour} onChange={(e) => setDigest({ ...digest, hour: e.target.value })} />
          </FormField>
          <Toggle checked={digest.managerWeekly} onChange={(v) => setDigest({ ...digest, managerWeekly: v })}>
            Synthèse hebdomadaire de l&apos;équipe aux managers (lundi)
          </Toggle>
        </div>
      </SectionCard>

      <SectionCard title="Attribution des leads" actions={<SaveButton k="assignment" value={{ defaultOwnerId: assignment.defaultOwnerId }} />}>
        <FormField label="Commercial par défaut pour les clients Shopify et emails entrants" hint="Sinon : tour de rôle entre les commerciaux qui reçoivent des leads." className="max-w-md">
          <SelectField value={assignment.defaultOwnerId ?? ""} onChange={(v) => setAssignment({ ...assignment, defaultOwnerId: v || null })} placeholder="Tour de rôle" options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
        </FormField>
      </SectionCard>

      {admin && (
        <>
          <SectionCard title="Visibilité" actions={<SaveButton k="visibility" value={visibility} />}>
            <Toggle checked={visibility.salesSeeAll} onChange={(v) => setVisibility({ salesSeeAll: v })}>
              Les commerciaux voient tous les contacts et dossiers (sinon uniquement les leurs)
            </Toggle>
          </SectionCard>
          <SectionCard title="Shopify — suivi après-achat" actions={<SaveButton k="shopify" value={shopify} />}>
            <div className="space-y-3">
              <Toggle checked={shopify.postPurchaseEnabled} onChange={(v) => setShopify({ ...shopify, postPurchaseEnabled: v })}>
                Démarrer le suivi après-achat (installation, prise en main, satisfaction) à chaque commande payée
              </Toggle>
              <Toggle checked={shopify.importCustomersWithoutOrders} onChange={(v) => setShopify({ ...shopify, importCustomersWithoutOrders: v })}>
                Importer aussi les comptes clients sans commande
              </Toggle>
            </div>
          </SectionCard>
          <SectionCard title="Intelligence artificielle" description="Utilisé pour la rédaction d'emails, la personnalisation des relances, l'analyse des dossiers et les comptes rendus." actions={<SaveButton k="ai" value={ai} />}>
            <div className="space-y-3">
              <FormField label="Contexte transmis à l'IA (offre, cibles, arguments)" hint="Ce que l'IA sait de PillQare : offre, prix, arguments, cibles. Elle n'utilise que ces informations et celles du dossier, jamais d'autres chiffres.">
                <Textarea rows={6} value={ai.productContext} onChange={(e) => setAi({ ...ai, productContext: e.target.value })} />
              </FormField>
              <FormField label="Ton des emails" hint="Ex. : professionnel, chaleureux et concis, vouvoiement">
                <Input className="h-9" value={ai.followUpTone} onChange={(e) => setAi({ ...ai, followUpTone: e.target.value })} />
              </FormField>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
