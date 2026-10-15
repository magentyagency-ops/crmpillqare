import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { formatRelative } from "@/lib/dates";
import { CalendarLoader } from "./calendar-loader";

export const metadata = { title: "Agenda" };

export default async function AgendaPage() {
  const user = await requireUser();
  const google = await db.googleAccount.findUnique({ where: { userId: user.id }, select: { email: true, status: true, calendarLastSyncAt: true } });
  return (
    <>
      <h1 className="sr-only">Agenda</h1>
      <CalendarLoader
        google={
          google
            ? {
                email: google.email,
                connected: google.status !== "DISCONNECTED",
                lastSync: google.calendarLastSyncAt ? `Dernière synchro ${formatRelative(google.calendarLastSyncAt)}` : "Synchronisation en attente",
              }
            : null
        }
      />
    </>
  );
}
