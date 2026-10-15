import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName } from "@/lib/labels";
import { toDateInputValue } from "@/lib/dates";
import { PageHeader } from "@/components/common/ui-bits";
import { TrialForm } from "./trial-form";

export const metadata = { title: "Nouvel essai / pilote" };

export default async function NewTrialPage({ searchParams }: { searchParams: Promise<{ contactId?: string; dealId?: string; companyId?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const deal = sp.dealId ? await db.deal.findUnique({ where: { id: sp.dealId }, select: { contactId: true, companyId: true } }) : null;
  const contactId = sp.contactId ?? deal?.contactId ?? null;
  const contact = contactId ? await db.contact.findUnique({ where: { id: contactId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyId: true, company: { select: { name: true } } } }) : null;
  return (
    <>
      <PageHeader back={{ href: "/essais", label: "Essais & pilotes" }} title="Nouvel essai / pilote" description="Matériel prêté, dates, objectifs et jalons de suivi." />
      <TrialForm
        initialContact={contact ? { id: contact.id, label: contactDisplayName(contact), sublabel: contact.company?.name ?? null } : null}
        initialDealId={sp.dealId ?? null}
        companyId={sp.companyId ?? deal?.companyId ?? contact?.companyId ?? null}
        today={toDateInputValue(new Date(), user.timezone)}
      />
    </>
  );
}
