import Link from "next/link";
import { notFound } from "next/navigation";
import { FlaskConical, FileText, Globe, Mail, MapPin, Phone } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatEUR, toNumber } from "@/lib/format";
import { formatPhone } from "@/lib/normalize";
import { KeyValue, PageHeader, QuoteStatusBadge, SectionCard, SegmentBadge, StageBadge, TrialStatusBadge, UserAvatar, ContactStatusBadge } from "@/components/common/ui-bits";
import { ActivityTimeline, timelineInclude } from "@/components/timeline/activity-timeline";
import { NoteComposer } from "@/components/timeline/note-composer";
import { CompanyActions } from "../companies-client";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const company = await db.company.findUnique({
    where: { id },
    include: {
      segment: true,
      owner: { select: { firstName: true, lastName: true, color: true } },
      contacts: { where: { archivedAt: null }, orderBy: { lastName: "asc" } },
      deals: { orderBy: { updatedAt: "desc" }, include: { owner: { select: { firstName: true, lastName: true, color: true } } } },
      quotes: { orderBy: { createdAt: "desc" } },
      trials: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!company) notFound();
  if (!(await canView(await requireUser(), [company.ownerId, ...company.contacts.map((c) => c.ownerId), ...company.deals.map((d) => d.ownerId)]))) notFound();
  const contactIds = company.contacts.map((c) => c.id);
  const activities = await db.activity.findMany({
    where: { OR: [{ companyId: id }, { contactId: { in: contactIds } }] },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: timelineInclude,
  });
  const openValue = company.deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST").reduce((a, d) => a + toNumber(d.amount), 0);
  const wonValue = company.deals.filter((d) => d.stage === "WON").reduce((a, d) => a + toNumber(d.amount), 0);

  return (
    <>
      <PageHeader
        back={{ href: "/organisations", label: "Organisations" }}
        title={company.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SegmentBadge segment={company.segment} />
            {company.city && <span>{company.city}</span>}
            {company.owner && (
              <span className="inline-flex items-center gap-1">
                <UserAvatar user={company.owner} size="xs" /> {company.owner.firstName}
              </span>
            )}
            <span>
              En cours : <strong>{formatEUR(openValue, { compact: true })}</strong> · Signé : <strong>{formatEUR(wonValue, { compact: true })}</strong>
            </span>
          </span>
        }
        actions={
          <CompanyActions
            archived={Boolean(company.archivedAt)}
            value={{
              id: company.id,
              name: company.name,
              segmentId: company.segmentId ?? "",
              ownerId: company.ownerId ?? user.id,
              siret: company.siret ?? "",
              website: company.website ?? "",
              email: company.email ?? "",
              phone: company.phone ?? "",
              address: company.address ?? "",
              postalCode: company.postalCode ?? "",
              city: company.city ?? "",
              capacity: company.capacity ? String(company.capacity) : "",
              employees: company.employees ? String(company.employees) : "",
              notes: company.notes ?? "",
            }}
          />
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title={`Contacts (${company.contacts.length})`}>
            {company.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun contact.</p>
            ) : (
              <ul className="divide-y">
                {company.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <Link href={`/contacts/${c.id}`} className="min-w-40 flex-1 font-medium hover:underline">
                      {contactDisplayName(c)}
                      {c.jobTitle && <span className="block text-xs font-normal text-muted-foreground">{c.jobTitle}</span>}
                    </Link>
                    <ContactStatusBadge status={c.status} />
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="text-primary hover:underline">
                        {formatPhone(c.phone)}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                        {c.email}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Historique de l'organisation">
            <NoteComposer companyId={company.id} />
            <ActivityTimeline items={activities} showContact />
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Informations">
            <div className="mb-2 space-y-1.5 text-sm">
              {company.phone && (
                <a href={`tel:${company.phone}`} className="flex items-center gap-2 text-primary hover:underline">
                  <Phone className="size-3.5" /> {formatPhone(company.phone)}
                </a>
              )}
              {company.email && (
                <a href={`mailto:${company.email}`} className="flex items-center gap-2 text-primary hover:underline">
                  <Mail className="size-3.5" /> {company.email}
                </a>
              )}
              {company.website && (
                <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                  <Globe className="size-3.5" /> {company.website}
                </a>
              )}
              {(company.address || company.city) && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5" />
                  {[company.address, [company.postalCode, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
            <dl className="border-t pt-2">
              <KeyValue label="SIRET">{company.siret}</KeyValue>
              <KeyValue label="Capacité">{company.capacity ? `${company.capacity} lits / patients` : null}</KeyValue>
              <KeyValue label="Salariés">{company.employees}</KeyValue>
              <KeyValue label="Créée le">{formatDate(company.createdAt)}</KeyValue>
            </dl>
            {company.notes && <p className="mt-2 rounded-md bg-muted p-2 text-sm whitespace-pre-line">{company.notes}</p>}
          </SectionCard>
          <SectionCard title="Dossiers">
            {company.deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun dossier.</p>
            ) : (
              <ul className="space-y-1">
                {company.deals.map((d) => (
                  <li key={d.id}>
                    <Link href={`/pipeline/${d.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      <span className="flex-1 truncate">{d.title}</span>
                      {d.amount && <span className="text-xs tabular-nums">{formatEUR(d.amount, { compact: true })}</span>}
                      <StageBadge stage={d.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Devis">
            {company.quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun devis.</p>
            ) : (
              <ul className="space-y-1">
                {company.quotes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/devis/${q.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      <FileText className="size-4" />
                      <span className="flex-1">{q.number}</span>
                      <span className="tabular-nums">{formatEUR(q.totalHT)}</span>
                      <QuoteStatusBadge status={q.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Essais / pilotes">
            {company.trials.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun essai.</p>
            ) : (
              <ul className="space-y-1">
                {company.trials.map((t) => (
                  <li key={t.id}>
                    <Link href={`/essais/${t.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                      <FlaskConical className="size-4" />
                      <span className="flex-1 truncate">{t.title}</span>
                      <TrialStatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
