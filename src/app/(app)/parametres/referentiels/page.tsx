import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { SectionCard } from "@/components/common/ui-bits";
import { LostReasonsEditor, SegmentsEditor } from "./referentials-client";

export const metadata = { title: "Cibles et motifs" };

export default async function ReferentialsPage() {
  await requireRole("ADMIN", "MANAGER");
  const [segments, reasons] = await Promise.all([
    db.segment.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { contacts: true } } } }),
    db.lostReason.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { deals: true } } } }),
  ]);
  return (
    <div className="space-y-6">
      <SectionCard title="Cibles (segments)" description="Classement des contacts et organisations. Les relances et l'attribution des leads peuvent dépendre de la cible.">
        <SegmentsEditor segments={segments.map((s) => ({ id: s.id, name: s.name, kind: s.kind, color: s.color, description: s.description ?? "", keywords: s.keywords.join(", "), active: s.active, count: s._count.contacts }))} />
      </SectionCard>
      <SectionCard title="Motifs de refus" description="Obligatoires quand un dossier passe en « Refusé » ; analysés dans le tableau de bord.">
        <LostReasonsEditor reasons={reasons.map((r) => ({ id: r.id, label: r.label, active: r.active, count: r._count.deals }))} />
      </SectionCard>
    </div>
  );
}
