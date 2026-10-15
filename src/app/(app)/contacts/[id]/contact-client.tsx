"use client";

import { useState } from "react";
import { Ban, GitMerge, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Archive, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactDialog, type ContactDialogValue } from "@/components/dialogs/contact-dialog";
import { DealDialog } from "@/components/dialogs/deal-dialogs";
import { ConfirmButton } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { archiveContactAction, deleteContactAction, mergeContactsAction, setDoNotContactAction } from "@/actions/contacts";

export function ContactHeaderActions({ value, archived, doNotContact }: { value: ContactDialogValue & { id: string }; archived: boolean; doNotContact: boolean }) {
  const { me } = useAppData();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const archive = useAction((v: boolean) => archiveContactAction(value.id, v));
  const dnc = useAction((v: boolean) => setDoNotContactAction(value.id, v));
  const del = useAction(() => deleteContactAction(value.id), { onSuccess: () => router.push("/contacts"), refresh: false });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
        <Pencil /> Modifier
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="Plus">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {doNotContact ? (
            <DropdownMenuItem onSelect={() => dnc.run(false)}>
              <CheckCircle2 /> Réautoriser les emails
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => dnc.run(true)}>
              <Ban /> Ne plus contacter (opposition)
            </DropdownMenuItem>
          )}
          {archived ? (
            <DropdownMenuItem onSelect={() => archive.run(false)}>
              <RotateCcw /> Restaurer
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => archive.run(true)}>
              <Archive /> Archiver
            </DropdownMenuItem>
          )}
          {me.role === "ADMIN" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (window.confirm("Supprimer définitivement ce contact et tout son historique (droit à l'effacement RGPD) ?")) del.run();
                }}
              >
                <Trash2 /> Supprimer définitivement
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {edit && <ContactDialog open onOpenChange={setEdit} initial={value} onSaved={() => router.refresh()} />}
    </>
  );
}

export function NewDealForContact({ contactId, label }: { contactId: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>
        <Plus className="mr-0.5 inline size-3" /> Nouveau dossier
      </button>
      {open && <DealDialog open onOpenChange={setOpen} initial={{ contact: { id: contactId, label } }} />}
    </>
  );
}

export function MergeButton({ primaryId, duplicateId, label }: { primaryId: string; duplicateId: string; label: string }) {
  const merge = useAction(() => mergeContactsAction(primaryId, duplicateId));
  return (
    <ConfirmButton
      title={`Fusionner « ${label} » dans cette fiche ?`}
      description="Tout l'historique (emails, dossiers, tâches, RDV, devis, commandes) sera rattaché à cette fiche, puis le doublon sera supprimé."
      confirmLabel="Fusionner"
      size="xs"
      onConfirm={() => merge.run()}
    >
      <GitMerge /> Fusionner
    </ConfirmButton>
  );
}
