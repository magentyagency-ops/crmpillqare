import { requireUser, isManager, isAdmin } from "@/lib/auth/guards";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = [
    { href: "/parametres/profil", label: "Mon profil et ma signature", group: "Mon compte" },
    { href: "/parametres/integrations", label: "Email, agenda, Shopify", group: "Mon compte" },
    { href: "/parametres/rendez-vous", label: "Prise de rendez-vous", group: "Mon compte" },
    { href: "/parametres/modeles", label: "Modèles d'emails", group: "Mon compte" },
    ...(isManager(user)
      ? [
          { href: "/parametres/equipe", label: "Équipe et accès", group: "Organisation" },
          { href: "/parametres/regles", label: "Pipeline, relances, rappels", group: "Organisation" },
          { href: "/parametres/referentiels", label: "Cibles et motifs de refus", group: "Organisation" },
          { href: "/parametres/produits", label: "Produits et tarifs", group: "Organisation" },
          { href: "/parametres/formulaires", label: "Formulaires du site", group: "Organisation" },
        ]
      : []),
    ...(isAdmin(user)
      ? [
          { href: "/parametres/entreprise", label: "Entreprise et devis", group: "Administration" },
          { href: "/parametres/systeme", label: "État du système", group: "Administration" },
        ]
      : []),
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
      <SettingsNav items={items} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
