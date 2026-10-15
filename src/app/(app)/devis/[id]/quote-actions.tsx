"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Copy, Download, FileX2, Link2, MoreHorizontal, Pencil, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import { deleteQuoteAction, duplicateQuoteAction, getQuoteEmailDefaultsAction, sendQuoteAction, setQuoteStatusAction } from "@/actions/quotes";
import type { QuoteStatus } from "@/generated/prisma/enums";

function SendDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    getQuoteEmailDefaultsAction(id).then((d) => {
      setTo(d.to);
      setSubject(d.subject);
      setBody(d.body);
      setLoading(false);
    });
  }, [id]);
  const send = useAction(() => sendQuoteAction(id, { to, cc, subject, body }), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Envoyer le devis</DialogTitle>
          <DialogDescription>Le PDF est joint automatiquement, avec un lien pour consulter et accepter le devis en ligne. Le dossier passe en « Devis ».</DialogDescription>
        </DialogHeader>
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="À">
                <Input className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
              </FormField>
              <FormField label="Cc">
                <Input className="h-9" value={cc} onChange={(e) => setCc(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Objet">
              <Input className="h-9" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </FormField>
            <FormField label="Message" hint="Votre signature est ajoutée automatiquement.">
              <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </FormField>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={send.pending || loading} onClick={() => send.run()}>
            {send.pending ? <Spinner /> : <Send />} Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefuseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const refuse = useAction(() => setQuoteStatusAction(id, "REFUSED", reason || null), { onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Devis refusé</DialogTitle>
        </DialogHeader>
        <FormField label="Motif">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="destructive" disabled={refuse.pending} onClick={() => refuse.run()}>
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuoteActions({ id, status, publicUrl }: { id: string; status: QuoteStatus; publicUrl: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"send" | "refuse" | null>(null);
  const accept = useAction(() => setQuoteStatusAction(id, "ACCEPTED"));
  const toDraft = useAction(() => setQuoteStatusAction(id, "DRAFT"));
  const duplicate = useAction(() => duplicateQuoteAction(id), { onSuccess: (d) => d && router.push(`/devis/${d.id}/modifier`) });
  const remove = useAction(() => deleteQuoteAction(id), { onSuccess: () => router.push("/devis"), refresh: false });
  return (
    <>
      {status === "DRAFT" && (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/devis/${id}/modifier`}>
            <Pencil /> Modifier
          </Link>
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <a href={`/api/devis/${id}/pdf`} target="_blank" rel="noreferrer">
          <Download /> PDF
        </a>
      </Button>
      {(status === "DRAFT" || status === "SENT" || status === "EXPIRED") && (
        <Button size="sm" onClick={() => setDialog("send")}>
          <Send /> {status === "DRAFT" ? "Envoyer au client" : "Renvoyer"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="Plus">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {status !== "DRAFT" && (
            <DropdownMenuItem
              onSelect={async () => {
                await navigator.clipboard.writeText(publicUrl).catch(() => undefined);
                toast.success("Lien d'acceptation copié", { description: publicUrl });
              }}
            >
              <Link2 /> Copier le lien client
            </DropdownMenuItem>
          )}
          {status === "SENT" && (
            <>
              <DropdownMenuItem onSelect={() => accept.run()}>
                <Check /> Marquer comme accepté (signé)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("refuse")}>
                <FileX2 /> Marquer comme refusé
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toDraft.run()}>
                <Undo2 /> Repasser en brouillon
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => duplicate.run()}>
            <Copy /> Dupliquer (nouvelle version)
          </DropdownMenuItem>
          {status === "DRAFT" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => remove.run()}>
                <Trash2 /> Supprimer le brouillon
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "send" && <SendDialog id={id} onClose={() => setDialog(null)} />}
      {dialog === "refuse" && <RefuseDialog id={id} onClose={() => setDialog(null)} />}
    </>
  );
}
