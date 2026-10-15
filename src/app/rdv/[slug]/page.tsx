import { notFound } from "next/navigation";
import { Clock, MapPin, Phone, Video } from "lucide-react";
import { getBookingUser } from "@/lib/booking/service";
import { dayKey } from "@/lib/dates";
import { MEETING_TYPE_LABELS } from "@/lib/labels";
import { PublicShell } from "@/components/public/public-shell";
import { UserAvatar } from "@/components/common/ui-bits";
import { Booking } from "./booking";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getBookingUser(slug);
  return { title: user ? `Prendre rendez-vous avec ${user.firstName} ${user.lastName}` : "Prise de rendez-vous", robots: { index: false } };
}

const ICON = { VIDEO: Video, PHONE: Phone, IN_PERSON: MapPin } as const;

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getBookingUser(slug);
  if (!user) notFound();
  const Icon = ICON[user.bookingMeetingType];
  return (
    <PublicShell wide>
      <div className="grid grid-cols-1 gap-6 rounded-2xl border border-border bg-card p-6 shadow-[0_20px_50px_-24px_rgba(16,24,40,0.16)] md:grid-cols-[280px_1fr] md:p-8">
        <div className="space-y-4 md:border-r md:pr-6">
          <UserAvatar user={user} size="md" className="size-14 text-lg" />
          <div>
            <div className="text-sm text-muted-foreground">
              {user.firstName} {user.lastName}
              {user.jobTitle ? ` · ${user.jobTitle}` : ""}
            </div>
            <h1 className="mt-1 text-xl font-bold text-brand-navy">{user.bookingTitle}</h1>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="size-4" /> {user.bookingDurationMin} minutes
            </div>
            <div className="flex items-center gap-2">
              <Icon className="size-4" /> {MEETING_TYPE_LABELS[user.bookingMeetingType]}
              {user.bookingMeetingType === "VIDEO" ? " (lien envoyé par email)" : user.bookingMeetingType === "IN_PERSON" && user.bookingLocation ? ` — ${user.bookingLocation}` : ""}
            </div>
          </div>
          {user.bookingDescription && <p className="text-sm whitespace-pre-line">{user.bookingDescription}</p>}
        </div>
        <Booking slug={slug} today={dayKey(new Date(), user.timezone)} durationMin={user.bookingDurationMin} meetingType={user.bookingMeetingType} />
      </div>
    </PublicShell>
  );
}
