import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDaysTz, toDateInputValue } from "@/lib/dates";
import { contactDisplayName } from "@/lib/labels";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/common/ui-bits";
import { QuoteEditor } from "@/components/quotes/quote-editor";

export const metadata = { title: "Nouveau devis" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ contactId?: string; dealId?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getSettings("quotes");
  const deal = sp.dealId ? await db.deal.findUnique({ where: { id: sp.dealId }, select: { id: true, contactId: true, quantity: true, ownerId: true } }) : null;
  const contactId = sp.contactId ?? deal?.contactId ?? null;
  const contact = contactId ? await db.contact.findUnique({ where: { id: contactId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }) : null;
  // Préremplissage avec le pilulier et la quantité du dossier
  const product = deal?.quantity ? await db.product.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }) : null;
  return (
    <>
      <PageHeader back={{ href: "/devis", label: "Devis" }} title="Nouveau devis" />
      <QuoteEditor
        initial={{
          title: "",
          contact: contact ? { id: contact.id, label: contactDisplayName(contact), sublabel: contact.company?.name ?? null } : null,
          dealId: deal?.id ?? "",
          ownerId: deal?.ownerId ?? user.id,
          validUntil: toDateInputValue(addDaysTz(new Date(), settings.validityDays, user.timezone), user.timezone),
          globalDiscountPct: "0",
          notes: settings.defaultNotes,
          terms: settings.defaultTerms,
          items: product
            ? [
                {
                  productId: product.id,
                  name: product.name,
                  description: product.description ?? "",
                  quantity: String(deal?.quantity ?? 1),
                  unit: product.unit,
                  unitPriceHT: String(toNumber(product.unitPriceHT)),
                  discountPct: "0",
                  vatRate: String(toNumber(product.vatRate)),
                },
              ]
            : [],
        }}
      />
    </>
  );
}
