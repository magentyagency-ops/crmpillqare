import Link from "next/link";
import { Check, Minus, ShoppingBag, Star } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName } from "@/lib/labels";
import { daysAgo, formatDate, formatRelative, nowDate, startOfMonthTz } from "@/lib/dates";
import { formatEUR, toNumber } from "@/lib/format";
import { EmptyHint, PageHeader, Pill, StatCard } from "@/components/common/ui-bits";
import { Pagination, SearchFilter, TabLinks } from "@/components/common/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Commandes" };
const PAGE_SIZE = 50;

const FIN: Record<string, string> = {
  PAID: "Payée",
  PARTIALLY_PAID: "Partiellement payée",
  PENDING: "En attente",
  AUTHORIZED: "Autorisée",
  REFUNDED: "Remboursée",
  PARTIALLY_REFUNDED: "Remb. partiel",
  VOIDED: "Annulée",
  EXPIRED: "Expirée",
};
const FUL: Record<string, string> = { FULFILLED: "Expédiée", UNFULFILLED: "À expédier", PARTIALLY_FULFILLED: "Partiellement expédiée", IN_PROGRESS: "En préparation", ON_HOLD: "En attente", SCHEDULED: "Planifiée" };

function Step({ done }: { done: boolean }) {
  return done ? <Check className="mx-auto size-4 text-emerald-600" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" />;
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ vue?: string; q?: string; page?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const views: Record<string, Prisma.OrderWhereInput> = {
    toutes: {},
    "a-suivre": { cancelledAt: null, OR: [{ installationDoneAt: null }, { onboardingDoneAt: null }], processedAt: { gte: daysAgo(60) } },
    insatisfaits: { satisfactionScore: { lte: 3 } },
    annulees: { cancelledAt: { not: null } },
  };
  const where: Prisma.OrderWhereInput = {
    ...(views[sp.vue ?? "toutes"] ?? {}),
    ...(sp.q
      ? {
          OR: [{ number: { contains: sp.q.trim(), mode: "insensitive" } }, { contact: contactSearchWhere(sp.q) }],
        }
      : {}),
  };
  const monthStart = startOfMonthTz(nowDate());
  const [orders, total, monthAgg, satAgg, conn] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { processedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }, items: true },
    }),
    db.order.count({ where }),
    db.order.aggregate({ where: { cancelledAt: null, processedAt: { gte: monthStart } }, _sum: { total: true }, _count: { _all: true } }),
    db.order.aggregate({ where: { satisfactionScore: { not: null } }, _avg: { satisfactionScore: true }, _count: { _all: true } }),
    db.shopifyConnection.findFirst({ select: { shopDomain: true, lastSyncAt: true, status: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Commandes"
        description={
          conn ? (
            <span>
              Boutique Shopify {conn.shopDomain} · synchronisée {conn.lastSyncAt ? formatRelative(conn.lastSyncAt) : "jamais"}
            </span>
          ) : (
            <span>
              Shopify non connecté —{" "}
              <Link href="/parametres/integrations" className="text-primary hover:underline">
                connecter la boutique
              </Link>
            </span>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Commandes ce mois" value={monthAgg._count._all} />
        <StatCard label="CA boutique ce mois (TTC)" value={formatEUR(monthAgg._sum.total, { compact: true })} />
        <StatCard label="Satisfaction moyenne" value={satAgg._avg.satisfactionScore ? `${satAgg._avg.satisfactionScore.toFixed(1).replace(".", ",")}/5` : "—"} hint={`${satAgg._count._all} réponse(s)`} />
        <StatCard label="Suivis à faire" value={await db.order.count({ where: views["a-suivre"]! })} tone="warning" href="/commandes?vue=a-suivre" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="vue"
          tabs={[
            { value: "toutes", label: "Toutes" },
            { value: "a-suivre", label: "Suivi après-achat à faire" },
            { value: "insatisfaits", label: "Clients insatisfaits" },
            { value: "annulees", label: "Annulées" },
          ]}
        />
        <SearchFilter placeholder="N° de commande, client…" />
      </div>
      <div className="overflow-hidden rounded-xl bg-card surface">
        {orders.length === 0 ? (
          <EmptyHint icon={ShoppingBag} title="Aucune commande">
            Les commandes Shopify remontent automatiquement (webhooks + synchronisation toutes les 30 minutes).
          </EmptyHint>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Commande</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Articles</TableHead>
                <TableHead className="text-right">Total TTC</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-center">Install.</TableHead>
                <TableHead className="text-center">Prise en main</TableHead>
                <TableHead className="text-center">Satisfaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className={o.cancelledAt ? "opacity-50" : ""}>
                  <TableCell>
                    <Link href={`/commandes/${o.id}`} className="font-medium hover:underline">
                      {o.number}
                    </Link>
                    <div className="text-xs text-muted-foreground">{formatDate(o.processedAt)}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/contacts/${o.contact.id}`} className="hover:underline">
                      {contactDisplayName(o.contact)}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">{o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatEUR(toNumber(o.total))}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {o.cancelledAt ? (
                        <Pill className="bg-rose-100 text-rose-700">Annulée</Pill>
                      ) : (
                        <>
                          <Pill className={o.financialStatus === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{FIN[o.financialStatus ?? ""] ?? o.financialStatus ?? "—"}</Pill>
                          <Pill className="bg-muted">{FUL[o.fulfillmentStatus ?? ""] ?? o.fulfillmentStatus ?? "—"}</Pill>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Step done={Boolean(o.installationDoneAt)} />
                  </TableCell>
                  <TableCell>
                    <Step done={Boolean(o.onboardingDoneAt)} />
                  </TableCell>
                  <TableCell className="text-center">
                    {o.satisfactionScore ? (
                      <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${o.satisfactionScore <= 3 ? "text-rose-600" : "text-amber-600"}`}>
                        <Star className="size-3.5 fill-current" /> {o.satisfactionScore}
                      </span>
                    ) : (
                      <Minus className="mx-auto size-4 text-muted-foreground/50" />
                    )}
                  </TableCell>
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
