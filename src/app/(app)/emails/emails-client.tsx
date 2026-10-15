"use client";

import { useState } from "react";
import { CheckCheck, PenSquare, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailComposer } from "@/components/dialogs/email-composer";
import { useAction } from "@/hooks/use-action";
import { markEmailHandledAction, retryEmailAction, syncMyMailboxesAction } from "@/actions/emails";

export function EmailsToolbar({ hasMailbox }: { hasMailbox: boolean }) {
  const [open, setOpen] = useState(false);
  const sync = useAction(syncMyMailboxesAction, { success: false, onSuccess: () => undefined });
  return (
    <>
      {hasMailbox && (
        <Button size="sm" variant="outline" disabled={sync.pending} onClick={() => sync.run()}>
          <RefreshCw className={sync.pending ? "animate-spin" : ""} /> Synchroniser
        </Button>
      )}
      <Button size="sm" onClick={() => setOpen(true)}>
        <PenSquare /> Nouvel email
      </Button>
      {open && <EmailComposer open onOpenChange={setOpen} />}
    </>
  );
}

export function HandledButton({ id }: { id: string }) {
  const handled = useAction(markEmailHandledAction);
  return (
    <Button size="xs" variant="outline" disabled={handled.pending} onClick={() => handled.run(id, true)}>
      <CheckCheck /> Traité
    </Button>
  );
}

export function RetryButton({ id }: { id: string }) {
  const retry = useAction(retryEmailAction);
  return (
    <Button size="xs" variant="outline" disabled={retry.pending} onClick={() => retry.run(id)}>
      <RotateCw /> Renvoyer
    </Button>
  );
}
