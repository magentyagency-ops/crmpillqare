import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseWorkingHours } from "@/lib/booking/slots";
import { SectionCard } from "@/components/common/ui-bits";
import { BookingSettingsForm } from "./booking-form";

export const metadata = { title: "Prise de rendez-vous" };

export default async function BookingSettingsPage() {
  const session = await requireUser();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.id }, include: { googleAccount: { select: { status: true } } } });
  return (
    <SectionCard
      title="Mon lien de prise de rendez-vous"
      description="Vos prospects choisissent un créneau libre : le RDV est créé dans le CRM et Google Agenda (lien Meet), avec confirmation et rappels automatiques."
    >
      <BookingSettingsForm
        appUrl={env.appUrl}
        googleConnected={Boolean(user.googleAccount && user.googleAccount.status !== "DISCONNECTED")}
        initial={{
          bookingEnabled: user.bookingEnabled,
          bookingSlug: user.bookingSlug,
          bookingTitle: user.bookingTitle,
          bookingDescription: user.bookingDescription ?? "",
          bookingDurationMin: String(user.bookingDurationMin),
          bookingBufferMin: String(user.bookingBufferMin),
          bookingMinNoticeHours: String(user.bookingMinNoticeHours),
          bookingMaxDaysAhead: String(user.bookingMaxDaysAhead),
          bookingMeetingType: user.bookingMeetingType,
          bookingLocation: user.bookingLocation ?? "",
          videoRoomUrl: user.videoRoomUrl ?? "",
          workingHours: parseWorkingHours(user.workingHours),
        }}
      />
    </SectionCard>
  );
}
