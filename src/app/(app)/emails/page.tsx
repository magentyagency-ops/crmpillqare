import Link from "next/link";
import { AlertCircle, Inbox, Mail, Send } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { contactDisplayName } from "@/lib/labels";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { EmptyHint, PageHeader, SectionCard } from "@/components/common/ui-bits";
import { SearchFilter, TabLinks } from "@/components/common/filters";
import { EmailsToolbar, HandledButton, RetryButton } from "./emails-client";
import { allWords, contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Emails" };

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ vue?: string; q?: string; equipe?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.vue ?? "boite";
  const team = sp.equipe === "1" && isManager(user);
  // Les emails sans contact (messagerie personnelle) ne sont visibles que par leur destinataire, même en vue équipe
  const mine: Prisma.EmailMessageWhereInput = team
    ? { OR: [{ contactId: { not: null } }, { userId: user.id }] }
    : { OR: [{ userId: user.id }, { contact: { ownerId: user.id } }] };
  const search: Prisma.EmailMessageWhereInput = sp.q
    ? {
        OR: [
          allWords(sp.q, (w) => ({ subject: { contains: w, mode: "insensitive" as const } })),
          { fromEmail: { contains: sp.q.trim(), mode: "insensitive" } },
          { contact: contactSearchWhere(sp.q) },
        ],
      }
    : {};
  const views: Record<string, Prisma.EmailMessageWhereInput> = {
    boite: { direction: "INBOUND" },
    "a-traiter": { direction: "INBOUND", handledAt: null, contactId: { not: null } },
    recus: { direction: "INBOUND" },
    envoyes: { direction: "OUTBOUND", status: "SENT" },
    echecs: { direction: "OUTBOUND", status: "FAILED" },
  };
  const [emails, counts, mailboxes] = await Promise.all([
    db.emailMessage.findMany({
      where: { AND: [mine, search, views[view] ?? views.boite!] },
      orderBy: { sentAt: "desc" },
      take: 200,
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, user: { select: { firstName: true } } },
    }),
    Promise.all(["a-traiter", "echecs"].map((k) => db.emailMessage.count({ where: { AND: [mine, views[k]!] } }))),
    db.mailbox.findMany({ where: { userId: user.id }, select: { id: true, email: true, provider: true, status: true, lastSyncAt: true, lastError: true } }),
  ]);
  // Une ligne par fil de discussion
  const seen = new Set<string>();
  const rows = emails.filter((e) => {
    if (seen.has(e.threadKey)) return false;
    seen.add(e.threadKey);
    return true;
  });

  return (
    <>
      <PageHeader
        title="Emails"
        description="Tous vos emails, synchronisés depuis vos adresses professionnelles. Les échanges avec vos contacts sont rattachés à leur fiche."
        actions={<EmailsToolbar hasMailbox={mailboxes.length > 0} />}
      />
      <SectionCard className="mb-4" bodyClassName="py-3">
        {mailboxes.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <AlertCircle className="size-4 text-amber-600" />
            <span className="flex-1">
              {env.emailDelivery === "log"
                ? "Mode développement : les emails sont enregistrés dans le CRM sans être réellement envoyés. "
                : "Aucune boîte mail connectée : vous ne pouvez ni envoyer ni recevoir d'emails depuis le CRM. "}
            </span>
            <Link href="/parametres/integrations" className="font-medium text-primary hover:underline">
              Connecter mon adresse professionnelle
            </Link>
          </div>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {mailboxes.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${m.status === "ACTIVE" ? "bg-emerald-500" : m.status === "ERROR" ? "bg-rose-500" : "bg-slate-400"}`} />
                <span className="font-medium">{m.email}</span>
                <span className="text-xs text-muted-foreground">
                  {m.provider === "GOOGLE" ? "Gmail" : "IMAP/SMTP"} · {m.lastSyncAt ? `synchronisé ${formatRelative(m.lastSyncAt)}` : "jamais synchronisé"}
                </span>
                {m.status === "ERROR" && m.lastError && <span className="text-xs text-rose-600">{m.lastError.slice(0, 80)}</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="vue"
          tabs={[
            { value: "boite", label: "Boîte de réception" },
            { value: "a-traiter", label: "Réponses de contacts à traiter", count: counts[0], tone: "warning" },
            { value: "envoyes", label: "Envoyés" },
            { value: "echecs", label: "Échecs", count: counts[1], tone: "danger" },
          ]}
        />
        <SearchFilter placeholder="Objet, expéditeur, contact…" />
        {isManager(user) && (
          <Link href={team ? "/emails" : "/emails?equipe=1"} className="text-sm text-primary hover:underline">
            {team ? "Mes emails" : "Emails de toute l'équipe"}
          </Link>
        )}
      </div>
      <SectionCard bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyHint icon={Mail} title={view === "a-traiter" ? "Aucune réponse en attente 🎉" : "Aucun email"} />
        ) : (
          <ul className="divide-y">
            {rows.map((e) => (
              <li key={e.id} className="relative flex items-start gap-3 px-4 py-3 hover:bg-accent/40">
                {e.direction === "INBOUND" ? <Inbox className="mt-0.5 size-4 text-emerald-600" /> : <Send className="mt-0.5 size-4 text-indigo-600" />}
                {/* Toute la ligne ouvre l'email ; seul le nom du contact ouvre sa fiche */}
                <div className="min-w-0 flex-1">
                  <Link href={`/emails/${e.id}`} className="absolute inset-0" aria-label={`Ouvrir l'email ${e.subject}`} />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {e.contact ? (
                        <Link href={`/contacts/${e.contact.id}`} className="relative z-10 hover:text-primary hover:underline">
                          {contactDisplayName(e.contact)}
                        </Link>
                      ) : e.direction === "INBOUND" ? (
                        e.fromName || e.fromEmail
                      ) : (
                        e.toEmails.join(", ")
                      )}
                      {!e.contact && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">hors CRM</span>}
                      {e.contact?.company && <span className="font-normal text-muted-foreground"> · {e.contact.company.name}</span>}
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(e.sentAt, user.timezone)}>
                      {formatRelative(e.sentAt)}
                    </time>
                  </div>
                  <div className="truncate text-sm">{e.subject}</div>
                  {e.snippet && <div className="truncate text-xs text-muted-foreground">{e.snippet}</div>}
                  {e.status === "FAILED" && e.error && <div className="mt-0.5 text-xs text-rose-600">{e.error}</div>}
                </div>
                {view === "a-traiter" && (
                  <div className="relative z-10">
                    <HandledButton id={e.id} />
                  </div>
                )}
                {view === "echecs" && (
                  <div className="relative z-10">
                    <RetryButton id={e.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
