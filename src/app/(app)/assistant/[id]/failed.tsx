"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, PenLine, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmButton } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { deleteAiSessionAction, regenerateReportAction, saveManualReportAction } from "@/actions/assistant";

/** Analyse en échec : relancer l'IA (éventuellement après correction de la transcription) ou rédiger manuellement. */
export function FailedSession({ sessionId, error, transcript, aiAvailable }: { sessionId: string; error: string | null; transcript: string; aiAvailable: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(transcript);
  const retry = useAction(() => regenerateReportAction(sessionId, text));
  const manual = useAction(() => saveManualReportAction(sessionId, text.slice(0, 4000) || "Compte rendu à compléter."));
  const del = useAction(() => deleteAiSessionAction(sessionId), { onSuccess: () => router.push("/assistant"), refresh: false });
  return (
    <div className="space-y-4 rounded-xl bg-card p-6 surface">
      <div className="flex items-start gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-semibold">Le compte rendu n&apos;a pas pu être généré.</div>
          <div>{error ?? "Erreur inconnue."}</div>
        </div>
      </div>
      <div className="text-sm font-medium">Transcription / notes</div>
      <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Complétez ou collez la transcription, puis relancez l'analyse." />
      <div className="flex flex-wrap gap-2">
        {aiAvailable && (
          <Button disabled={retry.pending || text.trim().length < 40} onClick={() => retry.run()}>
            {retry.pending ? <Spinner /> : <Sparkles />} Relancer l&apos;analyse IA
          </Button>
        )}
        <Button variant="outline" disabled={manual.pending} onClick={() => manual.run()}>
          <PenLine /> Rédiger le compte rendu manuellement
        </Button>
        <ConfirmButton title="Supprimer cette session ?" destructive onConfirm={() => del.run()}>
          <Trash2 /> Supprimer
        </ConfirmButton>
      </div>
    </div>
  );
}
