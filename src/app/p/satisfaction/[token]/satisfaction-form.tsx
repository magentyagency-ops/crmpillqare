"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { submitSatisfactionAction } from "@/actions/public";

const LABELS = ["", "Pas du tout satisfait", "Peu satisfait", "Moyennement satisfait", "Satisfait", "Très satisfait"];

export function SatisfactionForm({ token, initialScore }: { token: string; initialScore: number | null }) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">Merci beaucoup pour votre retour ! Il nous aide à améliorer PillQare.</p>;
  }
  const shown = hover ?? score ?? 0;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!score) return;
        setPending(true);
        const res = await submitSatisfactionAction(token, score, comment);
        setPending(false);
        if (res.ok) setDone(true);
        else setError(res.error);
      }}
    >
      <div className="flex justify-center gap-2" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onMouseEnter={() => setHover(n)} onClick={() => setScore(n)} aria-label={`${n} sur 5`}>
            <Star className={cn("size-10 transition-colors", n <= shown ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
          </button>
        ))}
      </div>
      <p className="h-5 text-sm font-medium">{LABELS[shown]}</p>
      <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={score && score <= 3 ? "Que pourrions-nous améliorer ? Nous vous recontactons rapidement." : "Un commentaire ? (facultatif)"} />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Button type="submit" size="lg" disabled={!score || pending}>
        {pending && <Spinner />} Envoyer mon avis
      </Button>
    </form>
  );
}
