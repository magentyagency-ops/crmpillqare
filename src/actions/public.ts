"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { bookMeeting, BookingError, getAvailability, getBookingUser, rescheduleByToken } from "@/lib/booking/service";
import { cancelMeeting, MeetingConflictError } from "@/lib/meetings";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { contactDisplayName } from "@/lib/labels";

export type PublicDay = { day: string; slots: string[] };

export async function getSlotsAction(slug: string, fromDay?: string | null, days = 7): Promise<PublicDay[]> {
  const user = await getBookingUser(slug);
  if (!user) return [];
  const availability = await getAvailability(user, { fromDay: fromDay ?? undefined, days });
  return availability.map((d) => ({ day: d.day, slots: d.slots.map((s) => s.toISOString()) }));
}

const bookingSchema = z.object({
  slug: z.string().min(1),
  start: z.string().min(10),
  firstName: z.string().trim().min(1, "Prénom obligatoire").max(100),
  lastName: z.string().trim().min(1, "Nom obligatoire").max(100),
  email: z.email("Email invalide"),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  website: z.string().optional().default(""),
});

export async function bookAction(input: z.input<typeof bookingSchema>): Promise<ActionResult<{ token: string; videoUrl: string | null }>> {
  return runAction(async () => {
    const data = bookingSchema.parse(input);
    if (data.website) throw new UserError("Demande refusée.");
    const ip = clientIp(await headers());
    if (!(await rateLimit(`booking:${ip}`, 6, 3600)).allowed) throw new UserError("Trop de réservations depuis cette connexion. Réessayez plus tard.");
    const start = new Date(data.start);
    if (Number.isNaN(start.getTime())) throw new UserError("Créneau invalide.");
    try {
      const meeting = await bookMeeting({
        slug: data.slug,
        start,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || null,
        company: data.company || null,
        message: data.message || null,
      });
      return { token: meeting.manageToken, videoUrl: meeting.videoUrl };
    } catch (error) {
      if (error instanceof BookingError) throw new UserError(error.message);
      if (error instanceof MeetingConflictError) throw new UserError("Ce créneau vient d'être réservé. Merci d'en choisir un autre.");
      throw error;
    }
  });
}

export async function getManageSlotsAction(token: string, fromDay?: string | null): Promise<PublicDay[]> {
  const meeting = await db.meeting.findUnique({ where: { manageToken: token }, include: { organizer: true } });
  if (!meeting || meeting.status === "CANCELLED") return [];
  const user = await getBookingUser(meeting.organizer.bookingSlug);
  if (!user) return [];
  const availability = await getAvailability(user, { fromDay: fromDay ?? undefined, days: 7, excludeMeetingId: meeting.id });
  return availability.map((d) => ({ day: d.day, slots: d.slots.map((s) => s.toISOString()) }));
}

export async function rescheduleByTokenAction(token: string, start: string): Promise<ActionResult> {
  return runAction(async () => {
    const ip = clientIp(await headers());
    if (!(await rateLimit(`booking-manage:${ip}`, 10, 3600)).allowed) throw new UserError("Trop de tentatives.");
    try {
      await rescheduleByToken(token, new Date(start));
    } catch (error) {
      if (error instanceof BookingError) throw new UserError(error.message);
      if (error instanceof MeetingConflictError) throw new UserError("Ce créneau vient d'être réservé.");
      throw error;
    }
  }, "Votre rendez-vous a été déplacé. Une confirmation vous a été envoyée.");
}

export async function cancelByTokenAction(token: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const meeting = await db.meeting.findUnique({ where: { manageToken: token } });
    if (!meeting || meeting.status !== "SCHEDULED") throw new UserError("Ce rendez-vous n'est plus modifiable.");
    await cancelMeeting(meeting.id, { reason: reason.trim() || null, byContact: true });
  }, "Votre rendez-vous a été annulé.");
}

export async function submitSatisfactionAction(token: string, score: number, comment: string): Promise<ActionResult> {
  return runAction(async () => {
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new UserError("Choisissez une note de 1 à 5.");
    const order = await db.order.findUnique({
      where: { satisfactionToken: token },
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true } } },
    });
    if (!order) throw new UserError("Questionnaire introuvable.");
    const first = !order.satisfactionAt;
    const previous = order.satisfactionScore;
    await db.order.update({ where: { id: order.id }, data: { satisfactionScore: score, satisfactionComment: comment.trim().slice(0, 3000) || null, satisfactionAt: new Date() } });
    await logActivity({
      type: "SATISFACTION",
      title: `Satisfaction : ${score}/5 (commande ${order.number})`,
      body: comment.trim() || null,
      contactId: order.contactId,
      orderId: order.id,
    });
    // Les tâches « satisfaction » du suivi après-achat sont terminées
    await db.task.updateMany({ where: { orderId: order.id, type: "SATISFACTION", status: "OPEN", priority: { not: "URGENT" } }, data: { status: "DONE", completedAt: new Date() } });
    // Alerte au premier avis, ou quand un avis modifié change de note
    if ((first || previous !== score) && order.contact.ownerId) {
      await notify({
        userId: order.contact.ownerId,
        type: "SATISFACTION",
        title: `${score <= 3 ? "⚠️ " : ""}Avis client ${score}/5 : ${contactDisplayName(order.contact)}`,
        body: comment.trim() || null,
        link: `/commandes/${order.id}`,
      });
      const urgentOpen = await db.task.findFirst({ where: { orderId: order.id, type: "SATISFACTION", priority: "URGENT", status: "OPEN" }, select: { id: true } });
      if (score <= 3 && !urgentOpen) {
        const { createTask } = await import("@/lib/tasks");
        await createTask({
          title: `Client insatisfait (${score}/5) : rappeler ${contactDisplayName(order.contact)}`,
          description: comment.trim() || null,
          type: "SATISFACTION",
          priority: "URGENT",
          source: "SYSTEM",
          dueAt: new Date(),
          assigneeId: order.contact.ownerId,
          contactId: order.contactId,
          orderId: order.id,
        });
      }
    }
  }, "Merci pour votre avis !");
}

export async function unsubscribeAction(token: string): Promise<ActionResult> {
  return runAction(async () => {
    const contact = await db.contact.findUnique({ where: { unsubscribeToken: token } });
    if (!contact) throw new UserError("Lien invalide.");
    if (!contact.doNotContact) {
      await db.contact.update({ where: { id: contact.id }, data: { doNotContact: true, unsubscribedAt: new Date() } });
      // Relances commerciales arrêtées ; le suivi des commandes et des essais continue (appels, tâches),
      // ses emails étant automatiquement sautés pour un contact désinscrit
      const { stopContactEnrollments } = await import("@/lib/sequences/engine");
      await stopContactEnrollments(contact.id, "UNSUBSCRIBED", { orderId: null, trialId: null });
      await logActivity({ type: "SYSTEM", title: "Désinscription des emails (demande du contact)", contactId: contact.id });
    }
  }, "Vous ne recevrez plus nos messages.");
}
