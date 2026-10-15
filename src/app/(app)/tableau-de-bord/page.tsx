import Link from "next/link";
import { AlertTriangle, CalendarCheck, Euro, FileText, Phone, Repeat, Target, Trophy, TrendingUp } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { activityByWeek, getSalesMetrics, leadSources, lostReasonsBreakdown, pipelineFunnel, revenueByMonth, satisfactionStats, totals, type Period } from "@/lib/dashboard";
import { blockedDealsWhere, blockedReasons } from "@/lib/deals";
import { getSettings } from "@/lib/settings";
import { addDaysTz, endOfDayTz, formatDate, formatRelative, formatSmart, startOfDayTz, startOfMonthTz, startOfWeekTz, zonedDateTime, dayKey } from "@/lib/dates";
import { formatEUR } from "@/lib/format";
import { BLOCKED_REASON_LABELS, contactDisplayName, SOURCE_LABELS, STAGE_LABELS, ACTIVITY_LABELS } from "@/lib/labels";
import { PageHeader, SectionCard, StageBadge, StatCard, UserAvatar } from "@/components/common/ui-bits";
import { SelectFilter, TabLinks } from "@/components/common/filters";
import { ActivityChart, HorizontalBars, RevenueChart } from "@/components/dashboard/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Tableau de bord" };

const PERIODS = [
  { value: "mois", label: "Ce mois" },
  { value: "semaine", label: "Cette semaine" },
  { value: "mois-dernier", label: "Mois dernier" },
  { value: "trimestre", label: "Ce trimestre" },
  { value: "annee", label: "Cette année" },
  { value: "30j", label: "30 derniers jours" },
];

function periodRange(key: string, tz: string): Period {
  const now = new Date();
  const end = endOfDayTz(now, tz);
  switch (key) {
    case "semaine":
      return { from: startOfWeekTz(now, tz), to: end };
    case "mois-dernier": {
      const thisMonth = startOfMonthTz(now, tz);
      const lastMonth = startOfMonthTz(addDaysTz(thisMonth, -1, tz), tz);
      return { from: lastMonth, to: new Date(thisMonth.getTime() - 1) };
    }
    case "trimestre": {
      const month = Number(dayKey(now, tz).slice(5, 7));
      const qMonth = String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0");
      return { from: zonedDateTime(`${dayKey(now, tz).slice(0, 4)}-${qMonth}-01`, "00:00", tz), to: end };
    }
    case "annee":
      return { from: zonedDateTime(`${dayKey(now, tz).slice(0, 4)}-01-01`, "00:00", tz), to: end };
    case "30j":
      return { from: startOfDayTz(addDaysTz(now, -29, tz), tz), to: end };
    default:
      return { from: startOfMonthTz(now, tz), to: end };
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ periode?: string; commercial?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = isManager(user);
  const tz = user.timezone;
  const period = periodRange(sp.periode ?? "mois", tz);
  const focusId = manager ? (sp.commercial ?? null) : user.id;
  const userIds = focusId ? [focusId] : undefined;
  const ownerWhere: Prisma.DealWhereInput = focusId ? { ownerId: focusId } : {};

  const [rows, revenue, activity, funnel, lost, sources, satisfaction, pipelineSettings, blockedWhere, users] = await Promise.all([
    getSalesMetrics(period, manager ? undefined : [user.id]),
    revenueByMonth(userIds),
    activityByWeek(userIds),
    pipelineFunnel(ownerWhere),
    lostReasonsBreakdown(period, ownerWhere),
    leadSources(period),
    satisfactionStats(period),
    getSettings("pipeline"),
    blockedDealsWhere(),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const scopeRows = focusId ? rows.filter((r) => r.userId === focusId) : rows;
  const t = totals(scopeRows);
  const focusUser = focusId ? users.find((u) => u.id === focusId) : null;

  const [blocked, overdueTasks, upcomingMeetings, recent] = await Promise.all([
    db.deal.findMany({
      where: { ...blockedWhere, ...ownerWhere },
      include: { owner: { select: { firstName: true, lastName: true, color: true } }, contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      orderBy: { nextActionAt: { sort: "asc", nulls: "first" } },
      take: 60,
    }),
    focusId
      ? db.task.findMany({ where: { assigneeId: focusId, status: "OPEN", dueAt: { lt: startOfDayTz(new Date(), tz) } }, orderBy: { dueAt: "asc" }, take: 15, include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } })
      : Promise.resolve([]),
    focusId
      ? db.meeting.findMany({ where: { organizerId: focusId, status: "SCHEDULED", startAt: { gte: new Date() } }, orderBy: { startAt: "asc" }, take: 8 })
      : Promise.resolve([]),
    db.activity.findMany({
      where: { ...(focusId ? { userId: focusId } : { userId: { not: null } }), type: { in: ["CALL", "EMAIL_SENT", "MEETING", "MEETING_REPORT", "QUOTE_SENT", "STAGE_CHANGED", "NOTE"] } },
      orderBy: { occurredAt: "desc" },
      take: 15,
      include: { user: { select: { firstName: true, lastName: true, color: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  const now = new Date();
  const blockedWithReasons = blocked.map((d) => ({ deal: d, reasons: blockedReasons(d, pipelineSettings, now) })).filter((b) => b.reasons.length > 0);

  return (
    <>
      <PageHeader
        title={focusUser ? `Tableau de bord — ${focusUser.firstName} ${focusUser.lastName}` : manager ? "Tableau de bord de l'équipe" : "Mon tableau de bord"}
        description={`Du ${formatDate(period.from, "d MMMM yyyy", tz)} au ${formatDate(period.to, "d MMMM yyyy", tz)}`}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TabLinks param="periode" tabs={PERIODS} />
        {manager && <SelectFilter param="commercial" placeholder="Toute l'équipe" options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Appels" value={t.calls} icon={Phone} hint={`${t.callsReached} joint(s)`} />
        <StatCard label="RDV réalisés" value={t.meetingsHeld} icon={CalendarCheck} hint={`${t.meetingsScheduled} RDV obtenu(s) sur la période`} />
        <StatCard label="Relances" value={t.followUpsDone} icon={Repeat} hint={`${t.emailsSent} email(s) envoyé(s)`} />
        <StatCard label="Devis envoyés" value={t.quotesSent} icon={FileText} hint={`${formatEUR(t.quotesAmount, { compact: true })} HT · ${t.quotesAccepted} accepté(s)`} />
        <StatCard label="Ventes signées" value={t.dealsWon} icon={Trophy} tone="success" hint={`${t.dealsLost} refus · ${t.winRate !== null ? `${t.winRate} % de réussite` : "—"}`} />
        <StatCard label="CA signé (HT)" value={formatEUR(t.revenue, { compact: true })} icon={Euro} tone="success" />
        <StatCard label="Nouveaux dossiers" value={t.dealsCreated} icon={TrendingUp} />
        <StatCard label="Pipeline en cours" value={formatEUR(t.pipelineValue, { compact: true })} icon={Target} hint={`pondéré : ${formatEUR(t.weightedPipeline, { compact: true })}`} />
        <StatCard label="Dossiers bloqués" value={t.blockedDeals} icon={AlertTriangle} tone={t.blockedDeals ? "warning" : "success"} hint="sans action, en retard ou inactifs" />
        <StatCard label="Tâches en retard" value={t.overdueTasks} icon={AlertTriangle} tone={t.overdueTasks ? "danger" : "success"} hint={satisfaction.count ? `Satisfaction clients : ${satisfaction.average?.toFixed(1).replace(".", ",")}/5` : undefined} />
      </div>

      {manager && !focusId && (
        <SectionCard title="Suivi par commercial" description="Appels (dont joints), RDV réalisés (obtenus sur la période), relances effectuées, devis envoyés. Cliquez sur un commercial pour le détail." className="mb-6" bodyClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Commercial</TableHead>
                <TableHead className="text-right">Appels</TableHead>
                <TableHead className="text-right">RDV</TableHead>
                <TableHead className="text-right">Relances</TableHead>
                <TableHead className="text-right">Devis</TableHead>
                <TableHead className="text-right">Signés</TableHead>
                <TableHead className="text-right">CA signé</TableHead>
                <TableHead className="text-right">Réussite</TableHead>
                <TableHead className="text-right">Pipeline</TableHead>
                <TableHead className="text-right">Bloqués</TableHead>
                <TableHead className="text-right">Retard</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell>
                    <Link href={`/tableau-de-bord?commercial=${r.userId}${sp.periode ? `&periode=${sp.periode}` : ""}`} className="flex items-center gap-2 font-medium hover:underline">
                      <UserAvatar user={{ firstName: r.name.split(" ")[0] ?? "", lastName: r.name.split(" ").slice(1).join(" "), color: r.color }} size="xs" /> {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.calls} <span className="text-xs text-muted-foreground">({r.callsReached})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.meetingsHeld} <span className="text-xs text-muted-foreground">({r.meetingsScheduled})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.followUpsDone}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quotesSent} <span className="text-xs text-muted-foreground">{r.quotesAmount ? formatEUR(r.quotesAmount, { compact: true }) : ""}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.dealsWon}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatEUR(r.revenue, { compact: true })}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.winRate !== null ? `${r.winRate} %` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEUR(r.pipelineValue, { compact: true })}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.blockedDeals ? "font-semibold text-amber-700" : ""}`}>{r.blockedDeals}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.overdueTasks ? "font-semibold text-rose-600" : ""}`}>{r.overdueTasks}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Total équipe</TableCell>
                <TableCell className="text-right tabular-nums">{t.calls}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.meetingsHeld} <span className="text-xs text-muted-foreground">({t.meetingsScheduled})</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.followUpsDone}</TableCell>
                <TableCell className="text-right tabular-nums">{t.quotesSent}</TableCell>
                <TableCell className="text-right tabular-nums">{t.dealsWon}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEUR(t.revenue, { compact: true })}</TableCell>
                <TableCell className="text-right tabular-nums">{t.winRate !== null ? `${t.winRate} %` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEUR(t.pipelineValue, { compact: true })}</TableCell>
                <TableCell className="text-right tabular-nums">{t.blockedDeals}</TableCell>
                <TableCell className="text-right tabular-nums">{t.overdueTasks}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </SectionCard>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <RevenueChart data={revenue} />
        <ActivityChart data={activity} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HorizontalBars
          title="Pipeline par étape"
          description="Dossiers ouverts (nombre et montant)"
          valueLabel="Dossiers"
          data={funnel.map((f) => ({ label: STAGE_LABELS[f.stage], value: f.count, hint: formatEUR(f.amount, { compact: true }) }))}
        />
        <HorizontalBars title="Motifs de refus" description="Dossiers refusés sur la période" valueLabel="Dossiers" data={lost.map((l) => ({ label: l.label, value: l.count }))} emptyLabel="Aucun refus sur la période 👍" />
        <HorizontalBars title="Origine des nouveaux contacts" description="Sur la période" valueLabel="Contacts" data={sources.map((s) => ({ label: SOURCE_LABELS[s.source], value: s.count }))} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <SectionCard title={`Dossiers bloqués (${blockedWithReasons.length})`} description="Sans prochaine action, action en retard, inactifs ou trop longtemps dans l'étape." className="xl:col-span-2" bodyClassName="p-0">
          {blockedWithReasons.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Aucun dossier bloqué 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dossier</TableHead>
                  <TableHead>Étape</TableHead>
                  <TableHead>Commercial</TableHead>
                  <TableHead>Blocage</TableHead>
                  <TableHead>Dernière activité</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedWithReasons.slice(0, 25).map(({ deal, reasons }) => (
                  <TableRow key={deal.id}>
                    <TableCell className="max-w-64 whitespace-normal">
                      <Link href={`/pipeline/${deal.id}`} className="font-medium hover:underline">
                        {deal.title}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{contactDisplayName(deal.contact)}</div>
                    </TableCell>
                    <TableCell>
                      <StageBadge stage={deal.stage} />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <UserAvatar user={deal.owner} size="xs" /> {deal.owner.firstName}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-40 text-xs whitespace-normal text-rose-700">{reasons.map((r) => BLOCKED_REASON_LABELS[r]).join(" · ")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{deal.lastActivityAt ? formatRelative(deal.lastActivityAt) : "jamais"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <div className="space-y-6">
          {focusId && (
            <>
              <SectionCard title={`Tâches en retard (${overdueTasks.length})`}>
                {overdueTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune tâche en retard.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {overdueTasks.map((tk) => (
                      <li key={tk.id} className="flex justify-between gap-2">
                        <Link href={`/taches?task=${tk.id}`} className="truncate hover:underline">
                          {tk.title}
                        </Link>
                        <span className="shrink-0 text-xs text-rose-600">{formatSmart(tk.dueAt, { withTime: false, tz })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
              <SectionCard title="Prochains rendez-vous">
                {upcomingMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun RDV planifié.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {upcomingMeetings.map((m) => (
                      <li key={m.id} className="flex justify-between gap-2">
                        <Link href={`/agenda/${m.id}`} className="truncate hover:underline">
                          {m.title}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatSmart(m.startAt, { tz })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
          <SectionCard title="Dernières actions">
            <ul className="space-y-2 text-sm">
              {recent.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <UserAvatar user={a.user} size="xs" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="text-muted-foreground">{ACTIVITY_LABELS[a.type]} · </span>
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.contact && (
                        <Link href={`/contacts/${a.contact.id}`} className="hover:underline">
                          {[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ")}
                        </Link>
                      )}{" "}
                      · {formatRelative(a.occurredAt)}
                    </div>
                  </div>
                </li>
              ))}
              {recent.length === 0 && <li className="text-muted-foreground">Aucune activité.</li>}
            </ul>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
