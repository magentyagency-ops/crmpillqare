import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { daysAgo, endOfDayTz, nowDate } from "@/lib/dates";
import { aiAvailable } from "@/lib/ai/report";
import { transcriptionAvailable } from "@/lib/ai/transcription";
import { AppDataProvider, type AppData } from "@/components/app/app-data";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { UrlNotices } from "@/components/app/url-notices";
import { Copilot } from "@/components/agent/copilot";
import { Suspense } from "react";

// Copilote, rédaction et analyses IA : jusqu'à quelques minutes par requête (Vercel)
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const dayEnd = endOfDayTz(nowDate(), user.timezone);
  const [users, segments, lostReasons, today, approvals, replies, reports, unread, google, mailbox] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true, role: true, color: true, email: true } }),
    db.segment.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true, kind: true, color: true } }),
    db.lostReason.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, label: true } }),
    db.task.count({ where: { assigneeId: user.id, status: "OPEN", dueAt: { lte: dayEnd } } }),
    db.sequenceStepRun.count({ where: { status: "PENDING_APPROVAL", enrollment: { ownerId: user.id, status: "ACTIVE" } } }),
    db.emailMessage.count({
      where: { direction: "INBOUND", handledAt: null, contactId: { not: null }, sentAt: { gte: daysAgo(30) }, OR: [{ userId: user.id }, { contact: { ownerId: user.id } }] },
    }),
    db.aiSession.count({ where: { userId: user.id, status: "READY" } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.googleAccount.findUnique({ where: { userId: user.id }, select: { status: true } }),
    db.mailbox.count({ where: { userId: user.id, status: { not: "DISCONNECTED" } } }),
  ]);

  const data: AppData = {
    me: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role, color: user.color, email: user.email, timezone: user.timezone, bookingSlug: user.bookingSlug },
    users,
    segments,
    lostReasons,
    integrations: {
      google: Boolean(google && google.status !== "DISCONNECTED"),
      mailbox: mailbox > 0 || env.emailDelivery === "log",
      ai: aiAvailable(),
      transcription: transcriptionAvailable(),
    },
  };
  const counts = { today, replies, approvals, reports };

  return (
    <AppDataProvider value={data}>
      <Sidebar counts={counts} />
      <div className="lg:pl-60">
        <Topbar counts={counts} unread={unread} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-7 lg:px-8 lg:py-8">{children}</main>
        <Suspense fallback={null}>
          <UrlNotices />
        </Suspense>
        {env.ai.openaiKey && <Copilot />}
      </div>
    </AppDataProvider>
  );
}
