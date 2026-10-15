import { CheckSquare } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { addDaysTz, endOfDayTz, startOfDayTz, startOfWeekTz } from "@/lib/dates";
import { TASK_TYPE_LABELS } from "@/lib/labels";
import { EmptyHint, PageHeader, SectionCard } from "@/components/common/ui-bits";
import { SearchFilter, SelectFilter, TabLinks } from "@/components/common/filters";
import { TaskRow } from "@/components/tasks/task-row";
import { NewTaskButton } from "./tasks-client";
import { allWords, contactSearchWhere } from "@/lib/search";

export const metadata = { title: "Tâches" };

type Search = { vue?: string; assignee?: string; type?: string; q?: string; task?: string };

const taskInclude = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
  deal: { select: { id: true, title: true } },
} as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.vue ?? "a-faire";
  const tz = user.timezone;
  const now = new Date();
  const todayStart = startOfDayTz(now, tz);
  const todayEnd = endOfDayTz(now, tz);

  const assigneeFilter: Prisma.TaskWhereInput =
    sp.assignee === "all" && isManager(user) ? {} : sp.assignee && sp.assignee !== "all" && isManager(user) ? { assigneeId: sp.assignee } : { assigneeId: user.id };
  const base: Prisma.TaskWhereInput = {
    ...assigneeFilter,
    ...(sp.type ? { type: sp.type as Prisma.EnumTaskTypeFilter["equals"] } : {}),
    ...(sp.q
      ? {
          OR: [allWords(sp.q, (w) => ({ title: { contains: w, mode: "insensitive" as const } })), { contact: contactSearchWhere(sp.q) }],
        }
      : {}),
  };
  const viewWhere: Record<string, Prisma.TaskWhereInput> = {
    "a-faire": { status: "OPEN" },
    retard: { status: "OPEN", dueAt: { lt: todayStart } },
    aujourdhui: { status: "OPEN", dueAt: { gte: todayStart, lte: todayEnd } },
    avenir: { status: "OPEN", dueAt: { gt: todayEnd } },
    "sans-date": { status: "OPEN", dueAt: null },
    terminees: { status: "DONE" },
  };

  const [tasks, counts, users, selected] = await Promise.all([
    db.task.findMany({
      where: { ...base, ...viewWhere[view] },
      include: taskInclude,
      orderBy: view === "terminees" ? [{ completedAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: view === "terminees" ? 100 : 500,
    }),
    Promise.all(Object.entries(viewWhere).map(async ([k, w]) => [k, await db.task.count({ where: { ...base, ...w } })] as const)),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
    sp.task ? db.task.findUnique({ where: { id: sp.task }, include: taskInclude }) : null,
  ]);
  const count = Object.fromEntries(counts);

  // Regroupement par échéance
  const tomorrowEnd = endOfDayTz(addDaysTz(now, 1, tz), tz);
  const weekEnd = endOfDayTz(addDaysTz(startOfWeekTz(now, tz), 6, tz), tz);
  const groups: { label: string; items: typeof tasks; tone?: string }[] =
    view === "terminees"
      ? [{ label: "Terminées récemment", items: tasks }]
      : [
          { label: "En retard", items: tasks.filter((t) => t.dueAt && t.dueAt < todayStart), tone: "text-rose-600" },
          { label: "Aujourd'hui", items: tasks.filter((t) => t.dueAt && t.dueAt >= todayStart && t.dueAt <= todayEnd) },
          { label: "Demain", items: tasks.filter((t) => t.dueAt && t.dueAt > todayEnd && t.dueAt <= tomorrowEnd) },
          { label: "Cette semaine", items: tasks.filter((t) => t.dueAt && t.dueAt > tomorrowEnd && t.dueAt <= weekEnd) },
          { label: "Plus tard", items: tasks.filter((t) => t.dueAt && t.dueAt > weekEnd) },
          { label: "Sans échéance", items: tasks.filter((t) => !t.dueAt) },
        ];

  return (
    <>
      <PageHeader title="Tâches" description="Appels, relances, rappels de leads et suivis à réaliser." actions={<NewTaskButton />} />
      {selected && (
        <SectionCard title="Tâche sélectionnée" className="mb-4 ring-2 ring-primary/30">
          <div className="-mx-2">
            <TaskRow task={selected} tz={tz} />
          </div>
        </SectionCard>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="vue"
          tabs={[
            { value: "a-faire", label: "À faire", count: count["a-faire"] },
            { value: "retard", label: "En retard", count: count.retard, tone: "danger" },
            { value: "aujourdhui", label: "Aujourd'hui", count: count.aujourdhui },
            { value: "avenir", label: "À venir", count: count.avenir },
            { value: "sans-date", label: "Sans date", count: count["sans-date"] },
            { value: "terminees", label: "Terminées" },
          ]}
        />
        <SearchFilter placeholder="Rechercher…" />
        <SelectFilter param="type" placeholder="Tous les types" options={Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        {isManager(user) && (
          <SelectFilter param="assignee" placeholder="Mes tâches" options={[{ value: "all", label: "Toute l'équipe" }, ...users.filter((u) => u.id !== user.id).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
        )}
      </div>
      {tasks.length === 0 ? (
        <SectionCard>
          <EmptyHint icon={CheckSquare} title="Aucune tâche dans cette vue" />
        </SectionCard>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <SectionCard key={g.label} title={<span className={g.tone}>{`${g.label} (${g.items.length})`}</span>}>
                <div className="-mx-2 divide-y">
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} tz={tz} />
                  ))}
                </div>
              </SectionCard>
            ))}
        </div>
      )}
    </>
  );
}
