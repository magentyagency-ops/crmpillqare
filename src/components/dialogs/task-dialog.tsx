"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AsyncPicker } from "@/components/common/async-picker";
import { DateTimeField, FormField, QuickDates, SelectField } from "@/components/common/fields";
import { useAppData } from "@/components/app/app-data";
import { useAction } from "@/hooks/use-action";
import { searchContactsAction, type PickerOption } from "@/actions/contacts";
import { createTaskAction, updateTaskAction } from "@/actions/tasks";
import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import type { TaskPriority, TaskType } from "@/generated/prisma/enums";

export type TaskDialogInitial = {
  id?: string;
  title?: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  dueAt?: string;
  assigneeId?: string;
  contact?: PickerOption | null;
  dealId?: string | null;
  companyId?: string | null;
  meetingId?: string | null;
  trialId?: string | null;
  orderId?: string | null;
};

export function TaskDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial?: TaskDialogInitial }) {
  const { me, users } = useAppData();
  const editing = Boolean(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<TaskType>(initial?.type ?? "CALL");
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? "NORMAL");
  const [dueAt, setDueAt] = useState(initial?.dueAt ?? "");
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? me.id);
  const [contact, setContact] = useState<PickerOption | null>(initial?.contact ?? null);

  const create = useAction(createTaskAction, { onSuccess: () => onOpenChange(false) });
  const update = useAction((id: string, input: Parameters<typeof updateTaskAction>[1]) => updateTaskAction(id, input), { onSuccess: () => onOpenChange(false) });
  const pending = create.pending || update.pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier la tâche" : "Nouvelle tâche"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = {
              title,
              description,
              type,
              priority,
              dueAt,
              assigneeId,
              contactId: contact?.id ?? null,
              dealId: initial?.dealId ?? null,
              companyId: initial?.companyId ?? null,
              meetingId: initial?.meetingId ?? null,
              trialId: initial?.trialId ?? null,
              orderId: initial?.orderId ?? null,
            };
            if (editing) update.run(initial!.id!, input);
            else create.run(input);
          }}
        >
          <FormField label="Intitulé" required>
            <Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Ex. : Appeler pour confirmer la commande" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <SelectField value={type} onChange={(x) => setType(x as TaskType)} options={Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            <FormField label="Priorité">
              <SelectField value={priority} onChange={(x) => setPriority(x as TaskPriority)} options={Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
          </div>
          <FormField label="Échéance" hint="Sans heure : à faire dans la journée.">
            <DateTimeField value={dueAt} onChange={setDueAt} />
            <QuickDates onPick={setDueAt} tz={me.timezone} />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Assignée à">
              <SelectField value={assigneeId} onChange={setAssigneeId} options={users.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))} />
            </FormField>
            <FormField label="Contact">
              <AsyncPicker value={contact} onChange={setContact} search={searchContactsAction} placeholder="Facultatif" disabled={Boolean(initial?.dealId)} />
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending && <Spinner />} {editing ? "Enregistrer" : "Créer la tâche"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
