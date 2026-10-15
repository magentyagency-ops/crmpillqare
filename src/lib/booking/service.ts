import type { MeetingType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDaysTz, dayKey, formatDateTime, startOfDayTz } from "@/lib/dates";
import { upsertContact } from "@/lib/contacts";
import { createDeal, findOpenDealForContact } from "@/lib/deals";
import { notify } from "@/lib/notifications";
import { contactDisplayName } from "@/lib/labels";
import { createMeeting, rescheduleMeeting } from "@/lib/meetings";
import { detectSegment, loadSegmentCandidates } from "@/lib/segments";
import { cancelTask } from "@/lib/tasks";
import { generateSlots, parseWorkingHours, type DaySlots, type Interval } from "./slots";

export async function getBookingUser(slug: string) {
  return db.user.findFirst({
    where: { bookingSlug: slug, active: true, bookingEnabled: true },
    include: { googleAccount: true },
  });
}

type BookingUser = NonNullable<Awaited<ReturnType<typeof getBookingUser>>>;

/** Occupations : RDV du CRM + agenda Google (si connecté). */
async function busyIntervals(user: BookingUser, from: Date, to: Date, excludeMeetingId?: string): Promise<Interval[]> {
  const meetings = await db.meeting.findMany({
    where: {
      organizerId: user.id,
      status: "SCHEDULED",
      startAt: { lt: to },
      endAt: { gt: from },
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
    },
    select: { startAt: true, endAt: true, googleEventId: true },
  });
  const busy: Interval[] = meetings.map((m) => ({ start: m.startAt, end: m.endAt }));
  if (user.googleAccount && user.googleAccount.status !== "DISCONNECTED") {
    try {
      const { googleBusyIntervals } = await import("@/lib/google/calendar");
      const google = await googleBusyIntervals(user.googleAccount, from, to);
      busy.push(...google);
    } catch (error) {
      console.error("[booking] Lecture des disponibilités Google impossible :", error instanceof Error ? error.message : error);
    }
  }
  return busy;
}

export async function getAvailability(user: BookingUser, opts: { fromDay?: string; days?: number; excludeMeetingId?: string } = {}): Promise<DaySlots[]> {
  const tz = user.timezone;
  const now = new Date();
  const from = opts.fromDay ? startOfDayTz(new Date(`${opts.fromDay}T12:00:00Z`), tz) : startOfDayTz(now, tz);
  const days = Math.min(opts.days ?? 14, 42);
  const to = addDaysTz(from, days, tz);
  const busy = await busyIntervals(user, from, to, opts.excludeMeetingId);
  return generateSlots({
    workingHours: parseWorkingHours(user.workingHours),
    durationMin: user.bookingDurationMin,
    bufferMin: user.bookingBufferMin,
    minNoticeHours: user.bookingMinNoticeHours,
    maxDaysAhead: user.bookingMaxDaysAhead,
    tz,
    from,
    days,
    busy,
    now,
  });
}

export async function isSlotAvailable(user: BookingUser, start: Date, excludeMeetingId?: string): Promise<boolean> {
  const day = dayKey(start, user.timezone);
  const availability = await getAvailability(user, { fromDay: day, days: 1, excludeMeetingId });
  return availability.some((d) => d.slots.some((s) => s.getTime() === start.getTime()));
}

export type BookingInput = {
  slug: string;
  start: Date;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  meetingType?: MeetingType | null;
};

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingError";
  }
}

/** Réservation en ligne par un prospect : contact + dossier + RDV + agenda + confirmation + rappels. */
export async function bookMeeting(input: BookingInput) {
  const user = await getBookingUser(input.slug);
  if (!user) throw new BookingError("Ce lien de prise de rendez-vous n'est plus actif.");
  if (!(await isSlotAvailable(user, input.start))) {
    throw new BookingError("Ce créneau vient d'être réservé ou n'est plus disponible. Merci d'en choisir un autre.");
  }
  const kind = input.company ? "B2B" : "B2C";
  const segment = detectSegment({ company: input.company, message: input.message }, await loadSegmentCandidates(), { kind });
  const { contact, created } = await upsertContact({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    companyName: input.company,
    kind: segment?.kind ?? kind,
    segmentId: segment?.id ?? null,
    source: "BOOKING",
    sourceDetail: `Lien de RDV de ${user.firstName} ${user.lastName}`,
    ownerId: user.id,
  });
  let deal = await findOpenDealForContact(contact.id);
  if (!deal) {
    deal = await createDeal({
      title: input.company ? `${input.company} — ${contactDisplayName(contact)}` : `${contactDisplayName(contact)}`,
      contactId: contact.id,
      ownerId: contact.ownerId ?? user.id,
      stage: "MEETING",
      source: "BOOKING",
      kind: input.company ? "B2B" : contact.kind,
    });
  }
  const type = input.meetingType ?? user.bookingMeetingType;
  const meeting = await createMeeting(
    {
      title: `${user.bookingTitle} — ${contactDisplayName(contact)}`,
      type,
      startAt: input.start,
      endAt: new Date(input.start.getTime() + user.bookingDurationMin * 60_000),
      organizerId: user.id,
      contactId: contact.id,
      dealId: deal.id,
      location: type === "IN_PERSON" ? user.bookingLocation : null,
      bookingNotes: input.message ?? null,
      source: "BOOKING",
    },
    { checkConflict: true },
  );
  // Le contact a pris RDV lui-même : la tâche « rappeler suite à la demande du site » n'a plus d'objet
  const callbacks = await db.task.findMany({ where: { contactId: contact.id, type: "CALLBACK", source: "WEB_FORM", status: "OPEN" }, select: { id: true, description: true } });
  for (const t of callbacks) {
    await db.task.update({
      where: { id: t.id },
      data: { description: [t.description, `RDV pris en ligne par le contact pour le ${formatDateTime(meeting.startAt)}.`].filter(Boolean).join("\n") },
    });
    await cancelTask(t.id);
  }
  await notify({
    userId: user.id,
    type: "MEETING_BOOKED",
    title: `Nouveau RDV réservé : ${contactDisplayName(contact)}`,
    body: `${formatDateTime(meeting.startAt)}${created ? " — nouveau contact" : ""}${input.message ? ` — « ${input.message.slice(0, 200)} »` : ""}`,
    link: `/agenda/${meeting.id}`,
  });
  return meeting;
}

export async function rescheduleByToken(token: string, start: Date) {
  const meeting = await db.meeting.findUnique({ where: { manageToken: token }, include: { organizer: true } });
  if (!meeting || meeting.status === "CANCELLED") throw new BookingError("Rendez-vous introuvable ou annulé.");
  const user = await getBookingUser(meeting.organizer.bookingSlug);
  if (!user) throw new BookingError("La prise de rendez-vous en ligne n'est plus active pour ce conseiller.");
  if (!(await isSlotAvailable(user, start, meeting.id))) throw new BookingError("Ce créneau n'est plus disponible.");
  const duration = meeting.endAt.getTime() - meeting.startAt.getTime();
  const updated = await rescheduleMeeting(meeting.id, start, new Date(start.getTime() + duration), { checkConflict: true });
  await notify({
    userId: meeting.organizerId,
    type: "MEETING_BOOKED",
    title: `RDV déplacé par le contact : ${meeting.title}`,
    body: `Nouveau créneau : ${formatDateTime(start)}`,
    link: `/agenda/${meeting.id}`,
  });
  return updated;
}
