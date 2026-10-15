"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, History, Plus, Send, ShieldQuestion, Sparkles, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { agentConfirmAction, agentDeleteAction, agentGetAction, agentListAction, agentSendAction, type AgentView } from "@/actions/agent";
import type { DisplayItem } from "@/lib/agent/runner";
import { reloadIfStale } from "@/lib/client/recovery";

const STORAGE_KEY = "pq:copilot";
const SUGGESTIONS = [
  "Qu'est-ce que j'ai à faire aujourd'hui ?",
  "Quels dossiers sont bloqués et que faire pour chacun ?",
  "Crée une relance de prospection pour contact@exemple.fr, un email par jour pendant 3 jours",
  "Résume-moi où en est ce contact et propose-moi la prochaine action",
];

/** Rendu Markdown minimal : liens internes, gras, listes, retours à la ligne. */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const content = line.replace(/^\s*[-•*]\s+/, "");
        const parts: React.ReactNode[] = [];
        const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content))) {
          if (m.index > last) parts.push(content.slice(last, m.index));
          if (m[1] && m[2]) {
            const href = m[2];
            parts.push(
              href.startsWith("/") ? (
                <Link key={m.index} href={href} className="font-medium text-primary underline underline-offset-2">
                  {m[1]}
                </Link>
              ) : (
                <a key={m.index} href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                  {m[1]}
                </a>
              ),
            );
          } else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>);
          last = m.index + m[0].length;
        }
        if (last < content.length) parts.push(content.slice(last));
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <div key={i} className={bullet ? "flex gap-1.5 pl-1" : undefined}>
            {bullet && <span className="text-muted-foreground">•</span>}
            <span>{parts}</span>
          </div>
        );
      })}
    </div>
  );
}

function Item({ item, last, busy, onConfirm }: { item: DisplayItem; last: boolean; busy: boolean; onConfirm: (approve: boolean) => void }) {
  if (item.kind === "user") {
    return <div className="ml-10 rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{item.text}</div>;
  }
  if (item.kind === "assistant") {
    return (
      <div className="mr-6 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
        <RichText text={item.text} />
      </div>
    );
  }
  if (item.kind === "action") {
    return (
      <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs", item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800")}>
        {item.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
        <span className="flex-1">{item.text}</span>
        {item.link && (
          <Link href={item.link} className="shrink-0 font-medium underline underline-offset-2">
            Voir
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-amber-900">
        <ShieldQuestion className="size-4" /> {item.status === "pending" ? "Confirmation nécessaire" : item.status === "approved" ? "Confirmé" : "Annulé"}
      </div>
      <ul className="space-y-1">
        {item.items.map((i) => (
          <li key={i.id} className="flex gap-1.5">
            <span className="text-amber-700">→</span>
            <span className="max-h-64 overflow-y-auto whitespace-pre-wrap">{i.text}</span>
          </li>
        ))}
      </ul>
      {item.status === "pending" && last && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => onConfirm(true)}>
            <Check /> Confirmer
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onConfirm(false)}>
            <X /> Annuler
          </Button>
        </div>
      )}
    </div>
  );
}

/** Copilote IA : pilote le CRM en langage naturel, disponible sur toutes les pages (⌘J). */
export function Copilot() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conv, setConv] = useState<AgentView | null>(null);
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Raccourci clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conv, optimistic, busy]);

  const openPanel = async (o: boolean) => {
    setOpen(o);
    if (!o || conv) return;
    let id: string | null = null;
    try {
      id = localStorage.getItem(STORAGE_KEY);
    } catch {
      // stockage indisponible
    }
    if (id) {
      const c = await agentGetAction(id).catch(() => null);
      if (c) setConv(c);
    }
  };

  const apply = (res: Awaited<ReturnType<typeof agentSendAction>>) => {
    if (res.ok && res.data) {
      setConv(res.data);
      try {
        localStorage.setItem(STORAGE_KEY, res.data.id);
      } catch {
        // stockage indisponible
      }
      router.refresh();
    } else if (!res.ok) toast.error(res.error);
  };

  const send = async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setOptimistic(m);
    setText("");
    try {
      apply(await agentSendAction(conv?.id ?? null, m, pathname));
    } catch (error) {
      if (!reloadIfStale(error)) toast.error("Le copilote n'a pas pu répondre : réessayez.");
      setText(m);
    } finally {
      setOptimistic(null);
      setBusy(false);
    }
  };

  const confirm = async (approve: boolean) => {
    if (!conv) return;
    setBusy(true);
    try {
      apply(await agentConfirmAction(conv.id, approve, pathname));
    } catch (error) {
      if (!reloadIfStale(error)) toast.error("Le copilote n'a pas pu répondre : réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setConv(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // stockage indisponible
    }
  };

  const items = conv?.display ?? [];
  return (
    <>
      <button
        type="button"
        data-tour="copilot"
        onClick={() => openPanel(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl focus-visible:ring-4 focus-visible:ring-violet-300 focus-visible:outline-none"
        aria-label="Ouvrir le copilote IA"
      >
        <Sparkles className="size-4" /> Copilote
        <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] sm:inline">⌘J</kbd>
      </button>
      <Sheet open={open} onOpenChange={openPanel}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <div className="flex items-center gap-2 pr-8">
              <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">{conv?.title ?? "Copilote"}</SheetTitle>
                <SheetDescription className="text-xs">Demandez, il le fait dans le CRM. Les envois sont confirmés avant de partir.</SheetDescription>
              </div>
              <DropdownMenu
                onOpenChange={(o) => {
                  if (o) agentListAction().then(setHistory).catch(() => undefined);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Conversations précédentes">
                    <History />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-xs">Conversations</DropdownMenuLabel>
                  {history.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Aucune conversation</div>}
                  {history.map((h) => (
                    <DropdownMenuItem key={h.id} onSelect={() => agentGetAction(h.id).then((c) => c && setConv(c))} className="flex justify-between gap-2">
                      <span className="truncate">{h.title}</span>
                      <button
                        type="button"
                        aria-label="Supprimer la conversation"
                        className="text-muted-foreground hover:text-rose-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          agentDeleteAction(h.id).then(() => {
                            setHistory((x) => x.filter((y) => y.id !== h.id));
                            if (conv?.id === h.id) reset();
                          });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="icon-sm" variant="ghost" aria-label="Nouvelle conversation" onClick={reset} disabled={busy}>
                <Plus />
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
            {items.length === 0 && !optimistic && (
              <div className="space-y-3 pt-6 text-center">
                <p className="text-sm text-muted-foreground">Demandez n&apos;importe quelle action ou information sur vos contacts, dossiers, relances, devis, RDV et tâches.</p>
                <div className="space-y-1.5 text-left">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => setText(s)} className="block w-full rounded-lg border px-3 py-2 text-left text-xs hover:bg-accent">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((item, i) => (
              <Fragment key={i}>
                <Item item={item} last={i === items.length - 1} busy={busy} onConfirm={confirm} />
              </Fragment>
            ))}
            {optimistic && <div className="ml-10 rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{optimistic}</div>}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3.5" /> Le copilote travaille…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
              rows={2}
              placeholder={conv?.pending ? "Confirmez ou annulez l'action ci-dessus…" : "Ex. : crée une tâche pour rappeler la Pharmacie du Centre demain à 10 h"}
              className="max-h-40 min-h-11 resize-none"
              disabled={busy || Boolean(conv?.pending)}
              aria-label="Message au copilote"
            />
            <Button type="submit" size="icon" disabled={busy || !text.trim() || Boolean(conv?.pending)} aria-label="Envoyer">
              <Send />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
