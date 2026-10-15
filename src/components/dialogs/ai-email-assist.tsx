"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { aiDraftEmailAction } from "@/actions/ai";
import { reloadIfStale } from "@/lib/client/recovery";

type Draft = { subject: string; body: string };
type Rewrite = "shorter" | "warmer" | "formal" | "persuasive" | "fix";

const IDEAS = ["Relancer sur le devis", "Proposer un rendez-vous", "Remercier après notre échange", "Envoyer la documentation", "Reprendre contact"];
const REWRITES: { value: Rewrite; label: string }[] = [
  { value: "shorter", label: "Plus court" },
  { value: "warmer", label: "Plus chaleureux" },
  { value: "formal", label: "Plus formel" },
  { value: "persuasive", label: "Plus convaincant" },
  { value: "fix", label: "Corriger" },
];

/** Rédaction assistée dans l'éditeur d'email : à partir d'une consigne, d'un brouillon ou d'un email reçu. */
export function AiEmailAssist({
  contactId,
  dealId,
  replyToId,
  current,
  onApply,
  autoReply,
}: {
  contactId?: string | null;
  dealId?: string | null;
  replyToId?: string | null;
  current: Draft;
  onApply: (d: Draft) => void;
  /** Rédige la réponse dès l'ouverture (bouton « Réponse IA ») */
  autoReply?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Draft | null>(null);
  const hasDraft = Boolean(current.body.trim());

  const run = async (key: string, opts: { instruction?: string; rewrite?: Rewrite; reply?: boolean }) => {
    setPending(key);
    try {
      const res = await aiDraftEmailAction({
        contactId,
        dealId,
        instruction: opts.instruction ?? null,
        rewrite: opts.rewrite ?? null,
        // Le brouillon en cours est retravaillé (retouche ou consigne), sauf pour une réponse proposée de zéro
        draft: hasDraft && !opts.reply ? current : null,
        replyToEmailId: opts.reply ? replyToId : null,
      });
      if (res.ok && res.data) {
        setPrevious(current);
        onApply(res.data);
      } else if (!res.ok) toast.error(res.error);
    } catch (error) {
      if (!reloadIfStale(error)) toast.error("L'IA n'a pas pu répondre : réessayez.");
    } finally {
      setPending(null);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (!autoReply || !replyToId || started.current) return;
    started.current = true;
    void run("reply", { reply: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule proposition automatique à l'ouverture
  }, [autoReply, replyToId]);

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
      <div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <Sparkles className="size-4" /> Rédiger avec l&apos;IA
        </div>
        <p className="text-xs text-violet-700/80">
          {pending === "reply" ? "L'IA rédige une proposition de réponse…" : contactId || dealId ? "Personnalisé avec la fiche, le dossier et les derniers échanges." : "Personnalisé d'après l'email reçu."}
        </p>
      </div>
      {replyToId && (
        <Button type="button" size="sm" className="w-full bg-violet-600 hover:bg-violet-700" disabled={Boolean(pending)} onClick={() => run("reply", { reply: true, instruction: instruction || undefined })}>
          {pending === "reply" ? <Spinner /> : <Wand2 />} Proposer une réponse
        </Button>
      )}
      {/* Pas de <form> : ce bloc est déjà dans le formulaire d'envoi de l'email */}
      <div className="flex gap-2">
        <Input
          className="h-9 bg-background"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={hasDraft ? "Ex. : ajoute que la livraison prend 10 jours" : "Ex. : relancer sur le devis et proposer un appel jeudi"}
          aria-label="Consigne pour l'IA"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (instruction.trim() && !pending) run("write", { instruction });
            }
          }}
        />
        <Button type="button" size="sm" onClick={() => run("write", { instruction })} variant="outline" className="h-9 shrink-0" disabled={Boolean(pending) || !instruction.trim()}>
          {pending === "write" ? <Spinner /> : <Sparkles />} {hasDraft ? "Appliquer" : "Rédiger"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!hasDraft &&
          IDEAS.map((idea) => (
            <button key={idea} type="button" disabled={Boolean(pending)} onClick={() => run(idea, { instruction: idea })} className="rounded-full border border-violet-200 bg-background px-2.5 py-0.5 text-xs text-violet-800 hover:bg-violet-100 disabled:opacity-50">
              {pending === idea ? "…" : idea}
            </button>
          ))}
        {hasDraft &&
          REWRITES.map((r) => (
            <button key={r.value} type="button" disabled={Boolean(pending)} onClick={() => run(r.value, { rewrite: r.value })} className="rounded-full border border-violet-200 bg-background px-2.5 py-0.5 text-xs text-violet-800 hover:bg-violet-100 disabled:opacity-50">
              {pending === r.value ? "…" : r.label}
            </button>
          ))}
        {previous && (
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => {
              onApply(previous);
              setPrevious(null);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="size-3" /> Annuler
          </button>
        )}
      </div>
    </div>
  );
}
