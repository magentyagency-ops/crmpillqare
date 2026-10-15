import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SetupForm } from "@/components/forms/auth-forms";
import { db } from "@/lib/db";

export const metadata = { title: "Installation" };

export default async function SetupPage() {
  // Toujours évalué à la requête : l'état d'installation dépend de la base, pas du build.
  await connection();
  if ((await db.user.count()) > 0) redirect("/login");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Bienvenue dans le CRM PillQare</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Créez le compte administrateur. Les cibles, produits, modèles d&apos;emails et scénarios de relance PillQare sont installés
        automatiquement.
      </p>
      <SetupForm />
    </>
  );
}
