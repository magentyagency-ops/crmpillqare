import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, FileText, FlaskConical, Mail, Phone, Video, CalendarDays } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { toNumber, formatEUR } from "@/lib/format";
import { formatDate, formatDateTime, toDateInputValue } from "@/lib/dates";
import { contactDisplayName, MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, SOURCE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/normalize";
import { KeyValue, PageHeader, QuoteStatusBadge, SectionCard, SegmentBadge, StageBadge, TrialStatusBadge, UserAvatar } from "@/components/common/ui-bits";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { NoteComposer } from "@/components/timeline/note-composer";
import { RecordActions } from "@/components/records/record-actions";
import { TaskRow } from "@/components/tasks/task-row";
import { SequencePanel, type EnrollmentView } from "@/components/sequences/sequence-panel";
import { DealEditButtons, NextActionBanner, StageStepper } from "./deal-client";
import { renderTemplate } from "@/lib/email/render";
import { EmailThreads } from "@/components/emails/email-threads";
import { AiInsights } from "@/components/ai/ai-insights";
import { llmAvailable } from "@/lib/ai/llm";

function isOverdue(at: Date | null) {
  return Boolean(at && at.getTime() < Date.now() - 3600_000);
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const aiReady = llmAvailable();
  const { id } = await params;
  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      contact: { include: { company: true } },
      company: true,
      owner: { select: { id: true, firstName: true, lastName: true, color: true } },
      segment: true,
      lostReason: true,
      stageHistory: { orderBy: { createdAt: "desc" }, include: { user: { select: { firstName: true } } } },
      tasks: {
        where: { status: "OPEN" },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, deal: { select: { id: true, title: true } } },
      },
      meetings: { orderBy: { startAt: "desc" }, take: 10 },
      quotes: { orderBy: { createdAt: "desc" } },
      trials: { orderBy: { createdAt: "desc" } },
      enrollments: {
        orderBy: { createdAt: "desc" },
        include: { sequence: { select: { name: true } }, runs: { orderBy: { position: "asc" }, include: { step: { select: { subject: true, taskTitle: true } } } } },
      },
    },
  });
  if (!deal) notFound();
  if (!(await canView(await requireUser(), [deal.ownerId, deal.contact.ownerId]))) notFound();

  const [activities, emails] = await Promise.all([
    db.activity.findMany({ where: { dealId: id }, orderBy: { occurredAt: "desc" }, take: 200, include: timelineInclude }),
    db.emailMessage.findMany({ where: { dealId: id }, orderBy: { sentAt: "desc" }, take: 100, include: { user: { select: { firstName: true, lastName: true, color: true } } } }),
  ]);

  const contactName = contactDisplayName(deal.contact);
  const company = deal.company ?? deal.contact.company;
  const closed = deal.stage === "WON" || deal.stage === "LOST";
  const enrollments: EnrollmentView[] = deal.enrollments.map((e) => ({
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
      label: r.type === "EMAIL" ? (r.subjectOverride ?? r.step.subject) || "Relance (réponse dans le fil)" : renderTemplate(r.step.taskTitle ?? "Appel", { contact: { fullName: contactName }, company: { name: company?.name ?? "" } }),
    })),
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/pipeline", label: "Pipeline" }}
        title={deal.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StageBadge stage={deal.stage} />
            {deal.amount && <span className="font-semibold text-brand-navy">{formatEUR(deal.amount)} HT</span>}
            <span className="inline-flex items-center gap-1">
              <UserAvatar user={deal.owner} size="xs" /> {deal.owner.firstName} {deal.owner.lastName}
            </span>
            {deal.archivedAt && <span className="rounded bg-slate-200 px-1.5 text-xs">Archivé</span>}
          </span>
        }
        actions={
          <DealEditButtons
            archived={Boolean(deal.archivedAt)}
            initial={{
              id: deal.id,
              title: deal.title,
              contact: null,
              ownerId: deal.ownerId,
              stage: deal.stage,
              amount: deal.amount ? String(toNumber(deal.amount)) : "",
              quantity: deal.quantity ? String(deal.quantity) : "",
              expectedCloseAt: toDateInputValue(deal.expectedCloseAt, user.timezone),
              source: deal.source,
              notes: deal.notes ?? "",
              segmentId: deal.segmentId ?? "",
            }}
          />
        }
      />

      <div className="mb-4 space-y-3">
        <StageStepper dealId={deal.id} stage={deal.stage} hasNextAction={Boolean(deal.nextActionAt)} amount={deal.amount ? String(toNumber(deal.amount)) : ""} />
        {deal.stage === "LOST" && (
          <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
            <strong>Refusé</strong> le {formatDate(deal.lostAt)} — motif : {deal.lostReason?.label ?? "non renseigné"}
            {deal.lostReasonDetail ? ` (${deal.lostReasonDetail})` : ""}
          </div>
        )}
        {deal.stage === "WON" && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <strong>Signé</strong> le {formatDate(deal.wonAt)} {deal.amount ? `— ${formatEUR(deal.amount)} HT` : ""}
          </div>
        )}
        <NextActionBanner dealId={deal.id} closed={closed} nextActionAt={deal.nextActionAt} nextActionType={deal.nextActionType} nextActionLabel={deal.nextActionLabel} overdue={isOverdue(deal.nextActionAt)} tz={user.timezone} />
        <RecordActions contact={{ id: deal.contactId, name: contactName, email: deal.contact.email, phone: deal.contact.phone }} dealId={deal.id} companyId={company?.id} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Tâches et actions à venir" description="La plus proche est la prochaine action du dossier.">
            {deal.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune tâche ouverte.</p>
            ) : (
              <div className="-mx-2 divide-y">
                {deal.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} showContact={false} tz={user.timezone} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Emails" description="Tous les échanges avec le contact sur ce dossier.">
            <EmailThreads emails={emails} contact={{ id: deal.contactId, name: contactName, email: deal.contact.email }} dealId={deal.id} />
          </SectionCard>

          <SectionCard title="Historique">
            <NoteComposer dealId={deal.id} contactId={deal.contactId} />
            <ActivityTimeline items={activities} showDeal={false} />
          </SectionCard>
        </div>

        <div className="space-y-6">
          {aiReady && (
            <SectionCard title="✨ Analyse IA">
              <AiInsights contactId={deal.contactId} dealId={deal.id} />
            </SectionCard>
          )}
          <SectionCard title="Contact">
            <Link href={`/contacts/${deal.contactId}`} className="font-semibold hover:underline">
              {contactName}
            </Link>
            {deal.contact.jobTitle && <div className="text-sm text-muted-foreground">{deal.contact.jobTitle}</div>}
            <div className="mt-2 space-y-1 text-sm">
              {deal.contact.phone && (
                <a href={`tel:${deal.contact.phone}`} className="flex items-center gap-2 text-primary hover:underline">
                  <Phone className="size-3.5" /> {formatPhone(deal.contact.phone)}
                </a>
              )}
              {deal.contact.email && (
                <a href={`mailto:${deal.contact.email}`} className="flex items-center gap-2 text-primary hover:underline">
                  <Mail className="size-3.5" /> {deal.contact.email}
                </a>
              )}
              {company && (
                <Link href={`/organisations/${company.id}`} className="flex items-center gap-2 hover:underline">
                  <Building2 className="size-3.5" /> {company.name}
                </Link>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Dossier">
            <dl>
              <KeyValue label="Étape">{STAGE_LABELS[deal.stage]}</KeyValue>
              <KeyValue label="Cible">{deal.segment ? <SegmentBadge segment={deal.segment} /> : null}</KeyValue>
              <KeyValue label="Type">{deal.kind === "B2B" ? "Professionnel (B2B)" : "Particulier (B2C)"}</KeyValue>
              <KeyValue label="Montant">{deal.amount ? `${formatEUR(deal.amount)} HT` : null}</KeyValue>
              <KeyValue label="Quantité">{deal.quantity ? `${deal.quantity} pilulier(s)` : null}</KeyValue>
              <KeyValue label="Signature prévue">{deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : null}</KeyValue>
              <KeyValue label="Origine">{SOURCE_LABELS[deal.source]}</KeyValue>
              <KeyValue label="Créé le">{formatDate(deal.createdAt)}</KeyValue>
              <KeyValue label="Dans l'étape depuis">{formatDate(deal.stageEnteredAt)}</KeyValue>
            </dl>
            {deal.notes && <p className="mt-2 rounded-md bg-muted p-2 text-sm whitespace-pre-line">{deal.notes}</p>}
          </SectionCard>

          <SectionCard title="Relances automatiques">
            <SequencePanel enrollments={enrollments} contactId={deal.contactId} dealId={deal.id} tz={user.timezone} />
          </SectionCard>

          <SectionCard title="Rendez-vous">
            {deal.meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun rendez-vous.</p>
            ) : (
              <ul className="space-y-2">
                {deal.meetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/agenda/${m.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      {m.type === "VIDEO" ? <Video className="size-4" /> : <CalendarDays className="size-4" />}
                      <span className="flex-1 truncate">{formatDateTime(m.startAt, user.timezone)}</span>
                      <span className="text-xs text-muted-foreground">
                        {MEETING_TYPE_LABELS[m.type]} · {MEETING_STATUS_LABELS[m.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Devis" actions={<Link href={`/devis/nouveau?dealId=${deal.id}&contactId=${deal.contactId}`} className="text-xs text-primary hover:underline">Nouveau devis</Link>}>
            {deal.quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun devis.</p>
            ) : (
              <ul className="space-y-1">
                {deal.quotes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/devis/${q.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      <FileText className="size-4" />
                      <span className="flex-1">{q.number}</span>
                      <span className="tabular-nums">{formatEUR(q.totalHT)}</span>
                      <QuoteStatusBadge status={q.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Essais / pilotes" actions={<Link href={`/essais/nouveau?dealId=${deal.id}&contactId=${deal.contactId}`} className="text-xs text-primary hover:underline">Nouvel essai</Link>}>
            {deal.trials.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun essai.</p>
            ) : (
              <ul className="space-y-1">
                {deal.trials.map((t) => (
                  <li key={t.id}>
                    <Link href={`/essais/${t.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      <FlaskConical className="size-4" />
                      <span className="flex-1 truncate">{t.title}</span>
                      <TrialStatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Historique des étapes">
            <ol className="space-y-1.5 text-sm">
              {deal.stageHistory.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <span>
                    {h.fromStage ? `${STAGE_LABELS[h.fromStage]} → ` : ""}
                    <strong>{STAGE_LABELS[h.toStage]}</strong>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(h.createdAt, "d MMM yyyy")}
                    {h.user ? ` · ${h.user.firstName}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
