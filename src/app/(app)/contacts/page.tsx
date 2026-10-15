import Link from "next/link";
import { Users } from "lucide-react";
import { requireUser, ownerScope } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName, SOURCE_LABELS } from "@/lib/labels";
import { formatRelative } from "@/lib/dates";
import { formatPhone } from "@/lib/normalize";
import { ContactStatusBadge, EmptyHint, PageHeader, SegmentBadge, StageBadge, UserAvatar } from "@/components/common/ui-bits";
import { Pagination, SearchFilter, SelectFilter, TabLinks } from "@/components/common/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton, ImportButton, NewContactButton } from "./contacts-client";
import { contactsWhere, type ContactSearch as Search } from "@/lib/contacts-query";

export const metadata = { title: "Contacts" };

const PAGE_SIZE = 50;


export default async function ContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const scope = (await ownerScope(user)) as Record<string, string>;
  const where = contactsWhere(sp, user.id, scope);
  const [contacts, total, users, segments, counts] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: [{ lastActivityAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { id: true, name: true } },
        segment: { select: { name: true, color: true } },
        owner: { select: { firstName: true, lastName: true, color: true } },
        deals: { where: { stage: { notIn: ["WON", "LOST"] }, archivedAt: null }, select: { id: true, stage: true }, take: 1, orderBy: { updatedAt: "desc" } },
      },
    }),
    db.contact.count({ where }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
    db.segment.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    Promise.all([
      db.contact.count({ where: { ...scope, archivedAt: null } }),
      db.contact.count({ where: { ...scope, archivedAt: null, status: "PROSPECT" } }),
      db.contact.count({ where: { ...scope, archivedAt: null, status: "CUSTOMER" } }),
    ]),
  ]);
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Prospects et clients B2B / B2C, classés par cible."
        actions={
          <>
            <ImportButton />
            <ExportButton query={query} />
            <NewContactButton />
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="statut"
          tabs={[
            { value: "tous", label: "Tous", count: counts[0] },
            { value: "prospects", label: "Prospects", count: counts[1] },
            { value: "clients", label: "Clients", count: counts[2] },
            { value: "archives", label: "Archivés" },
          ]}
        />
        <SearchFilter placeholder="Nom, email, téléphone, ville…" />
        <SelectFilter param="segment" placeholder="Toutes les cibles" options={[...segments.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "Sans cible" }]} />
        <SelectFilter param="kind" placeholder="B2B et B2C" options={[{ value: "B2B", label: "Professionnels (B2B)" }, { value: "B2C", label: "Particuliers (B2C)" }]} />
        <SelectFilter param="owner" placeholder="Tous les commerciaux" options={[{ value: "me", label: "Mes contacts" }, ...users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
        <SelectFilter param="source" placeholder="Toutes les origines" options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="overflow-hidden rounded-xl bg-card surface">
        {contacts.length === 0 ? (
          <EmptyHint icon={Users} title="Aucun contact trouvé">
            Créez un contact, importez un fichier CSV ou connectez le formulaire du site et Shopify.
          </EmptyHint>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Cible</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Dossier</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Commercial</TableHead>
                <TableHead>Dernière activité</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-64">
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                      {contactDisplayName(c)}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{c.email ?? c.jobTitle ?? ""}</div>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-sm">
                    {c.company ? (
                      <Link href={`/organisations/${c.company.id}`} className="hover:underline">
                        {c.company.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{c.kind === "B2C" ? "Particulier" : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SegmentBadge segment={c.segment} />
                  </TableCell>
                  <TableCell>
                    <ContactStatusBadge status={c.status} />
                    {c.doNotContact && <span className="ml-1 text-[10px] text-rose-600">Ne pas contacter</span>}
                  </TableCell>
                  <TableCell>{c.deals[0] ? <Link href={`/pipeline/${c.deals[0].id}`}><StageBadge stage={c.deals[0].stage} /></Link> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{formatPhone(c.phone)}</a> : "—"}</TableCell>
                  <TableCell>{c.owner ? <span className="flex items-center gap-1.5 text-sm"><UserAvatar user={c.owner} size="xs" />{c.owner.firstName}</span> : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.lastActivityAt ? formatRelative(c.lastActivityAt) : "—"}</TableCell>
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
