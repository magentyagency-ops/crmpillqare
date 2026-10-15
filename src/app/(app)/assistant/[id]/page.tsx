import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Mail } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { aiAvailable, type MeetingReport } from "@/lib/ai/report";
import { dueDateFromDays } from "@/lib/ai/sessions";
import { AI_KIND_LABELS, AI_STATUS_LABELS, contactDisplayName } from "@/lib/labels";
import { formatDateTime, toDateTimeLocalValue } from "@/lib/dates";
import { formatDuration } from "@/lib/format";
import { PageHeader, Pill, SectionCard, StageBadge } from "@/components/common/ui-bits";
import { ReportReview, SessionProgress } from "./review";
import { FailedSession } from "./failed";

const EMPTY_REPORT: MeetingReport = {
  summary: "",
  keyPoints: [],
  needs: [],
  objections: [],
  nextActions: [],
  decisionMakers: [],
  budget: null,
  timeline: null,
  quantities: null,
  competitors: [],
  risks: [],
  interestLevel: 3,
  sentiment: "neutral",
  suggestedStage: null,
  followUpEmail: { subject: "", body: "" },
};

export default async function AssistantSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const session = await db.aiSession.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
      deal: { select: { id: true, title: true, stage: true } },
      meeting: { select: { id: true, title: true, startAt: true } },
      validatedBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (!session || (session.userId !== user.id && !isManager(user))) notFound();
  const report = (session.report as MeetingReport | null) ?? null;

  return (
    <>
      <PageHeader
        back={{ href: "/assistant", label: "Assistant IA" }}
        title={session.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill className={session.status === "VALIDATED" ? "bg-emerald-100 text-emerald-800" : session.status === "READY" ? "bg-amber-100 text-amber-800" : session.status === "FAILED" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800"}>
              {AI_STATUS_LABELS[session.status]}
            </Pill>
            <span>{AI_KIND_LABELS[session.kind]}</span>
            <span>· {formatDateTime(session.startedAt, user.timezone)}</span>
            {session.durationSec ? <span>· {formatDuration(session.durationSec)}</span> : null}
            {session.contact && (
              <Link href={`/contacts/${session.contact.id}`} className="font-medium hover:underline">
                · {contactDisplayName(session.contact)}
                {session.contact.company ? ` (${session.contact.company.name})` : ""}
              </Link>
            )}
            {session.deal && <StageBadge stage={session.deal.stage} />}
            {session.transcriptSource === "GOOGLE_MEET" && <Pill className="bg-indigo-50 text-indigo-700">Transcription Google Meet</Pill>}
          </span>
        }
      />

      {["RECORDING", "TRANSCRIBING", "ANALYZING"].includes(session.status) && <SessionProgress sessionId={session.id} status={session.status} />}

      {session.status === "FAILED" && <FailedSession sessionId={session.id} error={session.error} transcript={session.transcript ?? ""} aiAvailable={aiAvailable()} />}

      {session.status === "READY" && (
        <ReportReview
          sessionId={session.id}
          initialSummary={session.summary ?? report?.summary ?? ""}
          report={report ?? EMPTY_REPORT}
          defaultDue={[...(report?.nextActions ?? []).map((a) => toDateTimeLocalValue(dueDateFromDays(a.dueInDays, user.timezone), user.timezone)), toDateTimeLocalValue(dueDateFromDays(2, user.timezone), user.timezone)]}
          followUp={{ to: session.followUpTo ?? session.contact?.email ?? "", subject: session.followUpSubject ?? "", body: session.followUpBody ?? "" }}
          deal={session.deal}
          contactEmail={session.contact?.email ?? null}
          transcript={session.transcript ?? ""}
          aiAvailable={aiAvailable()}
          notice={session.error}
        />
      )}

      {session.status === "VALIDATED" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <SectionCard title="Compte rendu validé">
              <p className="text-sm whitespace-pre-line">{session.summary}</p>
              {report && (
                <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  {[
                    { t: "Points clés", l: report.keyPoints },
                    { t: "Besoins", l: report.needs },
                    { t: "Objections", l: report.objections.map((o) => `${o.objection}${o.response ? ` → ${o.response}` : ""}${o.resolved ? " (levée)" : ""}`) },
                    { t: "Prochaines actions", l: report.nextActions.map((a) => `${a.title} (${a.owner})`) },
                  ]
                    .filter((b) => b.l.length)
                    .map((b) => (
                      <div key={b.t}>
                        <div className="mb-1 font-semibold text-brand-navy">{b.t}</div>
                        <ul className="list-disc space-y-0.5 pl-4 text-foreground/85">
                          {b.l.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </SectionCard>
            {session.transcript && (
              <SectionCard title="Transcription">
                <pre className="max-h-[60vh] overflow-y-auto font-sans text-sm whitespace-pre-wrap text-foreground/85">{session.transcript}</pre>
              </SectionCard>
            )}
          </div>
          <div className="space-y-6">
            <SectionCard title="Validation">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-emerald-600" /> Validé {session.validatedAt ? `le ${formatDateTime(session.validatedAt, user.timezone)}` : ""}
                {session.validatedBy ? ` par ${session.validatedBy.firstName}` : ""}
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Mail className="size-4" />
                {session.followUpSentAt ? `Email de suivi envoyé le ${formatDateTime(session.followUpSentAt, user.timezone)}` : "Pas d'email de suivi envoyé"}
              </div>
              {report && (
                <div className="mt-3 text-sm">
                  Intérêt : <strong>{report.interestLevel}/5</strong>
                  {report.budget && <div>Budget : {report.budget}</div>}
                  {report.timeline && <div>Calendrier : {report.timeline}</div>}
                  {report.quantities && <div>Volumes : {report.quantities}</div>}
                </div>
              )}
            </SectionCard>
            {session.meeting && (
              <SectionCard title="Rendez-vous">
                <Link href={`/agenda/${session.meeting.id}`} className="text-sm hover:underline">
                  {session.meeting.title} — {formatDateTime(session.meeting.startAt, user.timezone)}
                </Link>
              </SectionCard>
            )}
          </div>
        </div>
      )}
    </>
  );
}
