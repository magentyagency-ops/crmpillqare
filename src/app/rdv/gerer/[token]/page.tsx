import { notFound } from "next/navigation";
import Link from "next/link";
import { Video } from "lucide-react";
import { db } from "@/lib/db";
import { capitalizeFirst } from "@/lib/format";
import { dayKey, formatLongDate, formatTime } from "@/lib/dates";
import { MEETING_TYPE_LABELS } from "@/lib/labels";
import { PublicShell } from "@/components/public/public-shell";
import { ManageBooking } from "./manage";

export const metadata = { title: "Votre rendez-vous", robots: { index: false } };

export default async function ManageMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meeting = await db.meeting.findUnique({
    where: { manageToken: token },
    include: { organizer: { select: { firstName: true, lastName: true, bookingSlug: true, bookingEnabled: true, timezone: true, active: true } } },
  });
  if (!meeting) notFound();
  const tz = meeting.organizer.timezone;
  const past = meeting.startAt < new Date();
  return (
    <PublicShell>
      <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-[0_20px_50px_-24px_rgba(16,24,40,0.16)] md:p-8">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">Votre rendez-vous</h1>
          <p className="mt-1 text-sm">
            <strong>{capitalizeFirst(formatLongDate(meeting.startAt, tz))}</strong> à {formatTime(meeting.startAt, tz)} (heure de Paris) avec {meeting.organizer.firstName} {meeting.organizer.lastName} ·{" "}
            {MEETING_TYPE_LABELS[meeting.type]}
          </p>
          {meeting.videoUrl && meeting.status === "SCHEDULED" && (
            <a href={meeting.videoUrl} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <Video className="size-4" /> Rejoindre la visio
            </a>
          )}
        </div>
        {meeting.status === "CANCELLED" ? (
          <div className="space-y-2 text-sm">
            <p className="rounded-lg bg-slate-50 p-3">Ce rendez-vous a été annulé.</p>
            {meeting.organizer.bookingEnabled && meeting.organizer.active && (
              <Link href={`/rdv/${meeting.organizer.bookingSlug}`} className="font-medium text-primary hover:underline">
                Reprendre un rendez-vous
              </Link>
            )}
          </div>
        ) : past ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm">Ce rendez-vous est passé.</p>
        ) : (
          <ManageBooking token={token} today={dayKey(new Date(), tz)} canReschedule={meeting.organizer.bookingEnabled && meeting.organizer.active} />
        )}
      </div>
    </PublicShell>
  );
}
