import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PublicShell } from "@/components/public/public-shell";
import { SatisfactionForm } from "./satisfaction-form";

export const metadata = { title: "Votre avis", robots: { index: false } };

export default async function SatisfactionPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ note?: string }> }) {
  const { token } = await params;
  const { note } = await searchParams;
  const order = await db.order.findUnique({ where: { satisfactionToken: token }, select: { number: true, satisfactionScore: true, contact: { select: { firstName: true } } } });
  if (!order) notFound();
  const preset = Number(note);
  return (
    <PublicShell>
      <div className="rounded-2xl bg-card p-6 text-center shadow-sm surface md:p-10">
        <h1 className="text-xl font-bold text-brand-navy">{order.contact.firstName ? `${order.contact.firstName}, votre avis compte !` : "Votre avis compte !"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Êtes-vous satisfait(e) de votre pilulier PillQare (commande {order.number}) ?</p>
        {order.satisfactionScore && (
          <p className="mt-2 text-xs text-emerald-700">Merci, votre avis ({order.satisfactionScore}/5) est bien enregistré. Vous pouvez le modifier ci-dessous.</p>
        )}
        <div className="mt-6">
          <SatisfactionForm token={token} initialScore={order.satisfactionScore ?? (preset >= 1 && preset <= 5 ? preset : null)} />
        </div>
      </div>
    </PublicShell>
  );
}
