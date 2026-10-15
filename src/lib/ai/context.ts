import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { contactDisplayName, SOURCE_LABELS, STAGE_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatEUR, truncate } from "@/lib/format";
import { stripQuotedReply } from "@/lib/email/text";
import { bookingUrl } from "@/lib/email/vars";

/**
 * Contexte d'un contact pour l'IA : fiche, organisation, cible, dossier en cours, devis, RDV,
 * et derniers échanges (emails, appels, notes, comptes rendus). Texte compact et factuel.
 */
export async function buildContactContext(opts: { contactId?: string | null; dealId?: string | null; userId: string }) {
  const [settings, user] = await Promise.all([
    getSettings("ai"),
    db.user.findUnique({ where: { id: opts.userId }, select: { firstName: true, lastName: true, jobTitle: true, phone: true, bookingSlug: true } }),
  ]);
  let contactId = opts.contactId ?? null;
  const deal = opts.dealId
    ? await db.deal.findUnique({ where: { id: opts.dealId }, include: { lostReason: { select: { label: true } } } })
    : contactId
      ? await db.deal.findFirst({ where: { contactId, archivedAt: null }, orderBy: [{ stage: "asc" }, { updatedAt: "desc" }], include: { lostReason: { select: { label: true } } } })
      : null;
  contactId = contactId ?? deal?.contactId ?? null;

  const contact = contactId
    ? await db.contact.findUnique({
        where: { id: contactId },
        include: { company: { select: { name: true, city: true, capacity: true } }, segment: { select: { name: true } } },
      })
    : null;

  const [emails, activities, quotes, meetings] = contactId
    ? await Promise.all([
        db.emailMessage.findMany({
          where: { contactId, status: { in: ["SENT", "RECEIVED"] } },
          orderBy: { sentAt: "desc" },
          take: 6,
          select: { direction: true, subject: true, textBody: true, snippet: true, sentAt: true },
        }),
        db.activity.findMany({
          where: { contactId, type: { in: ["CALL", "NOTE", "MEETING_REPORT", "MEETING", "STAGE_CHANGED", "FORM_SUBMITTED", "SATISFACTION", "QUOTE_VIEWED"] } },
          orderBy: { occurredAt: "desc" },
          take: 10,
          select: { type: true, title: true, body: true, occurredAt: true },
        }),
        db.quote.findMany({ where: { contactId }, orderBy: { createdAt: "desc" }, take: 3, select: { number: true, status: true, totalHT: true, title: true, viewedAt: true, sentAt: true } }),
        db.meeting.findMany({ where: { contactId }, orderBy: { startAt: "desc" }, take: 3, select: { title: true, startAt: true, status: true, type: true } }),
      ])
    : [[], [], [], []];

  const lines: string[] = [];
  lines.push(`Date du jour : ${formatDate(new Date(), "EEEE d MMMM yyyy")}.`);
  lines.push(`Entreprise et offre : ${settings.productContext}`);
  if (user) lines.push(`Commercial (expéditeur) : ${user.firstName} ${user.lastName}${user.jobTitle ? `, ${user.jobTitle}` : ""}.`);
  if (contact) {
    lines.push(
      `Contact : ${contactDisplayName(contact)}${contact.civility ? ` (${contact.civility})` : ""}${contact.jobTitle ? `, ${contact.jobTitle}` : ""}${contact.company ? `, ${contact.company.name}${contact.company.city ? ` (${contact.company.city})` : ""}` : contact.city ? `, ${contact.city}` : ""}.`,
    );
    lines.push(`Type : ${contact.kind === "B2B" ? "professionnel" : "particulier"}${contact.segment ? ` — cible « ${contact.segment.name} »` : ""}. Origine : ${SOURCE_LABELS[contact.source]}.`);
    if (contact.company?.capacity) lines.push(`Taille : ${contact.company.capacity} lits / résidents / patients suivis.`);
    if (contact.notes) lines.push(`Notes de la fiche : ${truncate(contact.notes, 500)}`);
  }
  if (deal) {
    lines.push(
      `Dossier « ${deal.title} » : étape ${STAGE_LABELS[deal.stage]}${deal.amount ? `, montant ${formatEUR(deal.amount)} HT` : ""}${deal.quantity ? `, ${deal.quantity} piluliers` : ""}${deal.nextActionLabel && deal.nextActionAt ? `, prochaine action prévue : ${deal.nextActionLabel} (${formatDate(deal.nextActionAt)})` : ""}${deal.lostReason ? `, refusé : ${deal.lostReason.label}` : ""}.`,
    );
    if (deal.notes) lines.push(`Notes du dossier : ${truncate(deal.notes, 400)}`);
  }
  for (const q of quotes) {
    lines.push(`Devis ${q.number}${q.title ? ` « ${q.title} »` : ""} : ${formatEUR(q.totalHT)} HT, statut ${q.status}${q.sentAt ? `, envoyé le ${formatDate(q.sentAt)}` : ""}${q.viewedAt ? ", consulté en ligne" : ""}.`);
  }
  for (const m of meetings) lines.push(`RDV « ${m.title} » le ${formatDateTime(m.startAt)} (${m.status}).`);
  if (activities.length) {
    lines.push("Historique récent (du plus récent au plus ancien) :");
    for (const a of activities) lines.push(`- ${formatDate(a.occurredAt)} · ${a.title}${a.body ? ` : ${truncate(a.body.replace(/\s+/g, " "), 350)}` : ""}`);
  }
  if (emails.length) {
    lines.push("Derniers emails (du plus récent au plus ancien) :");
    for (const e of emails) {
      const text = truncate(stripQuotedReply(e.textBody ?? e.snippet ?? "").replace(/\s+/g, " "), 450);
      lines.push(`- ${formatDate(e.sentAt)} · ${e.direction === "INBOUND" ? "reçu du contact" : "envoyé par nous"} · « ${e.subject} » : ${text}`);
    }
  }
  return {
    text: lines.join("\n"),
    tone: settings.followUpTone,
    contactFirstName: contact?.firstName ?? null,
    contactName: contact ? contactDisplayName(contact) : null,
    bookingUrl: user?.bookingSlug ? bookingUrl(user.bookingSlug) : null,
    senderName: user ? `${user.firstName} ${user.lastName}` : null,
  };
}
