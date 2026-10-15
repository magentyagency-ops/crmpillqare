import Link from "next/link";
import { ResetPasswordForm } from "@/components/forms/auth-forms";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

export const metadata = { title: "Mot de passe" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await db.userToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { firstName: true, active: true } } } });
  const valid = row && !row.usedAt && row.expiresAt > new Date() && row.user.active;
  if (!valid) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Lien expiré</h1>
        <p className="mb-6 text-sm text-muted-foreground">Ce lien n&apos;est plus valide. Demandez un nouveau lien ou contactez votre administrateur.</p>
        <Link href="/mot-de-passe-oublie" className="text-sm font-medium text-primary hover:underline">
          Demander un nouveau lien
        </Link>
      </>
    );
  }
  const invite = row.type === "INVITE";
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{invite ? `Bienvenue ${row.user.firstName} !` : "Nouveau mot de passe"}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {invite ? "Choisissez votre mot de passe pour activer votre accès au CRM PillQare." : "Choisissez votre nouveau mot de passe."}
      </p>
      <ResetPasswordForm token={token} invite={invite} />
    </>
  );
}
