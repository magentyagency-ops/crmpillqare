"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealDialog } from "@/components/dialogs/deal-dialogs";

export function NewDealButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nouveau dossier
      </Button>
      {open && <DealDialog open onOpenChange={setOpen} />}
    </>
  );
}
