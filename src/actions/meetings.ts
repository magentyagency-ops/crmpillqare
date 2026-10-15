"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { cancelMeeting, createMeeting, MeetingConflictError, rescheduleMeeting, sendMeetingEmail, setMeetingOutcome } from "@/lib/meetings";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalString } from "@/lib/validation";
import { contactDisplayName } from "@/lib/labels";

const meetingSchema = z.object({
  title: optionalString,
  type: z.enum(["VIDEO", "PHONE", "IN_PERSON"]),
  start: z.string().min(1, "Date et heure obligatoires"),
  durationMin: z.coerce.number().int().min(5).max(600).default(30),
  organizerId: optionalString,
  contactId: optionalString,
  dealId: optionalString,
  location: optionalString,
  videoUrl: optionalString,
  description: optionalString,
  attendees: optionalString,
  sendConfirmation: z.boolean().default(true),
});

export async function createMeetingAction(input: z.input<typeof meetingSchema>): Promise<ActionResult<{ id: string; videoUrl: string | null }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = meetingSchema.parse(input);
    if (!data.start.includes("T")) throw new UserError("Indiquez l'heure du rendez-vous.");
    const startAt = parseDateTimeLocal(data.start, user.timezone)!;
    const contact = data.contactId
      ? await db.contact.findUnique({ where: { id: data.contactId }, select: { firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } })
      : null;
    const attendees = (data.attendees ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .map((email) => ({ email }));
    try {
      const meeting = await createMeeting(
        {
          title: data.title ?? `RDV PillQare${contact ? ` — ${contact.company?.name ?? contactDisplayName(contact)}` : ""}`,
          type: data.type,
          startAt,
          endAt: new Date(startAt.getTime() + data.durationMin * 60_000),
          organizerId: data.organizerId ?? user.id,
          contactId: data.contactId,
          dealId: data.dealId,
          location: data.location,
          videoUrl: data.videoUrl,
          description: data.description,
          attendees,
          source: "MANUAL",
          createdById: user.id,
          sendConfirmation: data.sendConfirmation,
        },
        { checkConflict: true },
      );
      return { id: meeting.id, videoUrl: meeting.videoUrl };
    } catch (error) {
      if (error instanceof MeetingConflictError) throw new UserError("Un autre rendez-vous est déjà planifié sur ce créneau.");
      throw error;
    }
  }, "Rendez-vous planifié");
}

export async function rescheduleMeetingAction(id: string, start: string, durationMin: number, notifyContact = true): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, meeting.organizerId);
    const startAt = parseDateTimeLocal(start, user.timezone);
    if (!startAt) throw new UserError("Date invalide.");
    try {
      await rescheduleMeeting(id, startAt, new Date(startAt.getTime() + durationMin * 60_000), { byUserId: user.id, notifyContact, checkConflict: true });
    } catch (error) {
      if (error instanceof MeetingConflictError) throw new UserError("Un autre rendez-vous est déjà planifié sur ce créneau.");
      throw error;
    }
  }, "Rendez-vous déplacé");
}

export async function cancelMeetingAction(id: string, reason: string | null, notifyContact = true): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, meeting.organizerId);
    await cancelMeeting(id, { reason, byUserId: user.id, notifyContact });
  }, "Rendez-vous annulé");
}

export async function setMeetingOutcomeAction(id: string, outcome: "COMPLETED" | "NO_SHOW"): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, meeting.organizerId);
    await setMeetingOutcome(id, outcome, user.id);
  }, outcome === "COMPLETED" ? "RDV marqué comme réalisé" : "Absence enregistrée");
}

export async function updateMeetingDetailsAction(id: string, input: { title?: string; description?: string | null; videoUrl?: string | null; location?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, meeting.organizerId);
    await db.meeting.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title.slice(0, 200) } : {}),
        description: input.description ?? meeting.description,
        videoUrl: input.videoUrl === undefined ? meeting.videoUrl : input.videoUrl || null,
        location: input.location === undefined ? meeting.location : input.location || null,
      },
    });
    const { pushMeetingToGoogle } = await import("@/lib/google/calendar");
    await pushMeetingToGoogle(id, { notifyAttendees: false }).catch(() => undefined);
  }, "Rendez-vous mis à jour");
}

export async function resendMeetingConfirmationAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, meeting.organizerId);
    const sent = await sendMeetingEmail(id, "confirmation");
    if (!sent) throw new UserError("Le contact n'a pas d'adresse email.");
  }, "Confirmation envoyée");
}
