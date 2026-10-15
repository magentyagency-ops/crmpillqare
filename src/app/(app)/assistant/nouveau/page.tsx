import { llmProviderLabel } from "@/lib/ai/llm";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { contactDisplayName } from "@/lib/labels";
import { aiAvailable } from "@/lib/ai/report";
import { transcriptionAvailable, transcriptionProviderLabel } from "@/lib/ai/transcription";
import { PageHeader } from "@/components/common/ui-bits";
import { NewSession } from "./new-session";

export const metadata = { title: "Assistant IA" };

type Search = { kind?: string; contactId?: string; dealId?: string; meetingId?: string };

export default async function NewAssistantPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const meeting = sp.meetingId ? await db.meeting.findUnique({ where: { id: sp.meetingId }, select: { id: true, title: true, contactId: true, dealId: true, type: true } }) : null;
  const contactId = sp.contactId ?? meeting?.contactId ?? null;
  const contact = contactId
    ? await db.contact.findUnique({ where: { id: contactId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } })
    : null;
  const kind = sp.kind === "VIDEO" || sp.kind === "IN_PERSON" || sp.kind === "CALL" ? sp.kind : meeting ? (meeting.type === "VIDEO" ? "VIDEO" : meeting.type === "PHONE" ? "CALL" : "IN_PERSON") : "CALL";
  const provider = transcriptionProviderLabel();
  return (
    <>
      <PageHeader
        back={{ href: "/assistant", label: "Assistant IA" }}
        title="Assistant IA — nouvel échange"
        description={`Transcription : ${provider ?? "reconnaissance vocale du navigateur (Chrome / Edge)"} · Compte rendu : ${llmProviderLabel() ?? "à rédiger manuellement (IA non configurée)"}`}
      />
      <NewSession
        initialKind={kind}
        initialContact={contact ? { id: contact.id, label: contactDisplayName(contact), sublabel: contact.company?.name ?? null } : null}
        initialDealId={sp.dealId ?? meeting?.dealId ?? null}
        meeting={meeting ? { id: meeting.id, title: meeting.title } : null}
        ai={aiAvailable()}
        transcription={transcriptionAvailable()}
      />
    </>
  );
}
