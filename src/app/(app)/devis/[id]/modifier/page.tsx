import { notFound, redirect } from "next/navigation";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { toDateInputValue } from "@/lib/dates";
import { contactDisplayName } from "@/lib/labels";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/common/ui-bits";
import { QuoteEditor } from "@/components/quotes/quote-editor";

export const metadata = { title: "Modifier le devis" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const quote = await db.quote.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } }, contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } } },
  });
  if (!quote) notFound();
  if (!(await canView(await requireUser(), [quote.ownerId]))) notFound();
  if (quote.status !== "DRAFT") redirect(`/devis/${id}`);
  return (
    <>
      <PageHeader back={{ href: `/devis/${id}`, label: `Devis ${quote.number}` }} title={`Modifier le devis ${quote.number}`} />
      <QuoteEditor
        initial={{
          id: quote.id,
          title: quote.title ?? "",
          contact: { id: quote.contact.id, label: contactDisplayName(quote.contact), sublabel: quote.contact.company?.name ?? null },
          dealId: quote.dealId ?? "",
          ownerId: quote.ownerId,
          validUntil: toDateInputValue(quote.validUntil, user.timezone),
          globalDiscountPct: String(toNumber(quote.globalDiscountPct)),
          notes: quote.notes ?? "",
          terms: quote.terms ?? "",
          items: quote.items.map((i) => ({
            productId: i.productId ?? "",
            name: i.name,
            description: i.description ?? "",
            quantity: String(toNumber(i.quantity)),
            unit: i.unit,
            unitPriceHT: String(toNumber(i.unitPriceHT)),
            discountPct: String(toNumber(i.discountPct)),
            vatRate: String(toNumber(i.vatRate)),
          })),
        }}
      />
    </>
  );
}
