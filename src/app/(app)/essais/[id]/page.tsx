import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { trialNextDeadline } from "@/lib/trials";
import { contactDisplayName } from "@/lib/labels";
import { formatDate, formatSmart, toDateInputValue } from "@/lib/dates";
import { KeyValue, PageHeader, SectionCard, StageBadge, TrialStatusBadge, UserAvatar } from "@/components/common/ui-bits";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { TaskRow } from "@/components/tasks/task-row";
import { TrialCheckpoints, TrialFeedback, TrialItems, TrialStatusStepper } from "./trial-client";

export default async function TrialPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const trial = await db.trial.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      deal: { select: { id: true, title: true, stage: true } },
      owner: { select: { firstName: true, lastName: true, color: true } },
      items: { orderBy: { id: "asc" } },
      checkpoints: { orderBy: { dueAt: "asc" } },
      tasks: {
        where: { status: "OPEN" },
        orderBy: { dueAt: "asc" },
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, deal: { select: { id: true, title: true } } },
      },
    },
  });
  if (!trial) notFound();
  if (!(await canView(await requireUser(), [trial.ownerId]))) notFound();
  const [activities, products] = await Promise.all([
    db.activity.findMany({ where: { trialId: id }, orderBy: { occurredAt: "desc" }, include: timelineInclude }),
    db.product.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const tz = user.timezone;
  const now = new Date();
  const next = trialNextDeadline(trial);

  return (
    <>
      <PageHeader
        back={{ href: "/essais", label: "Essais & pilotes" }}
        title={trial.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TrialStatusBadge status={trial.status} />
            {trial.company && (
              <Link href={`/organisations/${trial.company.id}`} className="hover:underline">
                {trial.company.name}
              </Link>
            )}
            {trial.contact && (
              <Link href={`/contacts/${trial.contact.id}`} className="hover:underline">
                · {contactDisplayName(trial.contact)}
              </Link>
            )}
            <span className="inline-flex items-center gap-1">
              · <UserAvatar user={trial.owner} size="xs" /> {trial.owner.firstName}
            </span>
          </span>
        }
      />
      <div className="mb-4 space-y-3">
        <TrialStatusStepper id={trial.id} status={trial.status} />
        {next && (
          <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ring-1 ${next.at < now ? "bg-rose-50 text-rose-900 ring-rose-200" : "bg-sky-50 text-sky-900 ring-sky-200"}`}>
            <CalendarClock className="size-4" />
            <span>
              <strong>Prochaine échéance :</strong> {next.label} — {formatSmart(next.at, { withTime: false, tz })}
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Matériel envoyé" description="Expédition, livraison et retour du matériel prêté.">
            <TrialItems
              trialId={trial.id}
              products={products}
              items={trial.items.map((i) => ({
                id: i.id,
                name: i.name,
                quantity: i.quantity,
                serialNumbers: i.serialNumbers,
                trackingNumber: i.trackingNumber,
                shippedAt: i.shippedAt ? formatDate(i.shippedAt, "d MMM", tz) : null,
                deliveredAt: i.deliveredAt ? formatDate(i.deliveredAt, "d MMM", tz) : null,
                returnExpected: i.returnExpected,
                returnedAt: i.returnedAt ? formatDate(i.returnedAt, "d MMM", tz) : null,
                returnedQuantity: i.returnedQuantity,
              }))}
            />
          </SectionCard>
          <SectionCard title="Retours et bilan">
            <TrialFeedback id={trial.id} initial={{ feedback: trial.feedback ?? "", rating: trial.rating, result: trial.result }} />
          </SectionCard>
          <SectionCard title="Historique">
            <ActivityTimeline items={activities} showDeal={false} />
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Informations">
            <dl>
              <KeyValue label="Période">
                {trial.startDate ? formatDate(trial.startDate) : "?"} → {trial.endDate ? formatDate(trial.endDate) : "?"}
              </KeyValue>
              <KeyValue label="Lieu">{trial.location}</KeyValue>
              <KeyValue label="Participants">{trial.participants ? `${trial.participants} patient(s) / résident(s)` : null}</KeyValue>
              {trial.deal && (
                <KeyValue label="Dossier">
                  <Link href={`/pipeline/${trial.deal.id}`} className="hover:underline">
                    {trial.deal.title}
                  </Link>{" "}
                  <StageBadge stage={trial.deal.stage} />
                </KeyValue>
              )}
              <KeyValue label="Converti le">{trial.convertedAt ? formatDate(trial.convertedAt) : null}</KeyValue>
            </dl>
            {trial.objectives && (
              <div className="mt-3 text-sm">
                <div className="font-medium">Objectifs</div>
                <p className="whitespace-pre-line text-muted-foreground">{trial.objectives}</p>
              </div>
            )}
            {trial.successCriteria && (
              <div className="mt-3 text-sm">
                <div className="font-medium">Critères de succès</div>
                <p className="whitespace-pre-line text-muted-foreground">{trial.successCriteria}</p>
              </div>
            )}
          </SectionCard>
          <SectionCard title="Jalons">
            <TrialCheckpoints
              trialId={trial.id}
              checkpoints={trial.checkpoints.map((c) => ({
                id: c.id,
                title: c.title,
                dueAt: toDateInputValue(c.dueAt, tz),
                dueLabel: formatSmart(c.dueAt, { withTime: false, tz }),
                done: Boolean(c.doneAt),
                overdue: c.dueAt < now,
                notes: c.notes,
              }))}
            />
          </SectionCard>
          <SectionCard title="Tâches ouvertes">
            {trial.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune tâche.</p>
            ) : (
              <div className="-mx-2 divide-y">
                {trial.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} tz={tz} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
