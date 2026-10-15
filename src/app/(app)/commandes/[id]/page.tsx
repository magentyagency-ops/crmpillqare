import Link from "next/link";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName, STEP_RUN_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime, formatSmart } from "@/lib/dates";
import { formatEUR, toNumber } from "@/lib/format";
import { satisfactionUrl } from "@/lib/email/vars";
import { KeyValue, PageHeader, SectionCard } from "@/components/common/ui-bits";
import { TaskRow } from "@/components/tasks/task-row";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { OrderFollowUp } from "./order-client";

type Address = { firstName?: string | null; lastName?: string | null; company?: string | null; address1?: string | null; address2?: string | null; zip?: string | null; city?: string | null; country?: string | null; phone?: string | null };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true } },
      items: true,
      tasks: {
        orderBy: { dueAt: "asc" },
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, deal: { select: { id: true, title: true } } },
      },
      enrollments: { include: { sequence: { select: { name: true } }, runs: { orderBy: { position: "asc" }, include: { step: { select: { subject: true, taskTitle: true } } } } } },
    },
  });
  if (!order) notFound();
  if (!(await canView(await requireUser(), [order.contact?.ownerId]))) notFound();
  const activities = await db.activity.findMany({ where: { orderId: id }, orderBy: { occurredAt: "desc" }, include: timelineInclude });
  const addr = order.shippingAddress as Address | null;
  const tz = user.timezone;
  return (
    <>
      <PageHeader
        back={{ href: "/commandes", label: "Commandes" }}
        title={`Commande ${order.number}`}
        description={
          <span>
            {formatDateTime(order.processedAt, tz)} ·{" "}
            <Link href={`/contacts/${order.contact.id}`} className="font-medium hover:underline">
              {contactDisplayName(order.contact)}
            </Link>{" "}
            · {formatEUR(toNumber(order.total))} TTC {order.cancelledAt && <span className="font-medium text-rose-600">· annulée</span>}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Articles">
            <table className="w-full text-sm">
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-b last:border-b-0">
                    <td className="py-2">
                      {i.title}
                      {i.variantTitle && <span className="text-muted-foreground"> — {i.variantTitle}</span>}
                      {i.sku && <div className="text-xs text-muted-foreground">SKU {i.sku}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {i.quantity} × {formatEUR(toNumber(i.unitPrice))}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatEUR(toNumber(i.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 ml-auto w-64 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Sous-total</dt><dd className="tabular-nums">{formatEUR(toNumber(order.subtotal))}</dd></div>
              {toNumber(order.totalDiscount) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Remises</dt><dd className="tabular-nums">- {formatEUR(toNumber(order.totalDiscount))}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Livraison</dt><dd className="tabular-nums">{formatEUR(toNumber(order.totalShipping))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">dont TVA</dt><dd className="tabular-nums">{formatEUR(toNumber(order.totalTax))}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total TTC</dt><dd className="tabular-nums">{formatEUR(toNumber(order.total))}</dd></div>
            </dl>
          </SectionCard>
          <SectionCard title="Suivi après-achat" description="Installation, prise en main et satisfaction.">
            <OrderFollowUp
              orderId={order.id}
              installation={Boolean(order.installationDoneAt)}
              onboarding={Boolean(order.onboardingDoneAt)}
              started={Boolean(order.postPurchaseStartedAt)}
              cancelled={Boolean(order.cancelledAt)}
            />
            {order.enrollments.map((e) => (
              <div key={e.id} className="mt-3 rounded-lg border p-3">
                <div className="mb-1 text-sm font-medium">{e.sequence.name}</div>
                <ol className="space-y-1 text-xs">
                  {e.runs.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="truncate">{r.type === "EMAIL" ? r.step.subject || "Email" : r.step.taskTitle?.replace(/\{\{[^}]+\}\}/g, "").trim()}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {STEP_RUN_STATUS_LABELS[r.status]} · {formatSmart(r.executedAt ?? r.scheduledAt, { tz })}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {order.tasks.length > 0 && (
              <div className="-mx-2 mt-3 divide-y">
                {order.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} showContact={false} tz={tz} />
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title="Historique">
            <ActivityTimeline items={activities} />
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Satisfaction">
            {order.satisfactionScore ? (
              <div>
                <div className="flex items-center gap-1 text-amber-500">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`size-5 ${n <= order.satisfactionScore! ? "fill-current" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
                {order.satisfactionComment && <p className="mt-2 text-sm whitespace-pre-line">« {order.satisfactionComment} »</p>}
                <p className="mt-1 text-xs text-muted-foreground">Réponse du {formatDate(order.satisfactionAt)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Pas encore de réponse au questionnaire.</p>
            )}
            <p className="mt-3 text-xs break-all text-muted-foreground">
              Lien du questionnaire : <a className="text-primary hover:underline" href={satisfactionUrl(order.satisfactionToken)} target="_blank" rel="noreferrer">{satisfactionUrl(order.satisfactionToken)}</a>
            </p>
          </SectionCard>
          <SectionCard title="Livraison">
            {addr ? (
              <div className="text-sm">
                <div>{[addr.firstName, addr.lastName].filter(Boolean).join(" ")}</div>
                {addr.company && <div>{addr.company}</div>}
                <div>{[addr.address1, addr.address2].filter(Boolean).join(", ")}</div>
                <div>{[addr.zip, addr.city].filter(Boolean).join(" ")}</div>
                {addr.phone && <div className="text-muted-foreground">{addr.phone}</div>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            <dl className="mt-3 border-t pt-2">
              <KeyValue label="Paiement">{order.financialStatus}</KeyValue>
              <KeyValue label="Expédition">{order.fulfillmentStatus}</KeyValue>
              <KeyValue label="Payée le">{order.paidAt ? formatDate(order.paidAt) : null}</KeyValue>
              <KeyValue label="Expédiée le">{order.fulfilledAt ? formatDate(order.fulfilledAt) : null}</KeyValue>
              <KeyValue label="Shopify">{order.shopifyOrderId ? `#${order.shopifyOrderId}` : "Saisie manuelle"}</KeyValue>
            </dl>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
