import Link from "next/link";
import { FlaskConical, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, ownerScope } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { trialNextDeadline } from "@/lib/trials";
import { contactDisplayName } from "@/lib/labels";
import { formatDate, formatSmart } from "@/lib/dates";
import { EmptyHint, PageHeader, StatCard, TrialStatusBadge, UserAvatar } from "@/components/common/ui-bits";
import { SearchFilter, TabLinks } from "@/components/common/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Essais & pilotes" };

export default async function TrialsPage({ searchParams }: { searchParams: Promise<{ statut?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await ownerScope(user);
  const statusFilter: Record<string, Prisma.TrialWhereInput> = {
    actifs: { status: { in: ["PLANNED", "EQUIPMENT_SENT", "IN_PROGRESS", "EVALUATION"] } },
    convertis: { status: "CONVERTED" },
    termines: { status: { in: ["ENDED", "CANCELLED"] } },
    tous: {},
  };
  const where: Prisma.TrialWhereInput = {
    ...scope,
    ...(statusFilter[sp.statut ?? "actifs"] ?? {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { company: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [trials, counts] = await Promise.all([
    db.trial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        owner: { select: { firstName: true, lastName: true, color: true } },
        items: true,
        checkpoints: { orderBy: { dueAt: "asc" } },
      },
    }),
    Promise.all([
      db.trial.count({ where: { ...scope, ...statusFilter.actifs } }),
      db.trial.count({ where: { ...scope, status: "CONVERTED" } }),
      db.trial.count({ where: { ...scope, status: { in: ["ENDED", "CANCELLED", "CONVERTED"] } } }),
      db.trialItem.aggregate({ where: { trial: { ...scope, status: { in: ["EQUIPMENT_SENT", "IN_PROGRESS", "EVALUATION"] } }, returnedAt: null }, _sum: { quantity: true } }),
    ]),
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Essais & pilotes"
        description="Matériel envoyé, dates, retours et prochaines échéances."
        actions={
          <Button asChild size="sm">
            <Link href="/essais/nouveau">
              <Plus /> Nouvel essai
            </Link>
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Essais en cours" value={counts[0]} />
        <StatCard label="Matériel chez les clients" value={counts[3]._sum.quantity ?? 0} hint="unités non retournées" />
        <StatCard label="Convertis" value={counts[1]} tone="success" />
        <StatCard label="Taux de conversion" value={counts[2] ? `${Math.round((counts[1] / counts[2]) * 100)} %` : "—"} hint="essais terminés" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="statut"
          tabs={[
            { value: "actifs", label: "En cours" },
            { value: "convertis", label: "Convertis" },
            { value: "termines", label: "Terminés / annulés" },
            { value: "tous", label: "Tous" },
          ]}
        />
        <SearchFilter placeholder="Essai, organisation…" />
      </div>
      <div className="overflow-hidden rounded-xl bg-card surface">
        {trials.length === 0 ? (
          <EmptyHint icon={FlaskConical} title="Aucun essai" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Essai</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Matériel</TableHead>
                <TableHead>Prochaine échéance</TableHead>
                <TableHead>Responsable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trials.map((t) => {
                const next = trialNextDeadline(t);
                const overdue = next && next.at < now;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/essais/${t.id}`} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{t.company?.name ?? (t.contact ? contactDisplayName(t.contact) : "")}</div>
                    </TableCell>
                    <TableCell>
                      <TrialStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.startDate ? formatDate(t.startDate, "d MMM") : "?"} → {t.endDate ? formatDate(t.endDate, "d MMM yyyy") : "?"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.items.reduce((a, i) => a + i.quantity, 0)} unité(s)
                      {t.items.some((i) => i.returnExpected && i.shippedAt && !i.returnedAt) && <div className="text-[11px] text-amber-700">à récupérer</div>}
                    </TableCell>
                    <TableCell className={`text-sm ${overdue ? "font-medium text-rose-600" : ""}`}>{next ? `${next.label} · ${formatSmart(next.at, { withTime: false, tz: user.timezone })}` : "—"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <UserAvatar user={t.owner} size="xs" /> {t.owner.firstName}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
