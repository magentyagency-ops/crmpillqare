import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, ownerScope } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName } from "@/lib/labels";
import { daysAgo, formatDate, nowDate } from "@/lib/dates";
import { formatEUR, toNumber } from "@/lib/format";
import { EmptyHint, PageHeader, QuoteStatusBadge, StatCard, UserAvatar } from "@/components/common/ui-bits";
import { SearchFilter, SelectFilter, TabLinks } from "@/components/common/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { allWords, contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Devis" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ statut?: string; q?: string; owner?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await ownerScope(user);
  const statusFilter: Record<string, Prisma.QuoteWhereInput> = {
    tous: {},
    brouillons: { status: "DRAFT" },
    envoyes: { status: "SENT" },
    acceptes: { status: "ACCEPTED" },
    perdus: { status: { in: ["REFUSED", "EXPIRED"] } },
  };
  const where: Prisma.QuoteWhereInput = {
    ...scope,
    ...(statusFilter[sp.statut ?? "tous"] ?? {}),
    ...(sp.owner === "me" ? { ownerId: user.id } : sp.owner ? { ownerId: sp.owner } : {}),
    ...(sp.q
      ? {
          OR: [
            { number: { contains: sp.q.trim(), mode: "insensitive" } },
            allWords(sp.q, (w) => ({ title: { contains: w, mode: "insensitive" as const } })),
            { contact: contactSearchWhere(sp.q) },
            { company: { name: { contains: sp.q.trim(), mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [quotes, users, sentAgg, acceptedAgg] = await Promise.all([
    db.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        company: { select: { name: true } },
        deal: { select: { id: true, title: true } },
        owner: { select: { firstName: true, lastName: true, color: true } },
      },
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
    db.quote.aggregate({ where: { ...scope, status: "SENT" }, _sum: { totalHT: true }, _count: { _all: true } }),
    db.quote.aggregate({ where: { ...scope, status: "ACCEPTED", acceptedAt: { gte: daysAgo(90) } }, _sum: { totalHT: true }, _count: { _all: true } }),
  ]);
  const now = nowDate();
  return (
    <>
      <PageHeader
        title="Devis"
        description="Suivi des propositions commerciales : envoi, consultation, acceptation en ligne."
        actions={
          <Button asChild size="sm">
            <Link href="/devis/nouveau">
              <Plus /> Nouveau devis
            </Link>
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Devis en attente de réponse" value={sentAgg._count._all} hint={formatEUR(sentAgg._sum.totalHT, { compact: true }) + " HT"} />
        <StatCard label="Acceptés (90 j)" value={acceptedAgg._count._all} tone="success" hint={formatEUR(acceptedAgg._sum.totalHT, { compact: true }) + " HT"} />
        <StatCard label="Consultés en ligne" value={quotes.filter((q) => q.status === "SENT" && q.viewedAt).length} hint="parmi les devis envoyés" />
        <StatCard label="Expirent sous 7 jours" value={quotes.filter((q) => q.status === "SENT" && q.validUntil.getTime() - now.getTime() < 7 * 86_400_000).length} tone="warning" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="statut"
          tabs={[
            { value: "tous", label: "Tous" },
            { value: "brouillons", label: "Brouillons" },
            { value: "envoyes", label: "Envoyés" },
            { value: "acceptes", label: "Acceptés" },
            { value: "perdus", label: "Refusés / expirés" },
          ]}
        />
        <SearchFilter placeholder="N°, objet, client…" />
        <SelectFilter param="owner" placeholder="Tous les commerciaux" options={[{ value: "me", label: "Mes devis" }, ...users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
      </div>
      <div className="overflow-hidden rounded-xl bg-card surface">
        {quotes.length === 0 ? (
          <EmptyHint icon={FileText} title="Aucun devis" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Devis</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Total HT</TableHead>
                <TableHead className="text-right">Total TTC</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Envoyé</TableHead>
                <TableHead>Validité</TableHead>
                <TableHead>Commercial</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Link href={`/devis/${q.id}`} className="font-medium hover:underline">
                      {q.number}
                    </Link>
                    {q.title && <div className="max-w-64 truncate text-xs text-muted-foreground">{q.title}</div>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/contacts/${q.contact.id}`} className="hover:underline">
                      {q.company?.name ?? contactDisplayName(q.contact)}
                    </Link>
                    {q.deal && <div className="max-w-56 truncate text-xs text-muted-foreground">{q.deal.title}</div>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatEUR(toNumber(q.totalHT))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatEUR(toNumber(q.totalTTC))}</TableCell>
                  <TableCell>
                    <QuoteStatusBadge status={q.status} />
                    {q.status === "SENT" && q.viewedAt && <div className="text-[10px] text-sky-700">Consulté</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{q.sentAt ? formatDate(q.sentAt) : "—"}</TableCell>
                  <TableCell className={`text-sm ${q.status === "SENT" && q.validUntil < now ? "text-rose-600" : "text-muted-foreground"}`}>{formatDate(q.validUntil)}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      <UserAvatar user={q.owner} size="xs" /> {q.owner.firstName}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
