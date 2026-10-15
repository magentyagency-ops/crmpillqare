import Link from "next/link";
import { CheckSquare, Mail, Phone, Repeat, Settings2 } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { contactDisplayName, STEP_RUN_STATUS_LABELS, STOP_REASON_LABELS } from "@/lib/labels";
import { formatDateTime, formatRelative, toDateTimeLocalValue } from "@/lib/dates";
import { renderTemplate } from "@/lib/email/render";
import { EmptyHint, PageHeader, Pill, SectionCard, StatCard, UserAvatar } from "@/components/common/ui-bits";
import { SearchFilter, SelectFilter, TabLinks } from "@/components/common/filters";
import { Button } from "@/components/ui/button";
import { StepRunActions } from "./relances-client";
import { contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Relances" };

const TYPE_ICON = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare } as const;
const STATUS_TONE: Partial<Record<string, string>> = {
  SCHEDULED: "bg-sky-100 text-sky-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  SENT: "bg-emerald-100 text-emerald-800",
  DONE: "bg-emerald-100 text-emerald-800",
  TASK_OPEN: "bg-indigo-100 text-indigo-800",
  FAILED: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  SKIPPED: "bg-slate-100 text-slate-600",
  PROCESSING: "bg-sky-100 text-sky-800",
};

type Search = { tab?: string; owner?: string; sequence?: string; q?: string };

export default async function RelancesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "prevues";
  const settings = await getSettings("followups");
  const now = new Date();
  const late = new Date(now.getTime() - 15 * 60_000);
  const noReplyBefore = new Date(now.getTime() - settings.noReplyDays * 86_400_000);

  // Manager : toute l'équipe par défaut ; commercial : ses relances
  const ownerFilter: Prisma.SequenceEnrollmentWhereInput = !isManager(user)
    ? { ownerId: user.id }
    : sp.owner === "me"
      ? { ownerId: user.id }
      : sp.owner
        ? { ownerId: sp.owner }
        : {};
  const enrollmentWhere: Prisma.SequenceEnrollmentWhereInput = {
    ...ownerFilter,
    ...(sp.sequence ? { sequenceId: sp.sequence } : {}),
    ...(sp.q
      ? {
          contact: contactSearchWhere(sp.q),
        }
      : {}),
  };

  const tabs: Record<string, Prisma.SequenceStepRunWhereInput> = {
    prevues: { status: "SCHEDULED", scheduledAt: { gte: late }, enrollment: { ...enrollmentWhere, status: "ACTIVE" } },
    validate: { status: "PENDING_APPROVAL", enrollment: { ...enrollmentWhere, status: "ACTIVE" } },
    retard: {
      enrollment: { ...enrollmentWhere, status: "ACTIVE" },
      OR: [
        { status: { in: ["SCHEDULED", "PENDING_APPROVAL"] }, scheduledAt: { lt: late } },
        { status: "TASK_OPEN", task: { status: "OPEN", dueAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } },
      ],
    },
    envoyees: { status: "SENT", enrollment: enrollmentWhere },
    "sans-reponse": { status: "SENT", repliedAt: null, executedAt: { lt: noReplyBefore }, enrollment: enrollmentWhere },
    repondues: { repliedAt: { not: null }, enrollment: enrollmentWhere },
    taches: { status: { in: ["TASK_OPEN", "DONE"] }, enrollment: enrollmentWhere },
    failed: { status: "FAILED", enrollment: enrollmentWhere },
    arretees: { status: { in: ["CANCELLED", "SKIPPED"] }, enrollment: enrollmentWhere },
  };
  const where = tabs[tab] ?? tabs.prevues!;

  const [runs, counts, sequences, users] = await Promise.all([
    db.sequenceStepRun.findMany({
      where,
      orderBy: ["prevues", "validate", "retard"].includes(tab) ? { scheduledAt: "asc" } : { updatedAt: "desc" },
      take: 300,
      include: {
        step: { select: { subject: true, taskTitle: true, aiPersonalize: true } },
        task: { select: { id: true, status: true, dueAt: true } },
        email: { select: { id: true, subject: true } },
        enrollment: {
          include: {
            sequence: { select: { id: true, name: true, _count: { select: { steps: { where: { archivedAt: null } } } } } },
            contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
            owner: { select: { firstName: true, lastName: true, color: true } },
            deal: { select: { id: true, title: true } },
          },
        },
      },
    }),
    Promise.all(Object.entries(tabs).map(async ([k, w]) => [k, await db.sequenceStepRun.count({ where: w })] as const)),
    db.sequence.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const count = Object.fromEntries(counts);

  return (
    <>
      <PageHeader
        title="Relances"
        description="Relances automatiques selon le profil et l'étape du prospect : elles s'arrêtent dès qu'il répond, prend RDV ou avance dans le pipeline."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/relances/scenarios">
              <Settings2 /> Scénarios de relance
            </Link>
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Prévues" value={count.prevues} />
        <StatCard label="À valider" value={count.validate} tone={count.validate ? "warning" : "default"} />
        <StatCard label="En retard" value={count.retard} tone={count.retard ? "danger" : "success"} />
        <StatCard label="Envoyées" value={count.envoyees} />
        <StatCard label={`Sans réponse (> ${settings.noReplyDays} j)`} value={count["sans-reponse"]} tone={count["sans-reponse"] ? "warning" : "default"} />
        <StatCard label="Répondues" value={count.repondues} tone="success" hint={count.envoyees ? `${Math.round((count.repondues! / Math.max(1, count.envoyees!)) * 100)} % de réponse` : undefined} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="tab"
          tabs={[
            { value: "prevues", label: "Prévues", count: count.prevues },
            { value: "validate", label: "À valider", count: count.validate, tone: "warning" },
            { value: "retard", label: "En retard", count: count.retard, tone: "danger" },
            { value: "envoyees", label: "Envoyées", count: count.envoyees },
            { value: "sans-reponse", label: "Sans réponse", count: count["sans-reponse"], tone: "warning" },
            { value: "repondues", label: "Répondues", count: count.repondues },
            { value: "taches", label: "Appels / tâches", count: count.taches },
            { value: "failed", label: "Échecs", count: count.failed, tone: "danger" },
            { value: "arretees", label: "Annulées" },
          ]}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchFilter placeholder="Contact, organisation…" />
        <SelectFilter param="sequence" placeholder="Tous les scénarios" options={sequences.map((s) => ({ value: s.id, label: s.name }))} />
        {isManager(user) && (
          <SelectFilter param="owner" placeholder="Toute l'équipe" options={[{ value: "me", label: "Mes relances" }, ...users.filter((u) => u.id !== user.id).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
        )}
      </div>
      <SectionCard bodyClassName="p-0">
        {runs.length === 0 ? (
          <EmptyHint icon={Repeat} title="Aucune relance dans cette vue" />
        ) : (
          <ul className="divide-y">
            {runs.map((r) => {
              const Icon = TYPE_ICON[r.type];
              const c = r.enrollment.contact;
              const vars = { contact: { fullName: contactDisplayName(c), firstName: c.firstName ?? "", lastName: c.lastName ?? "" }, company: { name: c.company?.name ?? "" } };
              const label =
                r.type === "EMAIL"
                  ? r.email?.subject || renderTemplate(r.subjectOverride || r.step.subject || "", vars) || "Relance envoyée dans le fil de l'email précédent"
                  : renderTemplate(r.step.taskTitle || "Appel", vars);
              const isLate = (r.status === "SCHEDULED" || r.status === "PENDING_APPROVAL") && r.scheduledAt < late;
              const noReply = r.status === "SENT" && !r.repliedAt && r.executedAt && r.executedAt < noReplyBefore;
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <Icon className="mt-1 size-4 text-muted-foreground" />
                  <div className="min-w-60 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:underline">
                        {contactDisplayName(c)}
                      </Link>
                      {c.company && <span className="text-xs text-muted-foreground">{c.company.name}</span>}
                      <Pill className={STATUS_TONE[r.status] ?? ""}>{r.repliedAt ? "Répondue ✓" : noReply ? "Sans réponse" : STEP_RUN_STATUS_LABELS[r.status]}</Pill>
                      {isLate && <Pill className="bg-rose-100 text-rose-700">En retard</Pill>}
                      {r.type === "EMAIL" && (r.aiPersonalized || (r.step.aiPersonalize && ["SCHEDULED", "PENDING_APPROVAL"].includes(r.status))) && (
                        <Pill className="bg-violet-100 text-violet-800">{r.aiPersonalized ? "✨ Personnalisé IA" : "✨ IA à l'envoi"}</Pill>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-sm">{label}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {r.enrollment.sequence.name} · étape {r.position}/{r.enrollment.sequence._count.steps}
                      </span>
                      <span title={formatDateTime(r.executedAt ?? r.scheduledAt, user.timezone)}>
                        {r.executedAt ? `Exécutée ${formatRelative(r.executedAt)}` : `Prévue ${formatDateTime(r.scheduledAt, user.timezone)}`}
                      </span>
                      {r.repliedAt && <span className="text-emerald-700">Réponse {formatRelative(r.repliedAt)}</span>}
                      {r.enrollment.deal && (
                        <Link href={`/pipeline/${r.enrollment.deal.id}`} className="hover:underline">
                          {r.enrollment.deal.title}
                        </Link>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <UserAvatar user={r.enrollment.owner} size="xs" /> {r.enrollment.owner.firstName}
                      </span>
                      {r.status === "CANCELLED" && r.enrollment.stopReason && <span>Arrêt : {STOP_REASON_LABELS[r.enrollment.stopReason]}</span>}
                      {r.error && r.status !== "CANCELLED" && <span className="text-rose-600">{r.error}</span>}
                    </div>
                  </div>
                  <StepRunActions runId={r.id} status={r.status} type={r.type} scheduledAtLocal={toDateTimeLocalValue(r.scheduledAt, user.timezone)} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
