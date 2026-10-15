"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Check, Mail, MoreHorizontal, Pencil, Phone, Repeat, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityBadge } from "@/components/common/ui-bits";
import { CallLogDialog } from "@/components/dialogs/call-log-dialog";
import { NextActionDialog } from "@/components/dialogs/deal-dialogs";
import { TaskDialog } from "@/components/dialogs/task-dialog";
import { EmailComposer } from "@/components/dialogs/email-composer";
import { useAction } from "@/hooks/use-action";
import { cancelTaskAction, completeTaskAction, deleteTaskAction, postponeTaskAction, reopenTaskAction } from "@/actions/tasks";
import { TASK_TYPE_LABELS, contactDisplayName } from "@/lib/labels";
import { formatSmart, toDateTimeLocalValue, toDateInputValue } from "@/lib/dates";
import { formatPhone } from "@/lib/normalize";
import type { TaskPriority, TaskStatus, TaskType, TaskSource } from "@/generated/prisma/enums";

export type TaskRowData = {
  id: string;
  title: string;
  description: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  dueAt: Date | null;
  hasTime: boolean;
  assigneeId: string;
  contact: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; company?: { name: string } | null } | null;
  deal: { id: string; title: string } | null;
  dealId: string | null;
  meetingId?: string | null;
  orderId?: string | null;
  trialId?: string | null;
};

export function TaskRow({ task, showContact = true, tz }: { task: TaskRowData; showContact?: boolean; tz?: string }) {
  const [callOpen, setCallOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const complete = useAction(completeTaskAction, {
    success: false,
    onSuccess: (data) => {
      if (data?.dealId && !data.dealHasNextAction) setNextOpen(true);
    },
  });
  const reopen = useAction(reopenTaskAction);
  const postpone = useAction(postponeTaskAction);
  const cancel = useAction(cancelTaskAction);
  const remove = useAction(deleteTaskAction);
  const now = new Date();
  const overdue = task.status === "OPEN" && task.dueAt && task.dueAt.getTime() < now.getTime() - (task.hasTime ? 15 * 60_000 : 24 * 3600_000);
  const done = task.status !== "OPEN";
  const isCall = task.type === "CALL" || task.type === "CALLBACK";
  const isEmail = task.type === "EMAIL" || task.type === "FOLLOW_UP";
  const name = task.contact ? contactDisplayName(task.contact) : null;

  return (
    <div className={cn("group flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-accent/50", done && "opacity-60")}>
      <Checkbox
        className="mt-0.5"
        checked={done}
        disabled={complete.pending || reopen.pending}
        onCheckedChange={(c) => (c ? complete.run(task.id, null) : reopen.run(task.id))}
        aria-label="Terminer"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm font-medium", done && "line-through")}>{task.title}</span>
          <PriorityBadge priority={task.priority} />
          {task.source === "SEQUENCE" && (
            <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              <Repeat className="size-3" /> Relance auto
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{TASK_TYPE_LABELS[task.type]}</span>
          {task.dueAt && (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-rose-600")}>
              <CalendarClock className="size-3" />
              {formatSmart(task.dueAt, { withTime: task.hasTime, tz })}
              {overdue && " · en retard"}
            </span>
          )}
          {showContact && task.contact && (
            <Link href={`/contacts/${task.contact.id}`} className="hover:text-foreground hover:underline">
              {name}
              {task.contact.company?.name ? ` · ${task.contact.company.name}` : ""}
            </Link>
          )}
          {task.deal && (
            <Link href={`/pipeline/${task.deal.id}`} className="hover:text-foreground hover:underline">
              Dossier : {task.deal.title}
            </Link>
          )}
          {isCall && task.contact?.phone && (
            <a href={`tel:${task.contact.phone}`} className="font-medium text-primary hover:underline">
              {formatPhone(task.contact.phone)}
            </a>
          )}
        </div>
        {task.description && <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{task.description}</p>}
      </div>
      {!done && (
        <div className="flex shrink-0 items-center gap-1">
          {isCall && task.contact && (
            <Button size="xs" variant="outline" onClick={() => setCallOpen(true)}>
              <Phone /> Appel
            </Button>
          )}
          {isEmail && task.contact?.email && (
            <Button size="xs" variant="outline" onClick={() => setEmailOpen(true)}>
              <Mail /> Email
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" title="Terminer" onClick={() => complete.run(task.id, null)} disabled={complete.pending}>
            <Check />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Plus d'actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => postpone.run(task.id, 1)}>
                <RotateCcw /> Reporter à demain
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => postpone.run(task.id, 7)}>
                <RotateCcw /> Reporter d&apos;une semaine
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil /> Modifier
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => cancel.run(task.id)}>
                <X /> Annuler la tâche
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => remove.run(task.id)}>
                <Trash2 /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {callOpen && task.contact && (
        <CallLogDialog open onOpenChange={setCallOpen} contactId={task.contact.id} contactName={name ?? ""} phone={task.contact.phone} dealId={task.dealId} taskId={task.id} />
      )}
      {emailOpen && task.contact && (
        <EmailComposer open onOpenChange={setEmailOpen} to={task.contact.email} contactId={task.contact.id} contactName={name} dealId={task.dealId} />
      )}
      {editOpen && (
        <TaskDialog
          open
          onOpenChange={setEditOpen}
          initial={{
            id: task.id,
            title: task.title,
            description: task.description ?? "",
            type: task.type,
            priority: task.priority,
            dueAt: task.dueAt ? (task.hasTime ? toDateTimeLocalValue(task.dueAt, tz) : toDateInputValue(task.dueAt, tz)) : "",
            assigneeId: task.assigneeId,
            contact: task.contact ? { id: task.contact.id, label: name ?? "" } : null,
            dealId: task.dealId,
          }}
        />
      )}
      {nextOpen && task.dealId && <NextActionDialog open onOpenChange={setNextOpen} dealId={task.dealId} />}
    </div>
  );
}
