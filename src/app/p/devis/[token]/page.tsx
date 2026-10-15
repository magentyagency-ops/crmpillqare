import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { contactDisplayName } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatEUR, toNumber } from "@/lib/format";
import { PublicShell } from "@/components/public/public-shell";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { Button } from "@/components/ui/button";
import { QuoteResponse, ViewTracker } from "./quote-response";

export const metadata = { title: "Votre devis", robots: { index: false } };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await db.quote.findUnique({
    where: { publicToken: token },
    include: { items: { orderBy: { position: "asc" } }, contact: true, company: true, owner: { select: { firstName: true, lastName: true, email: true, phone: true } } },
  });
  if (!quote || quote.status === "DRAFT") notFound();
  const company = await getSettings("company");
  const expired = quote.status === "EXPIRED" || (quote.status === "SENT" && quote.validUntil < new Date());

  return (
    <PublicShell wide>
      <ViewTracker token={token} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Devis n° {quote.number}</h1>
          <p className="text-sm text-muted-foreground">
            {formatEUR(toNumber(quote.totalTTC))} TTC · valable jusqu&apos;au {formatDate(quote.validUntil, "d MMMM yyyy")}
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={`/api/public/devis/${token}/pdf`}>
            <Download /> Télécharger le PDF
          </a>
        </Button>
      </div>
      <div className="mb-6">
        <QuoteResponse
          token={token}
          status={quote.status}
          expired={expired}
          acceptedByName={quote.acceptedByName}
          acceptedAt={quote.acceptedAt ? formatDate(quote.acceptedAt, "d MMMM yyyy") : null}
          ownerName={`${quote.owner.firstName} ${quote.owner.lastName}`}
          ownerContact={[quote.owner.email, quote.owner.phone].filter(Boolean).join(" · ")}
        />
      </div>
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
    </PublicShell>
  );
}
