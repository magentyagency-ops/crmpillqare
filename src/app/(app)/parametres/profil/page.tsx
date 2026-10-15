import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/labels";
import { SectionCard } from "@/components/common/ui-bits";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata = { title: "Mon profil" };

export default async function ProfilePage() {
  const session = await requireUser();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.id } });
  return (
    <div className="space-y-6">
      <SectionCard title="Mon profil" description={`${user.email} · ${ROLE_LABELS[user.role]}`}>
        <ProfileForm
          initial={{
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone ?? "",
            jobTitle: user.jobTitle ?? "",
            color: user.color,
            signature: user.signature ?? "",
            timezone: user.timezone,
            dailyDigest: user.dailyDigest,
            syncTasksToCalendar: user.syncTasksToCalendar,
          }}
        />
      </SectionCard>
      <SectionCard title="Mot de passe">
        <PasswordForm />
      </SectionCard>
    </div>
  );
}
