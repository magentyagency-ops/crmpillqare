"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, AlertCircle, CheckCheck, ChevronDown, ChevronRight, Code2, Inbox, Paperclip, Plus, Reply, RotateCw, Send } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { EmailComposer } from "@/components/dialogs/email-composer";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { getEmailHtmlAction, markEmailHandledAction, retryEmailAction } from "@/actions/emails";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { stripQuotedReply } from "@/lib/email/text";
import type { EmailDirection, EmailStatus } from "@/generated/prisma/enums";

export type EmailItem = {
  id: string;
  threadKey: string;
  direction: EmailDirection;
  status: EmailStatus;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  textBody: string | null;
  snippet: string | null;
  sentAt: Date;
  isAutomated: boolean;
  handledAt: Date | null;
  error: string | null;
  attachments: unknown;
  user?: { firstName: string; lastName: string; color: string } | null;
};

function HtmlViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    getEmailHtmlAction(id).then(setHtml).catch(() => setHtml("<p>Impossible d'afficher cet email.</p>"));
  }, [id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Email original</DialogTitle>
        </DialogHeader>
        {html === null ? (
          <Spinner />
        ) : (
          <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank"><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937}</style>${html}`} className="h-full w-full rounded-md border bg-white" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Message({ m, onReply }: { m: EmailItem; onReply: (ai?: boolean) => void }) {
  const { integrations } = useAppData();
  const [full, setFull] = useState(false);
  const [html, setHtml] = useState(false);
  const retry = useAction(retryEmailAction);
  const text = full ? (m.textBody ?? "") : stripQuotedReply(m.textBody) || m.snippet || "";
  const attachments = Array.isArray(m.attachments) ? (m.attachments as { filename: string }[]) : [];
  const inbound = m.direction === "INBOUND";
  return (
    <div className={cn("rounded-lg border p-3", inbound ? "bg-emerald-50/40" : "bg-card")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{inbound ? m.fromName || m.fromEmail : m.user ? `${m.user.firstName} ${m.user.lastName}` : m.fromName || m.fromEmail}</span>
          <span className="text-muted-foreground"> → {m.toEmails.join(", ")}</span>
          {m.ccEmails.length > 0 && <span className="text-xs text-muted-foreground"> (cc {m.ccEmails.join(", ")})</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {m.isAutomated && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">automatique</span>}
          {m.status === "FAILED" && (
            <span className="inline-flex items-center gap-1 font-medium text-rose-600">
              <AlertCircle className="size-3.5" /> Échec
            </span>
          )}
          <time title={formatDateTime(m.sentAt)}>{formatRelative(m.sentAt)}</time>
        </div>
      </div>
      {m.status === "FAILED" && m.error && <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{m.error}</div>}
      <div className="mt-2 text-sm whitespace-pre-line text-foreground/90">{text}</div>
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
              <Paperclip className="size-3" /> {a.filename}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {inbound && (
          <Button size="xs" variant="outline" onClick={() => onReply()}>
            <Reply /> Répondre
          </Button>
        )}
        {inbound && integrations.ai && (
          <Button size="xs" variant="outline" className="border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800" onClick={() => onReply(true)}>
            <Sparkles /> Réponse IA
          </Button>
        )}
        {m.textBody && m.textBody !== text && !full && (
          <Button size="xs" variant="ghost" onClick={() => setFull(true)}>
            Afficher tout le texte
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={() => setHtml(true)}>
          <Code2 /> Original
        </Button>
        {m.status === "FAILED" && m.direction === "OUTBOUND" && (
          <Button size="xs" variant="outline" disabled={retry.pending} onClick={() => retry.run(m.id)}>
            <RotateCw /> Renvoyer
          </Button>
        )}
      </div>
      {html && <HtmlViewer id={m.id} onClose={() => setHtml(false)} />}
    </div>
  );
}

/** Conversations email d'un contact / dossier, regroupées par fil. */
export function EmailThreads({ emails, contact, dealId }: { emails: EmailItem[]; contact: { id: string; name: string; email: string | null }; dealId?: string | null }) {
  const threads = useMemo(() => {
    const map = new Map<string, EmailItem[]>();
    for (const e of emails) map.set(e.threadKey, [...(map.get(e.threadKey) ?? []), e]);
    return [...map.values()]
      .map((list) => list.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()))
      .sort((a, b) => b[b.length - 1]!.sentAt.getTime() - a[a.length - 1]!.sentAt.getTime());
  }, [emails]);
  const [openKey, setOpenKey] = useState<string | null>(threads[0]?.[0]?.threadKey ?? null);
  const [composer, setComposer] = useState<{ replyTo?: { id: string; subject: string }; ai?: boolean } | null>(null);
  const handled = useAction(markEmailHandledAction);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!contact.email} onClick={() => setComposer({})}>
          <Plus /> Nouvel email
        </Button>
      </div>
      {threads.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun email échangé. Les emails envoyés et reçus apparaissent ici automatiquement.</p>}
      {threads.map((list) => {
        const last = list[list.length - 1]!;
        const key = last.threadKey;
        const pending = list.some((m) => m.direction === "INBOUND" && !m.handledAt);
        const isOpen = openKey === key;
        const lastInbound = [...list].reverse().find((m) => m.direction === "INBOUND");
        return (
          <div key={key} className={cn("rounded-lg surface", pending && "ring-amber-300")}>
            <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50" onClick={() => setOpenKey(isOpen ? null : key)}>
              {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
              {last.direction === "INBOUND" ? <Inbox className="size-4 shrink-0 text-emerald-600" /> : <Send className="size-4 shrink-0 text-indigo-600" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{list[0]!.subject}</span>
                <span className="block truncate text-xs text-muted-foreground">{last.snippet}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                {formatRelative(last.sentAt)}
                <br />
                {list.length} message{list.length > 1 ? "s" : ""}
              </span>
              {pending && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">À traiter</span>}
            </button>
            {isOpen && (
              <div className="space-y-2 border-t p-3">
                {list.map((m) => (
                  <Message key={m.id} m={m} onReply={(ai) => setComposer({ replyTo: { id: m.id, subject: m.subject }, ai })} />
                ))}
                <div className="flex flex-wrap gap-2 pt-1">
                  {lastInbound && (
                    <Button size="sm" onClick={() => setComposer({ replyTo: { id: lastInbound.id, subject: lastInbound.subject } })}>
                      <Reply /> Répondre
                    </Button>
                  )}
                  {pending && (
                    <Button size="sm" variant="outline" disabled={handled.pending} onClick={() => handled.run(lastInbound!.id, true)}>
                      <CheckCheck /> Marquer comme traité
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {composer && (
        <EmailComposer
          open
          onOpenChange={(o) => !o && setComposer(null)}
          to={contact.email}
          contactId={contact.id}
          contactName={contact.name}
          dealId={dealId}
          replyTo={composer.replyTo ?? null}
          aiReply={composer.ai}
        />
      )}
    </div>
  );
}
