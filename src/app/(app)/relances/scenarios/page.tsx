import Link from "next/link";
import { Mail, Phone, CheckSquare, Plus } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { SEQUENCE_TRIGGER_LABELS, STAGE_LABELS } from "@/lib/labels";
import { PageHeader, Pill, SectionCard } from "@/components/common/ui-bits";
import { Button } from "@/components/ui/button";
import { SequenceToggle } from "./scenario-client";

export const metadata = { title: "Scénarios de relance" };

const ICON = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare } as const;

export default async function ScenariosPage() {
  const user = await requireUser();
  const [sequences, segments] = await Promise.all([
    db.sequence.findMany({
      // Les séries ponctuelles créées par le copilote se suivent depuis la page Relances et les fiches
      where: { createdByAssistant: false },
      orderBy: [{ trigger: "asc" }, { triggerStage: "asc" }, { name: "asc" }],
      include: {
        steps: { where: { archivedAt: null }, orderBy: { position: "asc" } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    }),
    db.segment.findMany({ select: { id: true, name: true } }),
  ]);
  const manager = isManager(user);
  return (
    <>
      <PageHeader
        back={{ href: "/relances", label: "Relances" }}
        title="Scénarios de relance"
        description="Chaque scénario se déclenche automatiquement selon l'étape du dossier, le type de client (B2B/B2C) et la cible. Le scénario le plus spécifique est choisi."
        actions={
          manager ? (
            <Button asChild size="sm">
              <Link href="/relances/scenarios/nouveau">
                <Plus /> Nouveau scénario
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sequences.map((s) => (
          <SectionCard
            key={s.id}
            title={
              <Link href={`/relances/scenarios/${s.id}`} className="hover:underline">
                {s.name}
              </Link>
            }
            description={s.description ?? undefined}
            actions={manager ? <SequenceToggle id={s.id} active={s.active} /> : undefined}
            className={s.active ? "" : "opacity-60"}
          >
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              <Pill className="bg-indigo-50 text-indigo-800">
                {SEQUENCE_TRIGGER_LABELS[s.trigger]}
                {s.triggerStage ? ` : ${STAGE_LABELS[s.triggerStage]}` : ""}
              </Pill>
              <Pill className="bg-muted">{s.contactKind ? (s.contactKind === "B2B" ? "Professionnels" : "Particuliers") : "B2B et B2C"}</Pill>
              {s.segmentIds.length > 0 && <Pill className="bg-muted">Cibles : {segments.filter((x) => s.segmentIds.includes(x.id)).map((x) => x.name).join(", ")}</Pill>}
              <Pill className="bg-emerald-50 text-emerald-800">{s._count.enrollments} en cours</Pill>
            </div>
            <ol className="space-y-1.5">
              {s.steps.map((st) => {
                const Icon = ICON[st.type];
                return (
                  <li key={st.id} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">J+{s.steps.slice(0, st.position).reduce((a, x) => a + x.delayDays, 0)}</span>
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{st.type === "EMAIL" ? st.subject || "Relance dans le fil" : st.taskTitle}</span>
                    {st.requiresApproval && <Pill className="bg-amber-100 text-amber-800">validation</Pill>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 text-xs text-muted-foreground">
              Arrêt automatique : {[s.stopOnReply && "réponse", s.stopOnMeetingBooked && "RDV pris", s.stopOnStageChange && "changement d'étape"].filter(Boolean).join(", ") || "aucun"}
            </div>
          </SectionCard>
        ))}
      </div>
    </>
  );
}
