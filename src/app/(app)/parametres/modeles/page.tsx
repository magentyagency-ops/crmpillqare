import { requireUser, isManager } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { SectionCard } from "@/components/common/ui-bits";
import { TemplatesManager } from "./templates-client";

export const metadata = { title: "Modèles d'emails" };

export default async function TemplatesPage() {
  const user = await requireUser();
  const templates = await db.emailTemplate.findMany({
    where: { OR: [{ ownerId: null }, { ownerId: user.id }] },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return (
    <SectionCard title="Modèles d'emails" description="Utilisables dans l'éditeur d'email : les variables sont remplacées par les informations du contact, du dossier et du commercial.">
      <TemplatesManager
        canShare={isManager(user)}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, subject: t.subject, body: t.body, shared: t.ownerId === null }))}
      />
    </SectionCard>
  );
}
