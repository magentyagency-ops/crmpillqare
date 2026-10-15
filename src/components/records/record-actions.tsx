"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, CheckSquare, FileText, FlaskConical, Mail, Phone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallLogDialog } from "@/components/dialogs/call-log-dialog";
import { EmailComposer } from "@/components/dialogs/email-composer";
import { MeetingDialog } from "@/components/dialogs/meeting-dialog";
import { TaskDialog } from "@/components/dialogs/task-dialog";

export type RecordContact = { id: string; name: string; email: string | null; phone: string | null };

export function RecordActions({ contact, dealId, companyId, compact = false }: { contact: RecordContact; dealId?: string | null; companyId?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState<"call" | "email" | "meeting" | "task" | null>(null);
  const close = (o: boolean) => !o && setOpen(null);
  const q = new URLSearchParams({ contactId: contact.id, ...(dealId ? { dealId } : {}) }).toString();
  return (
    <div data-tour="record-actions" className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setOpen("call")}>
        <Phone /> {!compact && "Appel"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("email")} disabled={!contact.email} title={!contact.email ? "Pas d'adresse email" : undefined}>
        <Mail /> {!compact && "Email"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("meeting")}>
        <CalendarPlus /> {!compact && "RDV"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen("task")}>
        <CheckSquare /> {!compact && "Tâche"}
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/devis/nouveau?${q}`}>
          <FileText /> {!compact && "Devis"}
        </Link>
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/essais/nouveau?${q}${companyId ? `&companyId=${companyId}` : ""}`}>
          <FlaskConical /> {!compact && "Essai"}
        </Link>
      </Button>
      <Button size="sm" asChild>
        <Link href={`/assistant/nouveau?${q}`}>
          <Sparkles /> {!compact && "Assistant IA"}
        </Link>
      </Button>
      {open === "call" && <CallLogDialog open onOpenChange={close} contactId={contact.id} contactName={contact.name} phone={contact.phone} dealId={dealId} />}
      {open === "email" && <EmailComposer open onOpenChange={close} to={contact.email} contactId={contact.id} contactName={contact.name} dealId={dealId} />}
      {open === "meeting" && <MeetingDialog open onOpenChange={close} contact={{ id: contact.id, label: contact.name }} dealId={dealId} onCreated={() => undefined} />}
      {open === "task" && <TaskDialog open onOpenChange={close} initial={{ contact: { id: contact.id, label: contact.name }, dealId: dealId ?? null }} />}
    </div>
  );
}
