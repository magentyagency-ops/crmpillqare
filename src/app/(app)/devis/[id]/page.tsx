import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { contactDisplayName } from "@/lib/labels";
import { formatDateTime } from "@/lib/dates";
import { toNumber } from "@/lib/format";
import { quotePublicUrl } from "@/lib/email/vars";
import { PageHeader, QuoteStatusBadge, SectionCard, StageBadge } from "@/components/common/ui-bits";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { QuoteActions } from "./quote-actions";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      contact: true,
      company: true,
      deal: { select: { id: true, title: true, stage: true } },
      owner: { select: { firstName: true, lastName: true, email: true, phone: true } },
    },
  });
  if (!quote) notFound();
  if (!(await canView(await requireUser(), [quote.ownerId, quote.contact.ownerId]))) notFound();
  const [company, activities] = await Promise.all([
    getSettings("company"),
    db.activity.findMany({ where: { quoteId: id }, orderBy: { occurredAt: "desc" }, include: timelineInclude }),
  ]);
  const tz = user.timezone;

  return (
    <>
      <PageHeader
        back={{ href: "/devis", label: "Devis" }}
        title={`Devis ${quote.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <QuoteStatusBadge status={quote.status} />
            <Link href={`/contacts/${quote.contactId}`} className="hover:underline">
              {quote.company?.name ?? contactDisplayName(quote.contact)}
            </Link>
            {quote.deal && (
              <>
                ·{" "}
                <Link href={`/pipeline/${quote.deal.id}`} className="hover:underline">
                  {quote.deal.title}
                </Link>
                <StageBadge stage={quote.deal.stage} />
              </>
            )}
          </span>
        }
        actions={<QuoteActions id={quote.id} status={quote.status} publicUrl={quotePublicUrl(quote.publicToken)} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <QuoteDocument
            company={company}
            quote={{
              number: quote.number,
              title: quote.title,
              issueDate: quote.issueDate,
              validUntil: quote.validUntil,
              notes: quote.notes,
              terms: quote.terms,
              globalDiscountPct: toNumber(quote.globalDiscountPct),
              owner: quote.owner,
              client: {
                companyName: quote.company?.name ?? null,
                contactName: contactDisplayName(quote.contact),
                address: quote.company?.address ?? quote.contact.address,
                postalCode: quote.company?.postalCode ?? quote.contact.postalCode,
                city: quote.company?.city ?? quote.contact.city,
                email: quote.contact.email,
                phone: quote.contact.phone,
              },
              items: quote.items.map((i) => ({
                name: i.name,
                description: i.description,
                quantity: toNumber(i.quantity),
                unit: i.unit,
                unitPriceHT: toNumber(i.unitPriceHT),
                discountPct: toNumber(i.discountPct),
                vatRate: toNumber(i.vatRate),
              })),
            }}
          />
        </div>
        <div className="space-y-6">
          <SectionCard title="Suivi">
            <ol className="space-y-2 text-sm">
              <li>Créé le {formatDateTime(quote.createdAt, tz)}</li>
              {quote.sentAt && <li>Envoyé le {formatDateTime(quote.sentAt, tz)}</li>}
              {quote.viewedAt && <li className="text-sky-700">Consulté en ligne le {formatDateTime(quote.viewedAt, tz)}</li>}
              {quote.acceptedAt && (
                <li className="font-medium text-emerald-700">
                  Accepté le {formatDateTime(quote.acceptedAt, tz)}
                  {quote.acceptedByName ? ` par ${quote.acceptedByName}` : ""}
                </li>
              )}
              {quote.refusedAt && (
                <li className="font-medium text-rose-700">
                  Refusé le {formatDateTime(quote.refusedAt, tz)}
                  {quote.refusalReason ? ` — « ${quote.refusalReason} »` : ""}
                </li>
              )}
              {quote.status === "EXPIRED" && <li className="text-amber-700">Expiré</li>}
            </ol>
          </SectionCard>
          <SectionCard title="Historique">
            <ActivityTimeline items={activities} showDeal={false} />
          </SectionCard>
        </div>
      </div>
    </>
  );
}
