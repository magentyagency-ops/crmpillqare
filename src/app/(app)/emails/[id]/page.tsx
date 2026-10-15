import { notFound } from "next/navigation";
import { canView, requireUser } from "@/lib/auth/guards";
import { contactDisplayName } from "@/lib/labels";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { PageHeader, SectionCard } from "@/components/common/ui-bits";
import { EmailReader } from "./email-reader";

export const metadata = { title: "Email" };

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const email = await db.emailMessage.findUnique({
    where: { id },
    select: { id: true, contactId: true, userId: true, direction: true, subject: true, fromEmail: true, fromName: true, toEmails: true, ccEmails: true, sentAt: true, handledAt: true, attachments: true, dealId: true, contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true } } },
  });
  if (!email) notFound();
  if (email.contact) {
    if (email.userId !== user.id && !(await canView(user, [email.contact.ownerId]))) notFound();
  } else if (email.userId !== user.id) notFound(); // Email hors CRM : privé, réservé au propriétaire de la boîte

  const attachments = Array.isArray(email.attachments) ? (email.attachments as { filename: string }[]) : [];
  return (
    <>
      <PageHeader title={email.subject || "(sans objet)"} back={{ href: "/emails", label: "Emails" }} />
      <SectionCard bodyClassName="p-0">
        <EmailReader
          email={{
            id: email.id,
            inbound: email.direction === "INBOUND",
            subject: email.subject,
            fromEmail: email.fromEmail,
            fromName: email.fromName,
            to: email.toEmails.join(", "),
            cc: email.ccEmails.join(", "),
            date: formatDateTime(email.sentAt, user.timezone),
            handled: Boolean(email.handledAt),
            attachments: attachments.map((a) => a.filename),
            contact: email.contact ? { id: email.contact.id, name: contactDisplayName(email.contact), email: email.contact.email } : null,
            dealId: email.dealId,
          }}
        />
      </SectionCard>
    </>
  );
}
