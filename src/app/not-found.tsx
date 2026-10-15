import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f9] bg-[radial-gradient(60rem_26rem_at_50%_-8%,rgba(18,41,90,0.09),transparent)] px-4 text-center">
      <BrandMark size={44} />
      <h1 className="text-2xl font-bold text-brand-navy">Page introuvable</h1>
      <p className="max-w-md text-sm text-muted-foreground">Ce lien n&apos;existe pas ou n&apos;est plus valable (rendez-vous annulé, devis remplacé, lien expiré…).</p>
      <Button asChild>
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </div>
  );
}
