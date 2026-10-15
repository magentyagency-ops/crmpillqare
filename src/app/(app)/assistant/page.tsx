import Link from "next/link";
import { Sparkles } from "lucide-react";
import { llmProviderLabel } from "@/lib/ai/llm";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { aiAvailable } from "@/lib/ai/report";
import { transcriptionProviderLabel } from "@/lib/ai/transcription";
import { AI_KIND_LABELS, AI_STATUS_LABELS, contactDisplayName } from "@/lib/labels";
import { formatDateTime } from "@/lib/dates";
import { formatDuration } from "@/lib/format";
import { EmptyHint, PageHeader, Pill, SectionCard, UserAvatar } from "@/components/common/ui-bits";
import { TabLinks } from "@/components/common/filters";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Assistant IA" };

const TONE: Record<string, string> = {
  READY: "bg-amber-100 text-amber-800",
  VALIDATED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-700",
  RECORDING: "bg-sky-100 text-sky-800",
  TRANSCRIBING: "bg-sky-100 text-sky-800",
  ANALYZING: "bg-sky-100 text-sky-800",
};

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ vue?: string; equipe?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.vue ?? "a-valider";
  const team = sp.equipe === "1" && isManager(user);
  const base: Prisma.AiSessionWhereInput = team ? {} : { userId: user.id };
  const filters: Record<string, Prisma.AiSessionWhereInput> = {
    "a-valider": { status: { in: ["READY", "FAILED"] } },
    "en-cours": { status: { in: ["RECORDING", "TRANSCRIBING", "ANALYZING"] } },
    valides: { status: "VALIDATED" },
    tous: {},
  };
  const [sessions, toValidate] = await Promise.all([
    db.aiSession.findMany({
      where: { ...base, ...(filters[view] ?? {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: { select: { name: true } } } },
        user: { select: { firstName: true, lastName: true, color: true } },
      },
    }),
    db.aiSession.count({ where: { ...base, status: { in: ["READY", "FAILED"] } } }),
  ]);
  const provider = transcriptionProviderLabel();

  return (
    <>
      <PageHeader
        title="Assistant IA"
        description="Transcription des appels, visios et RDV physiques, compte rendu automatique et email de suivi à valider."
        actions={
          <Button asChild size="sm">
            <Link href="/assistant/nouveau">
              <Sparkles /> Nouvel échange
            </Link>
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className={`rounded-xl p-4 text-sm ring-1 ${aiAvailable() ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
          <div className="font-semibold">Compte rendu par IA</div>
          <div className="text-muted-foreground">{aiAvailable() ? `IA configurée ✓ (${llmProviderLabel()})` : "Non configurée : ajoutez OPENAI_API_KEY ou ANTHROPIC_API_KEY."}</div>
        </div>
        <div className={`rounded-xl p-4 text-sm ring-1 ${provider ? "bg-emerald-50 ring-emerald-200" : "bg-sky-50 ring-sky-200"}`}>
          <div className="font-semibold">Transcription</div>
          <div className="text-muted-foreground">{provider ? `${provider} ✓ (audio direct, import de fichiers)` : "Reconnaissance vocale du navigateur (Chrome/Edge). Ajoutez une clé ElevenLabs, OpenAI ou Deepgram pour l'import audio et la capture des visios."}</div>
        </div>
        <div className="rounded-xl bg-card p-4 text-sm surface">
          <div className="font-semibold">CR automatique après chaque RDV</div>
          <div className="text-muted-foreground">Une tâche « compte rendu » est créée après chaque RDV ; les transcriptions Google Meet sont récupérées automatiquement.</div>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabLinks
          param="vue"
          tabs={[
            { value: "a-valider", label: "À valider", count: toValidate, tone: "warning" },
            { value: "en-cours", label: "En cours" },
            { value: "valides", label: "Validés" },
            { value: "tous", label: "Tous" },
          ]}
        />
        {isManager(user) && (
          <Link href={team ? "/assistant" : "/assistant?equipe=1"} className="text-sm text-primary hover:underline">
            {team ? "Mes échanges" : "Toute l'équipe"}
          </Link>
        )}
      </div>
      <SectionCard bodyClassName="p-0">
        {sessions.length === 0 ? (
          <EmptyHint icon={Sparkles} title="Aucun échange dans cette vue" action={<Button asChild size="sm"><Link href="/assistant/nouveau">Démarrer l&apos;assistant</Link></Button>} />
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/assistant/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/50">
                  <Sparkles className="size-4 text-fuchsia-600" />
                  <div className="min-w-60 flex-1">
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {AI_KIND_LABELS[s.kind]} · {formatDateTime(s.startedAt, user.timezone)}
                      {s.durationSec ? ` · ${formatDuration(s.durationSec)}` : ""}
                      {s.contact ? ` · ${contactDisplayName(s.contact)}${s.contact.company ? ` (${s.contact.company.name})` : ""}` : ""}
                    </div>
                    {s.summary && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{s.summary}</div>}
                  </div>
                  {team && <UserAvatar user={s.user} size="xs" />}
                  <Pill className={TONE[s.status] ?? ""}>{AI_STATUS_LABELS[s.status]}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
