import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Mail,
  MapPin,
  Phone,
  Repeat,
  Sparkles,
  UserPlus,
  Video,
} from "lucide-react";
import { isManager, requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { SelectFilter } from "@/components/common/filters";
import { getDailyPlan } from "@/lib/planning";
import { formatLongDate, formatRelative, formatSmart, formatTime } from "@/lib/dates";
import { AI_STATUS_LABELS, MEETING_TYPE_LABELS, contactDisplayName } from "@/lib/labels";
import { BLOCKED_REASON_LABELS } from "@/lib/deals";
import { EmptyHint, PageHeader, SectionCard, StageBadge, StatCard } from "@/components/common/ui-bits";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { CopyBookingLink } from "./copy-booking-link";
import { env } from "@/lib/env";
import { capitalizeFirst } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";

export const metadata = { title: "Ma journée" };

const meetingIcon = { VIDEO: Video, PHONE: Phone, IN_PERSON: MapPin } as const;

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ commercial?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // La direction peut consulter la journée de chaque commercial
  const manager = isManager(user);
  const team = manager ? await db.user.findMany({ where: { active: true, id: { not: user.id } }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }) : [];
  const viewed = manager && sp.commercial ? (team.find((u) => u.id === sp.commercial) ?? null) : null;
  const plan = await getDailyPlan(viewed?.id ?? user.id);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: plan.tz }).format(now));
  const hello = hour < 18 ? "Bonjour" : "Bonsoir";

  return (
    <>
      <PageHeader
        title={viewed ? `Journée de ${viewed.firstName} ${viewed.lastName}` : `${hello} ${user.firstName} 👋`}
        description={capitalizeFirst(formatLongDate(now, plan.tz))}
        actions={
          <>
            {manager && team.length > 0 && (
              <SelectFilter param="commercial" placeholder="Ma journée" options={team.map((u) => ({ value: u.id, label: `Journée de ${u.firstName} ${u.lastName}` }))} />
            )}
            <CopyBookingLink url={`${env.appUrl}/rdv/${user.bookingSlug}`} />
            <Button asChild size="sm">
              <Link href="/assistant/nouveau">
                <Sparkles /> Assistant IA
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Rendez-vous" value={plan.counts.meetings} icon={CalendarDays} />
        <StatCard label="Appels à passer" value={plan.counts.calls} icon={Phone} />
        <StatCard label="Relances" value={plan.counts.followUps} icon={Repeat} hint={plan.autoEmailsToday ? `+ ${plan.autoEmailsToday} envoi(s) automatique(s)` : undefined} />
        <StatCard label="En retard" value={plan.overdueCount} icon={Clock} tone={plan.overdueCount ? "danger" : "success"} />
        <StatCard label="Réponses à traiter" value={plan.counts.replies} icon={Inbox} tone={plan.counts.replies ? "warning" : "default"} href="/emails" />
        <StatCard label="Dossiers à débloquer" value={plan.counts.attention} icon={AlertTriangle} tone={plan.counts.attention ? "warning" : "success"} href="/pipeline?vue=bloques" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Rendez-vous du jour" actions={<Link href="/agenda" className="text-xs text-primary hover:underline">Agenda</Link>}>
            {plan.meetings.length === 0 ? (
              <EmptyHint icon={CalendarDays} title="Aucun rendez-vous aujourd'hui">
                Partagez votre lien de prise de RDV dans vos emails : les créneaux réservés arrivent directement ici.
              </EmptyHint>
            ) : (
              <ol className="space-y-3">
                {plan.meetings.map((m) => {
                  const Icon = meetingIcon[m.type];
                  const past = m.endAt < now;
                  const live = m.startAt <= now && m.endAt >= now;
                  const session = m.aiSessions[0];
                  return (
                    <li key={m.id} className={`flex gap-4 rounded-lg border p-3 ${live ? "border-emerald-400 bg-emerald-50/50" : ""}`}>
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-lg font-bold text-brand-navy tabular-nums">{formatTime(m.startAt, plan.tz)}</div>
                        <div className="text-[11px] text-muted-foreground">{formatTime(m.endAt, plan.tz)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link href={`/agenda/${m.id}`} className="font-medium hover:underline">
                          {m.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Icon className="size-3.5" /> {MEETING_TYPE_LABELS[m.type]}
                          </span>
                          {m.contact && (
                            <Link href={`/contacts/${m.contact.id}`} className="hover:underline">
                              {contactDisplayName(m.contact)}
                              {m.contact.company ? ` · ${m.contact.company.name}` : ""}
                            </Link>
                          )}
                          {m.deal && <StageBadge stage={m.deal.stage} />}
                          {m.status === "CANCELLED" && <span className="font-medium text-rose-600">Annulé</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {m.videoUrl && !past && (
                          <Button asChild size="xs" variant="outline">
                            <a href={m.videoUrl} target="_blank" rel="noreferrer">
                              <Video /> Rejoindre
                            </a>
                          </Button>
                        )}
                        {session ? (
                          <Button asChild size="xs" variant="secondary">
                            <Link href={`/assistant/${session.id}`}>
                              <Sparkles /> CR : {AI_STATUS_LABELS[session.status]}
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild size="xs">
                            <Link href={`/assistant/nouveau?meetingId=${m.id}&kind=${m.type === "VIDEO" ? "VIDEO" : m.type === "PHONE" ? "CALL" : "IN_PERSON"}`}>
                              <Sparkles /> {past ? "Faire le CR" : "Assistant IA"}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </SectionCard>

          <SectionCard title={`Appels à passer (${plan.calls.length})`} description="Rappels de leads, relances téléphoniques et appels planifiés.">
            {plan.calls.length === 0 ? (
              <EmptyHint icon={CheckCircle2} title="Aucun appel prévu" />
            ) : (
              <div className="-mx-2 divide-y">
                {plan.calls.map((t) => (
                  <TaskRow key={t.id} task={t} tz={plan.tz} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`Relances (${plan.followUps.length + plan.approvals.length})`}
            description={plan.autoEmailsToday ? `${plan.autoEmailsToday} relance(s) automatique(s) partiront aussi aujourd'hui.` : "Relances manuelles et emails automatiques à valider."}
            actions={<Link href="/relances" className="text-xs text-primary hover:underline">Toutes les relances</Link>}
          >
            {plan.approvals.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-amber-900">{plan.approvals.length} email(s) de relance à valider avant envoi</span>
                  <Button asChild size="xs">
                    <Link href="/relances?tab=validate">Valider</Link>
                  </Button>
                </div>
                <ul className="space-y-1 text-xs text-amber-900/80">
                  {plan.approvals.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      {contactDisplayName(a.enrollment.contact)} — {a.step.subject || "Relance"} ({a.enrollment.sequence.name})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.followUps.length === 0 && plan.approvals.length === 0 ? (
              <EmptyHint icon={Repeat} title="Aucune relance manuelle aujourd'hui" />
            ) : (
              <div className="-mx-2 divide-y">
                {plan.followUps.map((t) => (
                  <TaskRow key={t.id} task={t} tz={plan.tz} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={`Autres tâches (${plan.otherTasks.length})`} actions={<Link href="/taches" className="text-xs text-primary hover:underline">Toutes mes tâches</Link>}>
            {plan.otherTasks.length === 0 && plan.undatedTasks.length === 0 ? (
              <EmptyHint icon={CheckCircle2} title="Rien d'autre aujourd'hui" />
            ) : (
              <div className="-mx-2 divide-y">
                {plan.otherTasks.map((t) => (
                  <TaskRow key={t.id} task={t} tz={plan.tz} />
                ))}
                {plan.undatedTasks.length > 0 && (
                  <>
                    <div className="px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase">Sans échéance</div>
                    {plan.undatedTasks.map((t) => (
                      <TaskRow key={t.id} task={t} tz={plan.tz} />
                    ))}
                  </>
                )}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title={`Réponses à traiter (${plan.replies.length})`} actions={<Link href="/emails" className="text-xs text-primary hover:underline">Emails</Link>}>
            {plan.replies.length === 0 ? (
              <EmptyHint icon={Mail} title="Aucune réponse en attente" />
            ) : (
              <ul className="-my-1 divide-y">
                {plan.replies.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={`/contacts/${r.contactId}?tab=emails`} className="block hover:underline">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.contact ? contactDisplayName(r.contact) : r.fromEmail}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(r.sentAt)}</span>
                      </div>
                      <div className="truncate text-xs">{r.subject}</div>
                      {r.snippet && <div className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {plan.reports.length > 0 && (
            <SectionCard title={`Comptes rendus à valider (${plan.reports.length})`}>
              <ul className="space-y-2">
                {plan.reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/assistant/${r.id}`} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-accent">
                      <FileText className="size-4 text-primary" />
                      <span className="flex-1 truncate">{r.title}</span>
                      <span className={`text-[11px] ${r.status === "FAILED" ? "text-rose-600" : "text-muted-foreground"}`}>{AI_STATUS_LABELS[r.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SectionCard title={`Dossiers à débloquer (${plan.attention.length})`} description="Sans prochaine action, en retard ou sans activité récente.">
            {plan.attention.length === 0 ? (
              <EmptyHint icon={CheckCircle2} title="Tous vos dossiers ont une prochaine action 👍" />
            ) : (
              <ul className="-my-1 divide-y">
                {plan.attention.slice(0, 12).map(({ deal, reasons }) => (
                  <li key={deal.id} className="py-2">
                    <Link href={`/pipeline/${deal.id}`} className="block hover:underline">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{deal.title}</span>
                        <StageBadge stage={deal.stage} />
                      </div>
                      <div className="mt-0.5 text-xs text-rose-600">{reasons.map((r) => BLOCKED_REASON_LABELS[r]).join(" · ")}</div>
                      {deal.nextActionAt && <div className="text-[11px] text-muted-foreground">Prévu : {formatSmart(deal.nextActionAt, { tz: plan.tz })}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={`Nouveaux leads (${plan.newLeads.length})`} description="Prospects récents jamais contactés.">
            {plan.newLeads.length === 0 ? (
              <EmptyHint icon={UserPlus} title="Aucun nouveau lead en attente" />
            ) : (
              <ul className="-my-1 divide-y">
                {plan.newLeads.map((d) => (
                  <li key={d.id} className="py-2">
                    <Link href={`/pipeline/${d.id}`} className="block hover:underline">
                      <div className="truncate text-sm font-medium">{d.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.contact.phone ? formatPhone(d.contact.phone) : d.contact.email} · reçu {formatRelative(d.createdAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
