import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseFormFields } from "@/lib/forms";
import { nowDate } from "@/lib/dates";
import { PublicShell } from "@/components/public/public-shell";
import { HostedForm } from "./hosted-form";

export const metadata = { title: "Contact", robots: { index: false } };

/** Formulaire hébergé par le CRM (lien direct ou intégration en iframe avec ?embed=1). */
export default async function HostedFormPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ embed?: string; erreur?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const form = await db.webForm.findUnique({ where: { key } });
  if (!form || !form.active) notFound();
  const content = (
    <div className={sp.embed ? "p-4" : "rounded-2xl border border-border bg-card p-6 shadow-[0_20px_50px_-24px_rgba(16,24,40,0.16)] md:p-8"}>
      {!sp.embed && (
        <>
          <h1 className="text-xl font-bold text-brand-navy">{form.name}</h1>
          {form.description && <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>}
        </>
      )}
      <div className={sp.embed ? "" : "mt-5"}>
        <HostedForm formKey={key} fields={parseFormFields(form.fields)} initialError={sp.erreur ?? null} renderedAt={nowDate().getTime()} />
      </div>
    </div>
  );
  if (sp.embed) return <div className="min-h-0 bg-transparent">{content}</div>;
  return <PublicShell>{content}</PublicShell>;
}
