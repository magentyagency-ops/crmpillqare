import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, ownerScope, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { blockedReasons } from "@/lib/deals";
import { getSettings } from "@/lib/settings";
import { toNumber, formatEUR } from "@/lib/format";
import { contactDisplayName, BLOCKED_REASON_LABELS, NEXT_ACTION_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";
import { formatDate, formatSmart } from "@/lib/dates";
import { PageHeader, StageBadge, UserAvatar, EmptyHint } from "@/components/common/ui-bits";
import { SearchFilter, SelectFilter, TabLinks } from "@/components/common/filters";
import { Kanban, type KanbanDeal } from "@/components/pipeline/kanban";
import { NewDealButton } from "./new-deal-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kanban as KanbanIcon } from "lucide-react";
import { allWords, contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Pipeline" };

type Search = { vue?: string; owner?: string; segment?: string; kind?: string; q?: string; stage?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.vue ?? "kanban";
  const scope = await ownerScope(user);
  const settings = await getSettings("pipeline");

  const where: Prisma.DealWhereInput = {
    archivedAt: null,
    ...scope,
    ...(sp.owner === "me" ? { ownerId: user.id } : sp.owner ? { ownerId: sp.owner } : {}),
    ...(sp.segment ? { segmentId: sp.segment } : {}),
    ...(sp.kind === "B2B" || sp.kind === "B2C" ? { kind: sp.kind } : {}),
    ...(sp.q
      ? {
          OR: [
            allWords(sp.q, (w) => ({ title: { contains: w, mode: "insensitive" as const } })),
            { contact: contactSearchWhere(sp.q) },
            { company: { name: { contains: sp.q.trim(), mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  if (view === "kanban" || view === "bloques") where.stage = { notIn: ["WON", "LOST"] };
  else if (sp.stage) where.stage = sp.stage as Prisma.EnumDealStageFilter["equals"];

  const [deals, users, segments] = await Promise.all([
    db.deal.findMany({
      where,
      include: {
        contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        company: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true, color: true } },
        segment: { select: { name: true, color: true } },
      },
      orderBy: [{ nextActionAt: { sort: "asc", nulls: "first" } }],
      take: 1000,
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } }),
    db.segment.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);

  const now = new Date();
  const items: KanbanDeal[] = deals.map((d) => ({
    id: d.id,
    title: d.title,
    stage: d.stage,
    amount: d.amount ? toNumber(d.amount) : null,
    contactName: contactDisplayName(d.contact),
    companyName: d.company?.name ?? null,
    owner: d.owner,
    nextActionAt: d.nextActionAt,
    nextActionType: d.nextActionType,
    nextActionLabel: d.nextActionLabel,
    segment: d.segment,
    blocked: blockedReasons(d, settings, now),
    kind: d.kind,
  }));
  const blocked = items.filter((d) => d.blocked.length > 0);
  const openValue = items.filter((d) => !["WON", "LOST"].includes(d.stage)).reduce((a, d) => a + (d.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Pipeline commercial"
        description={`${items.length} dossier(s) · ${formatEUR(openValue, { compact: true })} en cours · ${blocked.length} bloqué(s)`}
        actions={<NewDealButton />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="vue"
          tabs={[
            { value: "kanban", label: "Kanban" },
            { value: "liste", label: "Liste" },
            { value: "bloques", label: "Dossiers bloqués", count: view === "bloques" || view === "kanban" ? blocked.length : undefined, tone: "warning" },
          ]}
        />
        <SearchFilter placeholder="Dossier, contact, organisation…" />
        <SelectFilter
          param="owner"
          placeholder="Tous les commerciaux"
          options={[{ value: "me", label: "Mes dossiers" }, ...(isManager(user) || Object.keys(scope).length === 0 ? users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })) : [])]}
        />
        <SelectFilter param="segment" placeholder="Toutes les cibles" options={segments.map((s) => ({ value: s.id, label: s.name }))} />
        <SelectFilter param="kind" placeholder="B2B et B2C" options={[{ value: "B2B", label: "B2B" }, { value: "B2C", label: "B2C" }]} />
        {view === "liste" && <SelectFilter param="stage" placeholder="Toutes les étapes" options={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} />}
      </div>

      {view === "kanban" && <Kanban deals={items} tz={user.timezone} />}

      {view !== "kanban" && (
        <div className="overflow-hidden rounded-xl bg-card surface">
          {(view === "bloques" ? blocked : items).length === 0 ? (
            <EmptyHint icon={KanbanIcon} title={view === "bloques" ? "Aucun dossier bloqué 🎉" : "Aucun dossier"} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dossier</TableHead>
                  <TableHead>Étape</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Commercial</TableHead>
                  <TableHead>Prochaine action</TableHead>
                  {view === "bloques" ? <TableHead>Blocage</TableHead> : <TableHead>Créé le</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(view === "bloques" ? blocked : items).map((d) => {
                  const raw = deals.find((x) => x.id === d.id)!;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-80">
                        <Link href={`/pipeline/${d.id}`} className="font-medium hover:underline">
                          {d.title}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.companyName ? `${d.companyName} · ` : ""}
                          {d.contactName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StageBadge stage={d.stage} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{d.amount ? formatEUR(d.amount) : "—"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 text-sm">
                          <UserAvatar user={d.owner} size="xs" /> {d.owner.firstName}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {d.nextActionAt ? (
                          <span className={d.blocked.includes("OVERDUE_ACTION") ? "font-medium text-rose-600" : ""}>
                            {d.nextActionType ? NEXT_ACTION_LABELS[d.nextActionType] : ""} · {formatSmart(d.nextActionAt, { tz: user.timezone })}
                          </span>
                        ) : (
                          <span className="font-medium text-amber-700">À planifier</span>
                        )}
                      </TableCell>
                      {view === "bloques" ? (
                        <TableCell className="text-xs text-rose-700">{d.blocked.map((b) => BLOCKED_REASON_LABELS[b]).join(" · ")}</TableCell>
                      ) : (
                        <TableCell className="text-sm text-muted-foreground">{formatDate(raw.createdAt)}</TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </>
  );
}
