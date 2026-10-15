"use server";

import { db } from "@/lib/db";
import { assertUser, isManager } from "@/lib/auth/guards";
import { contactDisplayName, MEETING_TYPE_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";

/** Détails affichés dans la fiche d'un événement (clic dans l'agenda). */
export type CalendarEventInfo = {
  kind: "meeting" | "task" | "step";
  entityId: string;
  /** Sous-type : VIDEO / PHONE / IN_PERSON pour un RDV, type de tâche, EMAIL pour une relance */
  subtype: string;
  subtypeLabel: string;
  status: string;
  ownerId: string;
  ownerName: string;
  contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  dealId: string | null;
  location: string | null;
  videoUrl: string | null;
  description: string | null;
  url: string;
  hasTime: boolean;
  durationMin: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  editable?: boolean;
  durationEditable?: boolean;
  extendedProps: CalendarEventInfo;
};

const CONTACT = { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } as const;

/**
 * Événements de l'agenda CRM : RDV, tâches datées, relances automatiques prévues.
 * `userIds` : agendas affichés (la direction peut afficher ceux de l'équipe ; un commercial ne voit que le sien).
 */
export async function calendarEventsAction(
  range: { start: string; end: string },
  filters: { userIds?: string[] | null; meetings?: boolean; tasks?: boolean; steps?: boolean },
): Promise<CalendarEvent[]> {
  const user = await assertUser();
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const ids = isManager(user) && filters.userIds?.length ? filters.userIds.slice(0, 50) : [user.id];

  const [meetings, tasks, steps] = await Promise.all([
    filters.meetings === false
      ? []
      : db.meeting.findMany({
          where: { startAt: { lt: end }, endAt: { gt: start }, organizerId: { in: ids } },
          include: { contact: CONTACT, organizer: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { startAt: "asc" },
          take: 2000,
        }),
    filters.tasks === false
      ? []
      : db.task.findMany({
          where: { status: { in: ["OPEN", "DONE"] }, dueAt: { gte: start, lt: end }, assigneeId: { in: ids } },
          include: { contact: CONTACT, assignee: { select: { id: true, firstName: true, lastName: true } } },
          take: 2000,
        }),
    filters.steps === false
      ? []
      : db.sequenceStepRun.findMany({
          where: {
            status: { in: ["SCHEDULED", "PENDING_APPROVAL"] },
            type: "EMAIL",
            scheduledAt: { gte: start, lt: end },
            enrollment: { status: "ACTIVE", ownerId: { in: ids } },
          },
          include: {
            step: { select: { subject: true } },
            enrollment: { include: { contact: CONTACT, owner: { select: { id: true, firstName: true, lastName: true } }, sequence: { select: { name: true } } } },
          },
          take: 2000,
        }),
  ]);

  const contactOf = (c: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null) =>
    c ? { id: c.id, name: contactDisplayName(c), email: c.email, phone: c.phone } : null;

  const events: CalendarEvent[] = [];
  for (const m of meetings) {
    // Tout RDV non annulé se déplace à la souris (un RDV passé redevient « planifié » s'il est reporté)
    const active = m.status !== "CANCELLED";
    events.push({
      id: `m-${m.id}`,
      title: m.title,
      start: m.startAt.toISOString(),
      end: m.endAt.toISOString(),
      editable: active,
      durationEditable: active,
      extendedProps: {
        kind: "meeting",
        entityId: m.id,
        subtype: m.type,
        subtypeLabel: MEETING_TYPE_LABELS[m.type],
        status: m.status,
        ownerId: m.organizer.id,
        ownerName: `${m.organizer.firstName} ${m.organizer.lastName}`,
        contact: contactOf(m.contact),
        dealId: m.dealId,
        location: m.location,
        videoUrl: m.videoUrl,
        description: m.description ?? m.bookingNotes,
        url: `/agenda/${m.id}`,
        hasTime: true,
        durationMin: Math.round((m.endAt.getTime() - m.startAt.getTime()) / 60_000),
      },
    });
  }
  for (const t of tasks) {
    const open = t.status === "OPEN";
    events.push({
      id: `t-${t.id}`,
      title: t.title,
      start: t.dueAt!.toISOString(),
      ...(t.hasTime ? { end: new Date(t.dueAt!.getTime() + 30 * 60_000).toISOString() } : { allDay: true }),
      editable: open,
      durationEditable: false,
      extendedProps: {
        kind: "task",
        entityId: t.id,
        subtype: t.type,
        subtypeLabel: TASK_TYPE_LABELS[t.type],
        status: t.status,
        ownerId: t.assignee.id,
        ownerName: `${t.assignee.firstName} ${t.assignee.lastName}`,
        contact: contactOf(t.contact),
        dealId: t.dealId,
        location: null,
        videoUrl: null,
        description: t.description,
        url: t.contactId ? `/contacts/${t.contactId}` : t.dealId ? `/pipeline/${t.dealId}` : "/taches",
        hasTime: t.hasTime,
        durationMin: 30,
      },
    });
  }
  for (const s of steps) {
    events.push({
      id: `s-${s.id}`,
      title: `${s.step.subject || "Relance"} — ${contactDisplayName(s.enrollment.contact)}`,
      start: s.scheduledAt.toISOString(),
      end: new Date(s.scheduledAt.getTime() + 15 * 60_000).toISOString(),
      editable: false,
      extendedProps: {
        kind: "step",
        entityId: s.id,
        subtype: "EMAIL",
        subtypeLabel: s.status === "PENDING_APPROVAL" ? "Relance à valider" : `Relance automatique · ${s.enrollment.sequence.name}`,
        status: s.status,
        ownerId: s.enrollment.owner.id,
        ownerName: `${s.enrollment.owner.firstName} ${s.enrollment.owner.lastName}`,
        contact: contactOf(s.enrollment.contact),
        dealId: s.enrollment.dealId,
        location: null,
        videoUrl: null,
        description: null,
        url: s.status === "PENDING_APPROVAL" ? "/relances?statut=validate" : "/relances",
        hasTime: true,
        durationMin: 15,
      },
    });
  }
  return events;
}
