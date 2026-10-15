import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import { formatEUR } from "@/lib/format";
import { MEETING_TYPE_LABELS, fullName } from "@/lib/labels";
import { getSettings } from "@/lib/settings";
import type { TemplateVars } from "./render";

export type VarsContext = {
  contactId?: string | null;
  dealId?: string | null;
  userId?: string | null;
  quoteId?: string | null;
  orderId?: string | null;
  meetingId?: string | null;
};

export function bookingUrl(slug: string) {
  return `${env.appUrl}/rdv/${slug}`;
}

export function quotePublicUrl(token: string) {
  return `${env.appUrl}/p/devis/${token}`;
}

export function satisfactionUrl(token: string) {
  return `${env.appUrl}/p/satisfaction/${token}`;
}

export function unsubscribeUrl(token: string) {
  return `${env.appUrl}/p/desinscription/${token}`;
}

export function meetingManageUrl(token: string) {
  return `${env.appUrl}/rdv/gerer/${token}`;
}

/** Construit les variables de modèle à partir des entités du CRM. */
export async function buildTemplateVars(ctx: VarsContext): Promise<TemplateVars> {
  const [company, deal, quote, order, meeting] = await Promise.all([
    getSettings("company"),
    ctx.dealId ? db.deal.findUnique({ where: { id: ctx.dealId }, select: { title: true, amount: true, contactId: true, ownerId: true } }) : null,
    ctx.quoteId
      ? db.quote.findUnique({ where: { id: ctx.quoteId }, select: { number: true, publicToken: true, totalHT: true, totalTTC: true, validUntil: true } })
      : null,
    ctx.orderId
      ? db.order.findUnique({ where: { id: ctx.orderId }, select: { number: true, total: true, processedAt: true, satisfactionToken: true } })
      : null,
    ctx.meetingId
      ? db.meeting.findUnique({
          where: { id: ctx.meetingId },
          select: { startAt: true, endAt: true, type: true, videoUrl: true, location: true, manageToken: true, title: true },
        })
      : null,
  ]);

  const contactId = ctx.contactId ?? deal?.contactId ?? null;
  const userId = ctx.userId ?? deal?.ownerId ?? null;
  const [contact, user] = await Promise.all([
    contactId
      ? db.contact.findUnique({
          where: { id: contactId },
          select: { firstName: true, lastName: true, civility: true, email: true, phone: true, company: { select: { name: true, city: true } } },
        })
      : null,
    userId
      ? db.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true, phone: true, jobTitle: true, bookingSlug: true, bookingEnabled: true },
        })
      : null,
  ]);

  const greeting = contact?.firstName
    ? `Bonjour ${contact.firstName},`
    : contact?.lastName && contact.civility
      ? `Bonjour ${contact.civility} ${contact.lastName},`
      : "Bonjour,";

  return {
    org: { name: company.name, website: company.website, phone: company.phone, email: company.email },
    contact: contact
      ? {
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          fullName: fullName(contact),
          civility: contact.civility ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          greeting,
        }
      : { greeting: "Bonjour," },
    company: contact?.company ? { name: contact.company.name, city: contact.company.city ?? "" } : {},
    deal: deal ? { title: deal.title, amount: deal.amount ? formatEUR(deal.amount) : "" } : {},
    user: user
      ? {
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: fullName(user),
          email: user.email,
          phone: user.phone ?? "",
          jobTitle: user.jobTitle ?? "",
          bookingLink: user.bookingEnabled ? bookingUrl(user.bookingSlug) : "",
        }
      : {},
    bookingLink: user?.bookingEnabled ? bookingUrl(user.bookingSlug) : "",
    quote: quote
      ? {
          number: quote.number,
          link: quotePublicUrl(quote.publicToken),
          totalHT: formatEUR(quote.totalHT),
          totalTTC: formatEUR(quote.totalTTC),
          validUntil: formatDate(quote.validUntil, "d MMMM yyyy"),
        }
      : {},
    order: order ? { number: order.number, total: formatEUR(order.total), date: formatDate(order.processedAt, "d MMMM yyyy") } : {},
    satisfactionLink: order ? satisfactionUrl(order.satisfactionToken) : "",
    meeting: meeting
      ? {
          title: meeting.title,
          date: formatDate(meeting.startAt, "EEEE d MMMM yyyy"),
          time: formatTime(meeting.startAt),
          dateTime: formatDateTime(meeting.startAt),
          type: MEETING_TYPE_LABELS[meeting.type],
          link: meeting.videoUrl ?? "",
          location: meeting.location ?? "",
          manageLink: meetingManageUrl(meeting.manageToken),
        }
      : {},
  };
}
