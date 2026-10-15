import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ownerScope } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactsWhere } from "@/lib/contacts-query";
import { CONTACT_STATUS_LABELS, SOURCE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/dates";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export CSV des contacts (filtres identiques à la liste), compatible Excel (UTF-8 BOM, « ; »). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const scope = (await ownerScope(user)) as Record<string, string>;
  const contacts = await db.contact.findMany({
    where: contactsWhere(sp, user.id, scope),
    orderBy: { createdAt: "desc" },
    take: 20_000,
    include: {
      company: { select: { name: true } },
      segment: { select: { name: true } },
      owner: { select: { firstName: true, lastName: true } },
      deals: { where: { archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 1, select: { stage: true, amount: true } },
    },
  });
  const header = ["Prénom", "Nom", "Email", "Téléphone", "Type", "Statut", "Organisation", "Fonction", "Cible", "Commercial", "Origine", "Code postal", "Ville", "Étape du dossier", "Montant", "Étiquettes", "Créé le"];
  const rows = contacts.map((c) => [
    c.firstName,
    c.lastName,
    c.email,
    c.phone,
    c.kind,
    CONTACT_STATUS_LABELS[c.status],
    c.company?.name,
    c.jobTitle,
    c.segment?.name,
    c.owner ? `${c.owner.firstName} ${c.owner.lastName}` : "",
    SOURCE_LABELS[c.source],
    c.postalCode,
    c.city,
    c.deals[0] ? STAGE_LABELS[c.deals[0].stage] : "",
    c.deals[0]?.amount?.toString().replace(".", ",") ?? "",
    c.tags.join(", "),
    formatDate(c.createdAt, "dd/MM/yyyy"),
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-pillqare-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
