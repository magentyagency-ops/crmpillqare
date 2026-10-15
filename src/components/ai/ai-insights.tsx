"use client";

import { useState } from "react";
import { CalendarPlus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { aiAnalyzeAction } from "@/actions/ai";
import { createTaskAction } from "@/actions/tasks";
import type { ContactInsights } from "@/lib/ai/writer";
import { reloadIfStale } from "@/lib/client/recovery";
import { useAction } from "@/hooks/use-action";

const INTEREST: Record<ContactInsights["interest"], { label: string; cls: string }> = {
  fort: { label: "Intérêt fort", cls: "bg-emerald-100 text-emerald-800" },
  moyen: { label: "Intérêt moyen", cls: "bg-amber-100 text-amber-800" },
  faible: { label: "Intérêt faible", cls: "bg-rose-100 text-rose-700" },
  inconnu: { label: "Intérêt à qualifier", cls: "bg-muted text-muted-foreground" },
};

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{title}</div>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-violet-500">•</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Prochain jour ouvré, au format date (yyyy-MM-dd). */
function nextBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() + (d.getDay() === 5 ? 3 : d.getDay() === 6 ? 2 : 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Analyse IA de la relation : synthèse, intérêt, prochaine meilleure action (planifiable en un clic). */
export function AiInsights({ contactId, dealId }: { contactId?: string | null; dealId?: string | null }) {
  const [data, setData] = useState<ContactInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const plan = useAction(createTaskAction, { success: "Action ajoutée à vos tâches (prochain jour ouvré)" });

  const analyze = async () => {
    setLoading(true);
    try {
      const res = await aiAnalyzeAction({ contactId, dealId });
      if (res.ok && res.data) setData(res.data);
      else if (!res.ok) toast.error(res.error);
    } catch (error) {
      if (!reloadIfStale(error)) toast.error("L'IA n'a pas pu répondre : réessayez.");
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Synthèse de la relation, niveau d&apos;intérêt, prochaine meilleure action et arguments à utiliser.</p>
        <Button size="sm" variant="outline" className="w-full border-violet-200 text-violet-800 hover:bg-violet-50" disabled={loading} onClick={analyze}>
          {loading ? <Spinner /> : <Sparkles />} {loading ? "Analyse en cours…" : "Analyser avec l'IA"}
        </Button>
      </div>
    );
  }
  const interest = INTEREST[data.interest];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${interest.cls}`}>{interest.label}</span>
        <button type="button" onClick={analyze} disabled={loading} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Actualiser
        </button>
      </div>
      <p className="text-sm">{data.summary}</p>
      <div className="rounded-lg bg-violet-50 p-3">
        <div className="text-xs font-semibold text-violet-900">Prochaine meilleure action</div>
        <p className="mt-0.5 text-sm font-medium">{data.nextBestAction}</p>
        <p className="text-xs text-muted-foreground">{data.timing}</p>
        <Button
          size="xs"
          variant="outline"
          className="mt-2"
          disabled={plan.pending}
          onClick={() =>
            plan.run({
              title: data.nextBestAction.slice(0, 190),
              description: `Suggestion de l'IA — ${data.timing}`,
              type: "TODO",
              dueAt: nextBusinessDay(),
              contactId: contactId ?? null,
              dealId: dealId ?? null,
            })
          }
        >
          <CalendarPlus /> Planifier cette action
        </Button>
      </div>
      <List title="Arguments à utiliser" items={data.talkingPoints} />
      <List title="Points de vigilance" items={data.risks} />
      <List title="À obtenir" items={data.missingInfo} />
      <p className="text-[11px] text-muted-foreground">Analyse générée par l&apos;IA à partir de la fiche et des échanges : à vérifier.</p>
    </div>
  );
}
