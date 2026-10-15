"use client";

import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CompanyDialog, type CompanyValue } from "@/components/dialogs/company-dialog";
import { ContactDialog, emptyContact } from "@/components/dialogs/contact-dialog";
import { ConfirmButton } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { archiveCompanyAction } from "@/actions/companies";

export function NewCompanyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nouvelle organisation
      </Button>
      {open && <CompanyDialog open onOpenChange={setOpen} />}
    </>
  );
}

export function CompanyActions({ value, archived }: { value: CompanyValue & { id: string }; archived: boolean }) {
  const { me } = useAppData();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [addContact, setAddContact] = useState(false);
  const archive = useAction((v: boolean) => archiveCompanyAction(value.id, v));
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAddContact(true)}>
        <UserPlus /> Ajouter un contact
      </Button>
      <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
        <Pencil /> Modifier
      </Button>
      {archived ? (
        <Button size="sm" variant="outline" onClick={() => archive.run(false)}>
          <RotateCcw /> Restaurer
        </Button>
      ) : (
        <ConfirmButton title="Archiver cette organisation ?" onConfirm={() => archive.run(true)}>
          <Archive /> Archiver
        </ConfirmButton>
      )}
      {edit && <CompanyDialog open onOpenChange={setEdit} initial={value} />}
      {addContact && (
        <ContactDialog
          open
          onOpenChange={setAddContact}
          initial={{ ...emptyContact(value.ownerId || me.id), kind: "B2B", company: { id: value.id, label: value.name }, segmentId: value.segmentId }}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
