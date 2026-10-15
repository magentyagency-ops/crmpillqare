import { BrandMark } from "@/components/brand";
import { getSettings } from "@/lib/settings";

/** Habillage des pages publiques (prise de RDV, devis, satisfaction…). */
export async function PublicShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const company = await getSettings("company");
  return (
    <div className="min-h-screen bg-[#f6f7f9] bg-[radial-gradient(60rem_26rem_at_50%_-8%,rgba(18,41,90,0.09),transparent)]">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-5">
        <BrandMark size={32} />
        <span className="text-lg font-bold text-brand-navy">{company.name}</span>
      </header>
      <main className={`mx-auto px-4 pb-16 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</main>
      <footer className="pb-8 text-center text-xs text-muted-foreground">
        {company.name} — une solution française de gestion des médicaments
        {company.website ? (
          <>
            {" · "}
            <a href={company.website} className="hover:underline">
              {company.website.replace(/^https?:\/\//, "")}
            </a>
          </>
        ) : null}
      </footer>
    </div>
  );
}
