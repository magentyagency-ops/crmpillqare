import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Clock, MapPin, Phone, Sparkles, Video } from "lucide-react";
import { requireUser, canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { formatDateTime, formatLongDate, formatTime, toDateTimeLocalValue, formatRelative } from "@/lib/dates";
import { AI_STATUS_LABELS, contactDisplayName, MEETING_STATUS_LABELS, MEETING_TYPE_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/normalize";
import { capitalizeFirst } from "@/lib/format";
import { KeyValue, PageHeader, Pill, SectionCard, StageBadge, UserAvatar } from "@/components/common/ui-bits";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { meetingManageUrl } from "@/lib/email/vars";
import { MeetingActions } from "./meeting-client";

const STATUS_COLORS = { SCHEDULED: "bg-sky-100 text-sky-800", COMPLETED: "bg-emerald-100 text-emerald-800", CANCELLED: "bg-rose-100 text-rose-700", NO_SHOW: "bg-amber-100 text-amber-800" } as const;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const meeting = await db.meeting.findUnique({
    where: { id },
    include: {
      contact: { include: { company: { select: { id: true, name: true } } } },
      deal: { select: { id: true, title: true, stage: true } },
      organizer: { select: { firstName: true, lastName: true, color: true } },
      aiSessions: { orderBy: { createdAt: "desc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } }, deal: { select: { id: true, title: true } } },
      },
    },
  });
  if (!meeting) notFound();
  if (!(await canView(await requireUser(), [meeting.organizerId, meeting.contact?.ownerId]))) notFound();
  const tz = user.timezone;
  const now = new Date();
  const past = meeting.endAt < now;
  const durationMin = Math.round((meeting.endAt.getTime() - meeting.startAt.getTime()) / 60_000);
  const kindParam = meeting.type === "VIDEO" ? "VIDEO" : meeting.type === "PHONE" ? "CALL" : "IN_PERSON";
  const attendees = (meeting.attendees as { email: string; name?: string | null }[] | null) ?? [];

  return (
    <>
      <PageHeader
        back={{ href: "/agenda", label: "Agenda" }}
        title={meeting.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill className={STATUS_COLORS[meeting.status]}>{MEETING_STATUS_LABELS[meeting.status]}</Pill>
            <span>
              {capitalizeFirst(formatLongDate(meeting.startAt, tz))}, {formatTime(meeting.startAt, tz)} – {formatTime(meeting.endAt, tz)} ({durationMin} min)
            </span>
            <span>· {MEETING_TYPE_LABELS[meeting.type]}</span>
          </span>
        }
        actions={
          <MeetingActions
            id={meeting.id}
            status={meeting.status}
            past={past}
            start={toDateTimeLocalValue(meeting.startAt, tz)}
            durationMin={durationMin}
            hasContactEmail={Boolean(meeting.contact?.email)}
            details={{ title: meeting.title, description: meeting.description ?? "", videoUrl: meeting.videoUrl ?? "", location: meeting.location ?? "" }}
          />
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Assistant IA & compte rendu" description="Enregistrez l'échange (ou récupérez la transcription Google Meet) : l'IA rédige le compte rendu et l'email de suivi, que vous validez.">
            {meeting.aiSessions.length > 0 ? (
              <ul className="space-y-2">
                {meeting.aiSessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/assistant/${s.id}`} className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-accent">
                      <Sparkles className="size-4 text-fuchsia-600" />
                      <span className="flex-1 font-medium">{s.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {AI_STATUS_LABELS[s.status]} · {formatRelative(s.createdAt)}
                      </span>
                    </Link>
                    {s.summary && <p className="mt-1 line-clamp-3 px-1 text-sm text-muted-foreground">{s.summary}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Pas encore de compte rendu pour ce rendez-vous.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/assistant/nouveau?meetingId=${meeting.id}&kind=${kindParam}`}>
                  <Sparkles /> {past ? "Faire le compte rendu" : "Démarrer l'assistant pendant le RDV"}
                </Link>
              </Button>
              {meeting.videoUrl && !past && meeting.status === "SCHEDULED" && (
                <Button asChild size="sm" variant="outline">
                  <a href={meeting.videoUrl} target="_blank" rel="noreferrer">
                    <Video /> Rejoindre la visio
                  </a>
                </Button>
              )}
            </div>
          </SectionCard>

          {(meeting.description || meeting.bookingNotes) && (
            <SectionCard title="Ordre du jour et notes">
              {meeting.bookingNotes && (
                <div className="mb-3 rounded-md bg-sky-50 p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold text-sky-800">Message du contact lors de la réservation</div>
                  <p className="whitespace-pre-line">{meeting.bookingNotes}</p>
                </div>
              )}
              {meeting.description && <p className="text-sm whitespace-pre-line">{meeting.description}</p>}
            </SectionCard>
          )}

          <SectionCard title="Tâches liées">
            {meeting.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune tâche liée.</p>
            ) : (
              <div className="-mx-2 divide-y">
                {meeting.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} tz={tz} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Participants">
            {meeting.contact ? (
              <div className="text-sm">
                <Link href={`/contacts/${meeting.contact.id}`} className="font-semibold hover:underline">
                  {contactDisplayName(meeting.contact)}
                </Link>
                {meeting.contact.company && <div className="text-muted-foreground">{meeting.contact.company.name}</div>}
                {meeting.contact.phone && (
                  <a href={`tel:${meeting.contact.phone}`} className="mt-1 flex items-center gap-1.5 text-primary hover:underline">
                    <Phone className="size-3.5" /> {formatPhone(meeting.contact.phone)}
                  </a>
                )}
                {meeting.contact.email && <div className="text-primary">{meeting.contact.email}</div>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun contact lié.</p>
            )}
            {attendees.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t pt-2 text-sm text-muted-foreground">
                {attendees.map((a) => (
                  <li key={a.email}>{a.name ? `${a.name} <${a.email}>` : a.email}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2 border-t pt-2 text-sm">
              <UserAvatar user={meeting.organizer} size="xs" /> {meeting.organizer.firstName} {meeting.organizer.lastName} (organisateur)
            </div>
          </SectionCard>
          <SectionCard title="Détails">
            <dl>
              <KeyValue label="Type">{MEETING_TYPE_LABELS[meeting.type]}</KeyValue>
              {meeting.videoUrl && (
                <KeyValue label="Visio">
                  <a href={meeting.videoUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                    {meeting.videoUrl}
                  </a>
                </KeyValue>
              )}
              {meeting.location && (
                <KeyValue label="Lieu">
                  <span className="inline-flex items-start gap-1">
                    <MapPin className="mt-0.5 size-3.5" /> {meeting.location}
                  </span>
                </KeyValue>
              )}
              {meeting.deal && (
                <KeyValue label="Dossier">
                  <Link href={`/pipeline/${meeting.deal.id}`} className="hover:underline">
                    {meeting.deal.title}
                  </Link>{" "}
                  <StageBadge stage={meeting.deal.stage} />
                </KeyValue>
              )}
              <KeyValue label="Origine">{meeting.source === "BOOKING" ? "Réservé en ligne" : meeting.source === "GOOGLE" ? "Google Agenda" : "Saisi dans le CRM"}</KeyValue>
              <KeyValue label="Google Agenda">{meeting.googleEventId ? "Synchronisé ✓" : "Non synchronisé"}</KeyValue>
            </dl>
          </SectionCard>
          <SectionCard title="Emails automatiques au contact">
            <ul className="space-y-1.5 text-sm">
              {[
                { label: "Confirmation", at: meeting.confirmationSentAt },
                { label: "Rappel 24 h avant", at: meeting.reminder24hSentAt },
                { label: "Rappel 1 h avant", at: meeting.reminder1hSentAt },
              ].map((e) => (
                <li key={e.label} className="flex items-center gap-2">
                  {e.at ? <Check className="size-4 text-emerald-600" /> : <Clock className="size-4 text-muted-foreground" />}
                  <span className="flex-1">{e.label}</span>
                  <span className="text-xs text-muted-foreground">{e.at ? formatDateTime(e.at, tz) : meeting.status === "SCHEDULED" ? "prévu" : "—"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Lien de gestion envoyé au contact :{" "}
              <a href={meetingManageUrl(meeting.manageToken)} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {meetingManageUrl(meeting.manageToken)}
              </a>
            </p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
