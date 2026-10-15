import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSchedulerState } from "@/lib/scheduler";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { SectionCard } from "@/components/common/ui-bits";
import { SystemActions } from "./system-client";

export const metadata = { title: "État du système" };

const TASK_LABELS: Record<string, string> = {
  jobs: "Tâches de fond (envois, synchronisations)",
  sequences: "Relances automatiques",
  meetingReminders: "Rappels de RDV",
  taskReminders: "Rappels de tâches",
  endedMeetings: "RDV terminés (CR, transcriptions Meet)",
  aiRecovery: "Reprise des analyses IA",
  emailSync: "Synchronisation des emails",
  calendarSync: "Synchronisation Google Agenda",
  shopifySync: "Synchronisation Shopify",
  quotesExpire: "Expiration des devis",
  digests: "Planning quotidien",
  cleanup: "Nettoyage",
};

export default async function SystemPage() {
  const user = await requireRole("ADMIN");
  const [state, failed, pending, counts] = await Promise.all([
    getSchedulerState(),
    db.job.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.job.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    Promise.all([db.contact.count(), db.deal.count(), db.emailMessage.count(), db.meeting.count(), db.order.count(), db.aiSession.count()]),
  ]);
  const tz = user.timezone;
  return (
    <div className="space-y-6">
      <SectionCard title="Planificateur" description={`Mode : ${env.schedulerMode === "internal" ? "intégré au serveur" : "externe"} · ${pending} tâche(s) en attente`} actions={<SystemActions />}>
        <ul className="divide-y text-sm">
          {Object.entries(TASK_LABELS).map(([k, label]) => {
            const s = state[k];
            return (
              <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{label}</span>
                <span className={`text-xs ${!s ? "text-muted-foreground" : s.ok ? "text-emerald-700" : "text-rose-600"}`}>
                  {s ? `${s.ok ? "OK" : `Erreur : ${s.error}`} · ${formatRelative(new Date(s.lastRun))}${s.ms !== undefined ? ` · ${s.ms} ms` : ""}` : "jamais exécuté"}
                </span>
              </li>
            );
          })}
        </ul>
      </SectionCard>
      <SectionCard title={`Tâches en échec (${failed.length})`}>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {failed.map((j) => (
              <li key={j.id} className="rounded-md border p-2">
                <div className="font-medium">
                  {j.type} <span className="text-xs text-muted-foreground">· {formatDateTime(j.updatedAt, tz)} · {j.attempts} tentative(s)</span>
                </div>
                <div className="text-xs break-all text-rose-600">{j.lastError}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Volumétrie">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
          {["Contacts", "Dossiers", "Emails", "RDV", "Commandes", "Sessions IA"].map((l, i) => (
            <div key={l} className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">{l}</div>
              <div className="text-xl font-bold tabular-nums">{counts[i]}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
