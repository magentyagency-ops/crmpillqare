"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/dialogs/task-dialog";

export function NewTaskButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nouvelle tâche
      </Button>
      {open && <TaskDialog open onOpenChange={setOpen} />}
    </>
  );
}
