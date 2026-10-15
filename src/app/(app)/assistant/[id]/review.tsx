"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Send, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmButton, DateTimeField, FormField, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { deleteAiSessionAction, getSessionLiveAction, regenerateReportAction, validateReportAction } from "@/actions/assistant";
import { AI_STATUS_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import type { MeetingReport } from "@/lib/ai/report";
import type { AiSessionStatus, DealStage } from "@/generated/prisma/enums";

/** Suivi de l'analyse (transcription → IA) avec rafraîchissement automatique. */
export function SessionProgress({ sessionId, status }: { sessionId: string; status: AiSessionStatus }) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [segments, setSegments] = useState(0);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const live = await getSessionLiveAction(sessionId);
        setCurrent(live.status);
        setSegments(live.segments.filter((s) => s.status === "DONE").length);
        if (!["TRANSCRIBING", "ANALYZING", "RECORDING"].includes(live.status)) {
          clearInterval(t);
          router.refresh();
        }
      } catch {
        // réessai au prochain tour
      }
    }, 2500);
    return () => clearInterval(t);
  }, [sessionId, router]);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-10 text-center surface">
      <Spinner className="size-8" />
      <div className="text-lg font-semibold text-brand-navy">{AI_STATUS_LABELS[current]}…</div>
      <p className="max-w-md text-sm text-muted-foreground">
        {current === "TRANSCRIBING" && "Finalisation de la transcription."}
        {current === "ANALYZING" && "L'IA rédige le compte rendu, les prochaines actions et l'email de suivi (en général moins d'une minute)."}
        {current === "RECORDING" && `Enregistrement en cours dans un autre onglet (${segments} segment(s) transcrit(s)).`}
        {" "}Vous pouvez quitter cette page : une notification vous préviendra quand le compte rendu sera prêt.
      </p>
    </div>
  );
}

function EditableList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="h-8" value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="ghost" onClick={() => onChange([...items, ""])}>
        <Plus /> {placeholder}
      </Button>
    </div>
  );
}

type ActionDraft = MeetingReport["nextActions"][number] & { selected: boolean; dueAt: string };

export function ReportReview({
  sessionId,
  initialSummary,
  report,
  defaultDue,
  followUp,
  deal,
  contactEmail,
  transcript,
  aiAvailable,
  notice,
}: {
  sessionId: string;
  initialSummary: string;
  report: MeetingReport;
  defaultDue: string[];
  followUp: { to: string; subject: string; body: string };
  deal: { id: string; stage: DealStage; title: string } | null;
  contactEmail: string | null;
  transcript: string;
  aiAvailable: boolean;
  notice: string | null;
}) {
  const { lostReasons } = useAppData();
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [keyPoints, setKeyPoints] = useState(report.keyPoints);
  const [needs, setNeeds] = useState(report.needs);
  const [objections, setObjections] = useState(report.objections);
  const [actions, setActions] = useState<ActionDraft[]>(report.nextActions.map((a, i) => ({ ...a, selected: a.owner === "commercial", dueAt: defaultDue[i] ?? "" })));
  const [facts, setFacts] = useState({
    budget: report.budget ?? "",
    timeline: report.timeline ?? "",
    quantities: report.quantities ?? "",
    decisionMakers: report.decisionMakers.join(", "),
    competitors: report.competitors.join(", "),
  });
  const [risks, setRisks] = useState(report.risks);
  const [interest, setInterest] = useState(report.interestLevel || 3);
  const [stage, setStage] = useState<string>(report.suggestedStage && deal && report.suggestedStage !== deal.stage ? report.suggestedStage : "");
  const [lostReasonId, setLostReasonId] = useState("");
  const [sendEmail, setSendEmail] = useState(Boolean(contactEmail && followUp.body));
  const [to, setTo] = useState(followUp.to || contactEmail || "");
  const [subject, setSubject] = useState(followUp.subject);
  const [body, setBody] = useState(followUp.body);
  const [text, setText] = useState(transcript);
  const [showTranscript, setShowTranscript] = useState(false);

  const validate = useAction(validateReportAction, { onSuccess: () => router.refresh() });
  const regenerate = useAction((t: string | null) => regenerateReportAction(sessionId, t));
  const del = useAction(() => deleteAiSessionAction(sessionId), { onSuccess: () => router.push("/assistant"), refresh: false });

  const submit = () => {
    const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const finalReport: MeetingReport = {
      ...report,
      summary,
      keyPoints: keyPoints.filter((x) => x.trim()),
      needs: needs.filter((x) => x.trim()),
      objections: objections.filter((o) => o.objection.trim()),
      nextActions: actions.filter((a) => a.title.trim()).map((a) => ({ title: a.title, owner: a.owner, type: a.type, dueInDays: a.dueInDays })),
      budget: facts.budget || null,
      timeline: facts.timeline || null,
      quantities: facts.quantities || null,
      decisionMakers: split(facts.decisionMakers),
      competitors: split(facts.competitors),
      risks: risks.filter((x) => x.trim()),
      interestLevel: interest,
      suggestedStage: (stage || null) as MeetingReport["suggestedStage"],
      followUpEmail: { subject, body },
    };
    const tasks = actions.filter((a) => a.selected && a.title.trim()).map((a) => ({ title: a.title, type: a.type, dueAt: a.dueAt }));
    if (tasks.some((t) => !t.dueAt)) {
      toast.error("Indiquez une échéance pour chaque tâche cochée.");
      return;
    }
    validate.run(sessionId, {
      summary,
      report: finalReport,
      tasks,
      followUp: { send: sendEmail, to, subject, body },
      dealStage: (stage || null) as DealStage | null,
      lostReasonId: lostReasonId || null,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        {notice && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{notice}</div>}
        <section className="space-y-4 rounded-xl bg-card p-5 surface">
          <FormField label="Résumé de l'échange" required>
            <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Points clés">
              <EditableList items={keyPoints} onChange={setKeyPoints} placeholder="Ajouter un point" />
            </FormField>
            <FormField label="Besoins identifiés">
              <EditableList items={needs} onChange={setNeeds} placeholder="Ajouter un besoin" />
            </FormField>
          </div>
          <FormField label="Objections et réponses">
            <div className="space-y-2">
              {objections.map((o, i) => (
                <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border p-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  <Input className="h-8" value={o.objection} placeholder="Objection" onChange={(e) => setObjections(objections.map((x, j) => (j === i ? { ...x, objection: e.target.value } : x)))} />
                  <Input className="h-8" value={o.response} placeholder="Réponse apportée" onChange={(e) => setObjections(objections.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)))} />
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={o.resolved} onCheckedChange={(c) => setObjections(objections.map((x, j) => (j === i ? { ...x, resolved: Boolean(c) } : x)))} /> Levée
                  </label>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setObjections(objections.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" size="xs" variant="ghost" onClick={() => setObjections([...objections, { objection: "", response: "", resolved: false }])}>
                <Plus /> Ajouter une objection
              </Button>
            </div>
          </FormField>
        </section>

        <section className="space-y-3 rounded-xl bg-card p-5 surface">
          <div className="text-sm font-semibold text-brand-navy">Prochaines actions</div>
          <p className="text-xs text-muted-foreground">Les actions cochées deviennent des tâches datées dans votre planning.</p>
          {actions.map((a, i) => (
            <div key={i} className={cn("grid grid-cols-1 items-center gap-2 rounded-lg border p-2 md:grid-cols-[auto_minmax(0,1fr)_110px_280px_auto]", !a.selected && "opacity-70")}>
              <Checkbox checked={a.selected} onCheckedChange={(c) => setActions(actions.map((x, j) => (j === i ? { ...x, selected: Boolean(c) } : x)))} />
              <div>
                <Input className="h-8" aria-label={`Action ${i + 1}`} value={a.title} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <span className="text-[11px] text-muted-foreground">{a.owner === "client" ? "Action du client (à suivre)" : "Action du commercial"}</span>
              </div>
              <SelectField
                ariaLabel={`Type de l'action ${i + 1}`}
                value={a.type}
                onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, type: v as ActionDraft["type"] } : x)))}
                options={[
                  { value: "CALL", label: "Appel" },
                  { value: "EMAIL", label: "Email" },
                  { value: "MEETING", label: "RDV" },
                  { value: "QUOTE", label: "Devis" },
                  { value: "TRIAL", label: "Essai" },
                  { value: "TASK", label: "Tâche" },
                ]}
              />
              <DateTimeField value={a.dueAt} onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, dueAt: v } : x)))} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Retirer l'action ${i + 1}`} onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <Button type="button" size="xs" variant="ghost" onClick={() => setActions([...actions, { title: "", owner: "commercial", type: "CALL", dueInDays: 2, selected: true, dueAt: defaultDue[defaultDue.length - 1] ?? "" }])}>
            <Plus /> Ajouter une action
          </Button>
        </section>

        <section className="space-y-3 rounded-xl bg-card p-5 surface">
          <label className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
            <Checkbox checked={sendEmail} onCheckedChange={(c) => setSendEmail(Boolean(c))} disabled={!contactEmail && !to} />
            Envoyer l&apos;email de suivi au contact
          </label>
          <div className={cn("space-y-3", !sendEmail && "opacity-60")}>
            <FormField label="Destinataire(s)">
              <Input className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
            <FormField label="Objet">
              <Input className="h-9" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </FormField>
            <FormField label="Message" hint="Votre signature est ajoutée automatiquement.">
              <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </FormField>
          </div>
        </section>

        <section className="rounded-xl bg-card p-5 surface">
          <button type="button" className="text-sm font-semibold text-brand-navy" onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "▾" : "▸"} Transcription ({text.length.toLocaleString("fr-FR")} caractères)
          </button>
          {showTranscript && (
            <div className="mt-3 space-y-2">
              <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
              {aiAvailable && (
                <Button type="button" size="sm" variant="outline" disabled={regenerate.pending} onClick={() => regenerate.run(text)}>
                  <Sparkles /> Régénérer le compte rendu à partir de ce texte
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="space-y-5">
        <section className="space-y-3 rounded-xl bg-card p-5 surface">
          <div className="text-sm font-semibold text-brand-navy">Qualification</div>
          <FormField label={`Intérêt du prospect : ${interest}/5`}>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setInterest(n)} className={cn("h-8 flex-1 rounded-md text-sm font-semibold", n <= interest ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")}>
                  {n}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Budget">
            <Input className="h-9" value={facts.budget} onChange={(e) => setFacts({ ...facts, budget: e.target.value })} />
          </FormField>
          <FormField label="Calendrier de décision">
            <Input className="h-9" value={facts.timeline} onChange={(e) => setFacts({ ...facts, timeline: e.target.value })} />
          </FormField>
          <FormField label="Volumes">
            <Input className="h-9" value={facts.quantities} onChange={(e) => setFacts({ ...facts, quantities: e.target.value })} />
          </FormField>
          <FormField label="Décideurs">
            <Input className="h-9" value={facts.decisionMakers} onChange={(e) => setFacts({ ...facts, decisionMakers: e.target.value })} />
          </FormField>
          <FormField label="Concurrence / solution actuelle">
            <Input className="h-9" value={facts.competitors} onChange={(e) => setFacts({ ...facts, competitors: e.target.value })} />
          </FormField>
          <FormField label="Points de vigilance">
            <EditableList items={risks} onChange={setRisks} placeholder="Ajouter" />
          </FormField>
        </section>

        {deal && (
          <section className="space-y-3 rounded-xl bg-card p-5 surface">
            <div className="text-sm font-semibold text-brand-navy">Dossier : {deal.title}</div>
            <FormField label={`Étape (actuelle : ${STAGE_LABELS[deal.stage]})`} hint={report.suggestedStage ? `Suggestion de l'IA : ${STAGE_LABELS[report.suggestedStage]}` : undefined}>
              <SelectField value={stage} onChange={setStage} placeholder="Ne pas changer" options={STAGE_ORDER.filter((s) => s !== deal.stage).map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />
            </FormField>
            {stage === "LOST" && (
              <FormField label="Motif du refus" required>
                <SelectField value={lostReasonId} onChange={setLostReasonId} placeholder="Choisir…" options={lostReasons.map((r) => ({ value: r.id, label: r.label }))} />
              </FormField>
            )}
          </section>
        )}

        <section className="space-y-2 rounded-xl bg-card p-5 surface">
          <Button className="w-full" size="lg" disabled={validate.pending || !summary.trim()} onClick={submit}>
            {validate.pending ? <Spinner /> : sendEmail ? <Send /> : <Check />}
            {sendEmail ? "Valider et envoyer l'email" : "Valider le compte rendu"}
          </Button>
          {aiAvailable && (
            <Button className="w-full" variant="outline" disabled={regenerate.pending} onClick={() => regenerate.run(null)}>
              <RefreshCw /> Régénérer avec l&apos;IA
            </Button>
          )}
          <ConfirmButton title="Supprimer cette session ?" description="La transcription et le compte rendu non validé seront supprimés." destructive onConfirm={() => del.run()}>
            <Trash2 /> Supprimer
          </ConfirmButton>
        </section>
      </div>
    </div>
  );
}
