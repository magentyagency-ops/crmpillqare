"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FormFieldDef } from "@/lib/forms-fields";

export function HostedForm({ formKey, fields, initialError, renderedAt }: { formKey: string; fields: FormFieldDef[]; initialError: string | null; renderedAt: number }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [success, setSuccess] = useState<string | null>(null);
  const ts = String(renderedAt);

  if (success) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="text-sm">{success}</p>
      </div>
    );
  }
  return (
    <form
      action={`/api/public/forms/${formKey}`}
      method="post"
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          const params = new URLSearchParams(window.location.search);
          const res = await fetch(`/api/public/forms/${formKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              _ts: ts,
              page_url: document.referrer || window.location.href,
              utm_source: params.get("utm_source") ?? undefined,
              utm_medium: params.get("utm_medium") ?? undefined,
              utm_campaign: params.get("utm_campaign") ?? undefined,
            }),
          });
          const json = (await res.json()) as { ok: boolean; message?: string; error?: string; redirectUrl?: string | null };
          if (!json.ok) setError(json.error ?? "Envoi impossible");
          else if (json.redirectUrl) {
            try {
              (window.top ?? window).location.href = json.redirectUrl;
            } catch {
              window.location.href = json.redirectUrl;
            }
          }
          else setSuccess(json.message ?? "Merci !");
        } catch {
          setError("Erreur réseau, réessayez.");
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="_ts" value={ts} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className={f.type === "textarea" || f.name === "company" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={`f-${f.name}`}>
              {f.label}
              {f.required && " *"}
            </Label>
            {f.type === "textarea" ? (
              <Textarea id={`f-${f.name}`} name={f.name} rows={4} required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ) : f.type === "select" ? (
              <NativeSelect id={`f-${f.name}`} name={f.name} required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className="w-full">
                <NativeSelectOption value="">Choisir…</NativeSelectOption>
                {(f.options ?? []).map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {o}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input id={`f-${f.name}`} name={f.name} type={f.type} required={f.required} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {error && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending && <Spinner />} Envoyer
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">Vos données sont utilisées uniquement pour répondre à votre demande.</p>
    </form>
  );
}
