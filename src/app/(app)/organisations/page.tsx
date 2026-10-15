import Link from "next/link";
import { Building2 } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { formatEUR, toNumber } from "@/lib/format";
import { formatRelative } from "@/lib/dates";
import { EmptyHint, PageHeader, SegmentBadge, UserAvatar } from "@/components/common/ui-bits";
import { Pagination, SearchFilter, SelectFilter } from "@/components/common/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCompanyButton } from "./companies-client";

export const metadata = { title: "Organisations" };
const PAGE_SIZE = 50;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string; owner?: string; page?: string; archives?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: Prisma.CompanyWhereInput = {
    archivedAt: sp.archives ? { not: null } : null,
    ...(sp.segment ? { segmentId: sp.segment } : {}),
    ...(sp.owner === "me" ? { ownerId: user.id } : sp.owner ? { ownerId: sp.owner } : {}),
    ...(sp.q
      ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { city: { contains: sp.q, mode: "insensitive" } }, { postalCode: { startsWith: sp.q } }] }
      : {}),
  };
  const [companies, total, segments, users] = await Promise.all([
    db.company.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        segment: { select: { name: true, color: true } },
        owner: { select: { firstName: true, lastName: true, color: true } },
        _count: { select: { contacts: true } },
        deals: { where: { stage: { notIn: ["WON", "LOST"] }, archivedAt: null }, select: { amount: true } },
        activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    }),
    db.company.count({ where }),
    db.segment.findMany({ where: { active: true, kind: "B2B" }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
  ]);

  return (
    <>
      <PageHeader title="Organisations" description="Pharmacies, établissements, services et partenaires (B2B)." actions={<NewCompanyButton />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchFilter placeholder="Nom, ville, code postal…" />
        <SelectFilter param="segment" placeholder="Toutes les cibles" options={segments.map((s) => ({ value: s.id, label: s.name }))} />
        <SelectFilter param="owner" placeholder="Tous les commerciaux" options={[{ value: "me", label: "Mes organisations" }, ...users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
        <SelectFilter param="archives" placeholder="Actives" options={[{ value: "1", label: "Archivées" }]} />
      </div>
      <div className="overflow-hidden rounded-xl bg-card surface">
        {companies.length === 0 ? (
          <EmptyHint icon={Building2} title="Aucune organisation" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Cible</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead className="text-right">Dossiers en cours</TableHead>
                <TableHead className="text-right">Capacité</TableHead>
                <TableHead>Commercial</TableHead>
                <TableHead>Dernière activité</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/organisations/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{[c.postalCode, c.city].filter(Boolean).join(" ")}</div>
                  </TableCell>
                  <TableCell>
                    <SegmentBadge segment={c.segment} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c._count.contacts}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.deals.length ? `${c.deals.length} · ${formatEUR(c.deals.reduce((a, d) => a + toNumber(d.amount), 0), { compact: true })}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.capacity ?? "—"}</TableCell>
                  <TableCell>{c.owner ? <span className="flex items-center gap-1.5 text-sm"><UserAvatar user={c.owner} size="xs" />{c.owner.firstName}</span> : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.activities[0] ? formatRelative(c.activities[0].occurredAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </div>
    </>
  );
}
