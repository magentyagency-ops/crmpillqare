import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PublicShell } from "@/components/public/public-shell";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata = { title: "Désinscription", robots: { index: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contact = await db.contact.findUnique({ where: { unsubscribeToken: token }, select: { doNotContact: true, email: true } });
  if (!contact) notFound();
  return (
    <PublicShell>
      <div className="rounded-2xl bg-card p-6 text-center shadow-sm surface md:p-10">
        <h1 className="text-xl font-bold text-brand-navy">Gestion de vos préférences</h1>
        {contact.doNotContact ? (
          <p className="mt-3 text-sm text-muted-foreground">Vous êtes désinscrit(e) : vous ne recevrez plus nos messages{contact.email ? ` sur ${contact.email}` : ""}.</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground">Vous ne souhaitez plus recevoir nos emails{contact.email ? ` sur ${contact.email}` : ""} ?</p>
            <div className="mt-6">
              <UnsubscribeButton token={token} />
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
