import { CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { PublicShell } from "@/components/public/public-shell";

export const metadata = { title: "Merci", robots: { index: false } };

export default async function ThanksPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const form = await db.webForm.findUnique({ where: { key }, select: { successMessage: true } });
  return (
    <PublicShell>
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-10 text-center shadow-sm surface">
        <CheckCircle2 className="size-12 text-emerald-600" />
        <h1 className="text-xl font-bold text-brand-navy">Merci !</h1>
        <p className="text-sm text-muted-foreground">{form?.successMessage ?? "Votre demande a bien été envoyée. Nous vous recontactons très vite."}</p>
      </div>
    </PublicShell>
  );
}
