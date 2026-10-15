import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { contactDisplayName } from "@/lib/labels";
import { daysAgo, formatDateTime } from "@/lib/dates";
import { SectionCard } from "@/components/common/ui-bits";
import { FormsManager } from "./forms-client";

export const metadata = { title: "Formulaires du site" };

export default async function FormsSettingsPage() {
  const user = await requireRole("ADMIN", "MANAGER");
  const since = daysAgo(30);
  const [forms, users, segments, submissions] = await Promise.all([
    db.webForm.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { submissions: { where: { createdAt: { gte: since }, isSpam: false } } } } } }),
    db.user.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true } }),
    db.segment.findMany({ where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.formSubmission.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { form: { select: { name: true } }, contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }, owner: { select: { firstName: true } } },
    }),
  ]);
  return (
    <div className="space-y-6">
      <SectionCard title="Formulaires du site" description="Chaque demande crée ou complète la fiche (sans doublon), l'attribue à un commercial, envoie la confirmation au prospect et crée une tâche de rappel.">
        <FormsManager
          appUrl={env.appUrl}
          users={users}
          segments={segments}
          forms={forms.map((f) => ({
            id: f.id,
            name: f.name,
            key: f.key,
            active: f.active,
            description: f.description ?? "",
            contactKind: f.contactKind,
            segmentId: f.segmentId ?? "",
            assignmentStrategy: f.assignmentStrategy,
            fixedOwnerId: f.fixedOwnerId ?? "",
            createDeal: f.createDeal,
            sendConfirmation: f.sendConfirmation,
            confirmationSubject: f.confirmationSubject ?? "",
            confirmationBody: f.confirmationBody ?? "",
            callbackDelayMinutes: String(f.callbackDelayMinutes),
            successMessage: f.successMessage ?? "",
            redirectUrl: f.redirectUrl ?? "",
            allowedOrigins: f.allowedOrigins.join("\n"),
            count: f._count.submissions,
          }))}
        />
      </SectionCard>
      <SectionCard title="Dernières demandes reçues" bodyClassName="p-0">
        {submissions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Aucune demande pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-36 shrink-0 text-xs text-muted-foreground">{formatDateTime(s.createdAt, user.timezone)}</span>
                <span className="w-48 shrink-0 truncate text-xs">{s.form.name}</span>
                {s.isSpam ? (
                  <span className="text-xs text-rose-600">Spam bloqué</span>
                ) : s.contact ? (
                  <Link href={`/contacts/${s.contact.id}`} className="flex-1 truncate hover:underline">
                    {contactDisplayName(s.contact)} {s.isExistingContact && <span className="text-xs text-muted-foreground">(contact existant)</span>}
                  </Link>
                ) : (
                  <span className="flex-1 text-muted-foreground">—</span>
                )}
                {s.owner && <span className="text-xs text-muted-foreground">→ {s.owner.firstName}</span>}
                {s.utmSource && <span className="text-xs text-muted-foreground">source : {s.utmSource}</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
