import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, FileText, FlaskConical, Mail, MapPin, Phone, ShoppingBag, Sparkles, Star } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { findPotentialDuplicates } from "@/lib/contacts";
import { contactDisplayName, AI_STATUS_LABELS, MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, formatRelative } from "@/lib/dates";
import { formatEUR } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { renderTemplate } from "@/lib/email/render";
import { ContactStatusBadge, KeyValue, PageHeader, QuoteStatusBadge, SectionCard, SegmentBadge, StageBadge, TrialStatusBadge, UserAvatar } from "@/components/common/ui-bits";
import { TabLinks } from "@/components/common/filters";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { NoteComposer } from "@/components/timeline/note-composer";
import { RecordActions } from "@/components/records/record-actions";
import { TaskRow } from "@/components/tasks/task-row";
import { SequencePanel, type EnrollmentView } from "@/components/sequences/sequence-panel";
import { EmailThreads } from "@/components/emails/email-threads";
import { ContactHeaderActions, MergeButton, NewDealForContact } from "./contact-client";
import { AiInsights } from "@/components/ai/ai-insights";
import { llmAvailable } from "@/lib/ai/llm";

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const aiReady = llmAvailable();
  const { id } = await params;
  const { tab = "activite" } = await searchParams;
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      company: true,
      segment: true,
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      deals: { orderBy: { updatedAt: "desc" }, include: { owner: { select: { firstName: true, lastName: true, color: true } } } },
      tasks: {
        where: { status: "OPEN" },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, deal: { select: { id: true, title: true } } },
      },
      meetings: { orderBy: { startAt: "desc" }, take: 20 },
      quotes: { orderBy: { createdAt: "desc" } },
      trials: { orderBy: { createdAt: "desc" } },
      orders: { orderBy: { processedAt: "desc" }, include: { items: true } },
      aiSessions: { orderBy: { createdAt: "desc" }, take: 20 },
      enrollments: {
        orderBy: { createdAt: "desc" },
        include: { sequence: { select: { name: true } }, runs: { orderBy: { position: "asc" }, include: { step: { select: { subject: true, taskTitle: true } } } } },
      },
      formSubmissions: { orderBy: { createdAt: "desc" }, take: 5, include: { form: { select: { name: true } } } },
    },
  });
  if (!contact) notFound();
  if (!(await canView(await requireUser(), [contact.ownerId, ...contact.deals.map((d) => d.ownerId)]))) notFound();

  const name = contactDisplayName(contact);
  const [activities, emails, duplicates] = await Promise.all([
    db.activity.findMany({ where: { contactId: id }, orderBy: { occurredAt: "desc" }, take: 300, include: timelineInclude }),
    db.emailMessage.findMany({ where: { contactId: id }, orderBy: { sentAt: "desc" }, take: 200, include: { user: { select: { firstName: true, lastName: true, color: true } } } }),
    findPotentialDuplicates(id),
  ]);
  const openDeal = contact.deals.find((d) => d.stage !== "WON" && d.stage !== "LOST" && !d.archivedAt);
  const pendingReplies = emails.filter((e) => e.direction === "INBOUND" && !e.handledAt).length;
  const enrollments: EnrollmentView[] = contact.enrollments.map((e) => ({
    id: e.id,
    status: e.status,
    stopReason: e.stopReason,
    startedAt: e.startedAt,
    sequence: e.sequence,
    runs: e.runs.map((r) => ({
      id: r.id,
      position: r.position,
      type: r.type,
      status: r.status,
      scheduledAt: r.scheduledAt,
      executedAt: r.executedAt,
      repliedAt: r.repliedAt,
      label: r.type === "EMAIL" ? (r.subjectOverride ?? r.step.subject) || "Relance (réponse dans le fil)" : renderTemplate(r.step.taskTitle ?? "Appel", { contact: { fullName: name }, company: { name: contact.company?.name ?? "" } }),
    })),
  }));

  const tabs = [
    { value: "activite", label: "Activité", count: activities.length },
    { value: "emails", label: "Emails", count: emails.length, tone: pendingReplies ? ("warning" as const) : undefined },
    { value: "taches", label: "Tâches", count: contact.tasks.length },
    { value: "rdv", label: "RDV & comptes rendus", count: contact.meetings.length + contact.aiSessions.length },
    { value: "ventes", label: "Devis, essais, commandes", count: contact.quotes.length + contact.trials.length + contact.orders.length },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/contacts", label: "Contacts" }}
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ContactStatusBadge status={contact.status} />
            <span className="text-xs">{contact.kind === "B2B" ? "Professionnel" : "Particulier"}</span>
            <SegmentBadge segment={contact.segment} />
            {contact.jobTitle && <span>{contact.jobTitle}</span>}
            {contact.company && (
              <Link href={`/organisations/${contact.company.id}`} className="font-medium hover:underline">
                {contact.company.name}
              </Link>
            )}
            {contact.doNotContact && <span className="rounded bg-rose-100 px-1.5 text-xs font-medium text-rose-700">Ne pas contacter</span>}
            {contact.archivedAt && <span className="rounded bg-slate-200 px-1.5 text-xs">Archivé</span>}
          </span>
        }
        actions={
          <ContactHeaderActions
            archived={Boolean(contact.archivedAt)}
            doNotContact={contact.doNotContact}
            value={{
              id: contact.id,
              kind: contact.kind,
              status: contact.status,
              civility: contact.civility ?? "",
              firstName: contact.firstName ?? "",
              lastName: contact.lastName ?? "",
              email: contact.email ?? "",
              phone: contact.phone ?? "",
              jobTitle: contact.jobTitle ?? "",
              company: contact.company ? { id: contact.company.id, label: contact.company.name } : null,
              companyName: "",
              segmentId: contact.segmentId ?? "",
              ownerId: contact.ownerId ?? user.id,
              source: contact.source,
              address: contact.address ?? "",
              postalCode: contact.postalCode ?? "",
              city: contact.city ?? "",
              notes: contact.notes ?? "",
              tags: contact.tags.join(", "),
            }}
          />
        }
      />
      <div className="mb-5">
        <RecordActions contact={{ id: contact.id, name, email: contact.email, phone: contact.phone }} dealId={openDeal?.id} companyId={contact.companyId} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <TabLinks param="tab" tabs={tabs} />
          {tab === "activite" && (
            <SectionCard>
              <NoteComposer contactId={contact.id} dealId={openDeal?.id} />
              <ActivityTimeline items={activities} />
            </SectionCard>
          )}
          {tab === "emails" && (
            <SectionCard>
              <EmailThreads emails={emails} contact={{ id: contact.id, name, email: contact.email }} dealId={openDeal?.id} />
            </SectionCard>
          )}
          {tab === "taches" && (
            <SectionCard>
              {contact.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune tâche ouverte.</p>
              ) : (
                <div className="-mx-2 divide-y">
                  {contact.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} showContact={false} tz={user.timezone} />
                  ))}
                </div>
              )}
            </SectionCard>
          )}
          {tab === "rdv" && (
            <>
              <SectionCard title="Comptes rendus (assistant IA)">
                {contact.aiSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun compte rendu.</p>
                ) : (
                  <ul className="divide-y">
                    {contact.aiSessions.map((s) => (
                      <li key={s.id} className="py-2">
                        <Link href={`/assistant/${s.id}`} className="flex items-center gap-2 text-sm hover:underline">
                          <Sparkles className="size-4 text-fuchsia-600" />
                          <span className="flex-1">{s.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {AI_STATUS_LABELS[s.status]} · {formatDate(s.createdAt)}
                          </span>
                        </Link>
                        {s.summary && <p className="mt-1 line-clamp-2 pl-6 text-xs text-muted-foreground">{s.summary}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SectionCard title="Rendez-vous">
                {contact.meetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun rendez-vous.</p>
                ) : (
                  <ul className="divide-y">
                    {contact.meetings.map((m) => (
                      <li key={m.id} className="py-2">
                        <Link href={`/agenda/${m.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:underline">
                          <span className="font-medium">{formatDateTime(m.startAt, user.timezone)}</span>
                          <span className="flex-1 truncate">{m.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {MEETING_TYPE_LABELS[m.type]} · {MEETING_STATUS_LABELS[m.status]}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
          {tab === "ventes" && (
            <>
              <SectionCard title="Devis">
                {contact.quotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun devis.</p>
                ) : (
                  <ul className="divide-y">
                    {contact.quotes.map((q) => (
                      <li key={q.id} className="py-2">
                        <Link href={`/devis/${q.id}`} className="flex items-center gap-2 text-sm hover:underline">
                          <FileText className="size-4" />
                          <span className="flex-1">
                            {q.number} {q.title ? `— ${q.title}` : ""}
                          </span>
                          <span className="tabular-nums">{formatEUR(q.totalHT)} HT</span>
                          <QuoteStatusBadge status={q.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SectionCard title="Essais / pilotes">
                {contact.trials.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun essai.</p>
                ) : (
                  <ul className="divide-y">
                    {contact.trials.map((t) => (
                      <li key={t.id} className="py-2">
                        <Link href={`/essais/${t.id}`} className="flex items-center gap-2 text-sm hover:underline">
                          <FlaskConical className="size-4" />
                          <span className="flex-1">{t.title}</span>
                          <TrialStatusBadge status={t.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SectionCard title="Commandes (boutique)">
                {contact.orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune commande.</p>
                ) : (
                  <ul className="divide-y">
                    {contact.orders.map((o) => (
                      <li key={o.id} className="py-2">
                        <Link href={`/commandes/${o.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:underline">
                          <ShoppingBag className="size-4" />
                          <span className="font-medium">{o.number}</span>
                          <span className="flex-1 truncate text-muted-foreground">{o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</span>
                          <span className="tabular-nums">{formatEUR(o.total)}</span>
                          {o.satisfactionScore && (
                            <span className="inline-flex items-center gap-0.5 text-amber-600">
                              <Star className="size-3.5 fill-current" /> {o.satisfactionScore}/5
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </div>

        <div className="space-y-6">
          {aiReady && (
            <SectionCard title="✨ Analyse IA">
              <AiInsights contactId={contact.id} dealId={openDeal?.id ?? null} />
            </SectionCard>
          )}
          <SectionCard title="Coordonnées">
            <div className="space-y-1.5 text-sm">
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-primary hover:underline">
                  <Phone className="size-3.5" /> {formatPhone(contact.phone)}
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 break-all text-primary hover:underline">
                  <Mail className="size-3.5 shrink-0" /> {contact.email}
                </a>
              )}
              {contact.company && (
                <Link href={`/organisations/${contact.company.id}`} className="flex items-center gap-2 hover:underline">
                  <Building2 className="size-3.5" /> {contact.company.name}
                </Link>
              )}
              {(contact.address || contact.city) && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span>{[contact.address, [contact.postalCode, contact.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>
            <dl className="mt-3 border-t pt-2">
              <KeyValue label="Commercial">
                {contact.owner ? (
                  <span className="flex items-center gap-1.5">
                    <UserAvatar user={contact.owner} size="xs" /> {contact.owner.firstName} {contact.owner.lastName}
                  </span>
                ) : null}
              </KeyValue>
              <KeyValue label="Origine">
                {SOURCE_LABELS[contact.source]}
                {contact.sourceDetail ? ` — ${contact.sourceDetail}` : ""}
              </KeyValue>
              <KeyValue label="Créé">{formatDate(contact.createdAt)}</KeyValue>
              <KeyValue label="Dernier contact">{contact.lastContactedAt ? formatRelative(contact.lastContactedAt) : null}</KeyValue>
              <KeyValue label="Dernière réponse">{contact.lastInboundAt ? formatRelative(contact.lastInboundAt) : null}</KeyValue>
              {contact.tags.length > 0 && (
                <KeyValue label="Étiquettes">
                  <span className="flex flex-wrap gap-1">
                    {contact.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </span>
                </KeyValue>
              )}
            </dl>
            {contact.notes && <p className="mt-2 rounded-md bg-muted p-2 text-sm whitespace-pre-line">{contact.notes}</p>}
          </SectionCard>

          <SectionCard title="Dossiers" actions={<NewDealForContact contactId={contact.id} label={name} />}>
            {contact.deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun dossier commercial.</p>
            ) : (
              <ul className="space-y-2">
                {contact.deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/pipeline/${d.id}`} className="block rounded-md p-2 hover:bg-accent">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        <StageBadge stage={d.stage} />
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserAvatar user={d.owner} size="xs" /> {d.owner.firstName}
                        </span>
                        {d.amount && <span>{formatEUR(d.amount)} HT</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Relances automatiques">
            <SequencePanel enrollments={enrollments} contactId={contact.id} dealId={openDeal?.id} tz={user.timezone} />
          </SectionCard>

          {contact.formSubmissions.length > 0 && (
            <SectionCard title="Demandes via le site">
              <ul className="space-y-2 text-sm">
                {contact.formSubmissions.map((s) => (
                  <li key={s.id}>
                    <div className="font-medium">{s.form.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(s.createdAt, user.timezone)}
                      {s.utmSource ? ` · source ${s.utmSource}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {duplicates.length > 0 && (
            <SectionCard title="Doublons possibles" description="Même téléphone ou même nom dans la même organisation.">
              <ul className="space-y-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/contacts/${d.id}`} className="min-w-0 truncate hover:underline">
                      {contactDisplayName(d)} {d.company ? `· ${d.company.name}` : ""}
                      <span className="block truncate text-xs text-muted-foreground">{d.email ?? d.phone}</span>
                    </Link>
                    <MergeButton primaryId={contact.id} duplicateId={d.id} label={contactDisplayName(d)} />
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}
