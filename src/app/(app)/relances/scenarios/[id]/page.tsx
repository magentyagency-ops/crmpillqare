import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/common/ui-bits";
import { ScenarioEditor, type ScenarioDraft } from "../scenario-client";

export const metadata = { title: "Scénario de relance" };

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  let initial: ScenarioDraft;
  if (id === "nouveau") {
    initial = {
      name: "",
      description: "",
      active: true,
      trigger: "STAGE_ENTERED",
      triggerStage: "PROSPECT",
      contactKind: "",
      segmentIds: [],
      priority: "0",
      stopOnReply: true,
      stopOnStageChange: true,
      stopOnMeetingBooked: true,
      businessHoursOnly: true,
      steps: [
        {
          type: "EMAIL",
          delayDays: "0",
          delayHours: "0",
          delayMinutes: "0",
          sendTime: "09:30",
          subject: "",
          body: "{{contact.greeting}}\n\n\n\nBien cordialement,",
          taskTitle: "",
          taskDescription: "",
          requiresApproval: false,
          aiPersonalize: true,
        },
      ],
    };
  } else {
    const s = await db.sequence.findUnique({ where: { id }, include: { steps: { where: { archivedAt: null }, orderBy: { position: "asc" } } } });
    if (!s) notFound();
    initial = {
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      active: s.active,
      trigger: s.trigger,
      triggerStage: s.triggerStage ?? "",
      contactKind: s.contactKind ?? "",
      segmentIds: s.segmentIds,
      priority: String(s.priority),
      stopOnReply: s.stopOnReply,
      stopOnStageChange: s.stopOnStageChange,
      stopOnMeetingBooked: s.stopOnMeetingBooked,
      businessHoursOnly: s.businessHoursOnly,
      steps: s.steps.map((st) => ({
        type: st.type,
        delayDays: String(st.delayDays),
        delayHours: String(st.delayHours),
        delayMinutes: String(st.delayMinutes),
        sendTime: st.sendTime ?? "",
        subject: st.subject ?? "",
        body: st.body ?? "",
        taskTitle: st.taskTitle ?? "",
        taskDescription: st.taskDescription ?? "",
        requiresApproval: st.requiresApproval,
        aiPersonalize: st.aiPersonalize,
      })),
    };
  }
  return (
    <>
      <PageHeader back={{ href: "/relances/scenarios", label: "Scénarios" }} title={initial.id ? initial.name : "Nouveau scénario de relance"} />
      <ScenarioEditor initial={initial} />
    </>
  );
}
