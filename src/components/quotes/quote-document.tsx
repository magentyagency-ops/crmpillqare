import type { CompanySettings } from "@/lib/settings";
import { formatDate } from "@/lib/dates";
import { formatEUR } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quotes/totals";

export type QuoteDocumentData = {
  number: string;
  title: string | null;
  issueDate: Date;
  validUntil: Date;
  notes: string | null;
  terms: string | null;
  globalDiscountPct: number;
  owner: { firstName: string; lastName: string; email: string; phone: string | null };
  client: { companyName: string | null; contactName: string; address: string | null; postalCode: string | null; city: string | null; email: string | null; phone: string | null };
  items: { name: string; description: string | null; quantity: number; unit: string; unitPriceHT: number; discountPct: number; vatRate: number }[];
};

/** Rendu HTML d'un devis (fiche interne et page publique d'acceptation). */
export function QuoteDocument({ quote, company }: { quote: QuoteDocumentData; company: CompanySettings }) {
  const totals = computeQuoteTotals(quote.items, quote.globalDiscountPct);
  return (
    <div className="rounded-xl bg-white p-6 text-sm text-slate-800 shadow-sm surface md:p-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row">
        <div>
          <div className="text-2xl font-bold text-brand-navy">{company.name}</div>
          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
            {company.address && <div>{company.address}</div>}
            {(company.postalCode || company.city) && <div>{[company.postalCode, company.city].filter(Boolean).join(" ")}</div>}
            {company.phone && <div>Tél. {company.phone}</div>}
            {company.email && <div>{company.email}</div>}
            {company.website && <div>{company.website}</div>}
          </div>
        </div>
        <div className="text-left md:text-right">
          <div className="text-2xl font-bold">DEVIS</div>
          <div className="mt-1 font-semibold">N° {quote.number}</div>
          <div className="text-xs text-slate-500">Date : {formatDate(quote.issueDate, "dd/MM/yyyy")}</div>
          <div className="text-xs text-slate-500">Valable jusqu&apos;au : {formatDate(quote.validUntil, "dd/MM/yyyy")}</div>
          <div className="text-xs text-slate-500">
            Contact : {quote.owner.firstName} {quote.owner.lastName}
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <div className="w-full rounded-lg bg-slate-50 p-4 md:w-80">
          <div className="text-xs text-slate-500">Destinataire</div>
          {quote.client.companyName && <div className="font-semibold">{quote.client.companyName}</div>}
          <div>{quote.client.contactName}</div>
          {quote.client.address && <div>{quote.client.address}</div>}
          {(quote.client.postalCode || quote.client.city) && <div>{[quote.client.postalCode, quote.client.city].filter(Boolean).join(" ")}</div>}
          {quote.client.email && <div className="text-xs text-slate-500">{quote.client.email}</div>}
        </div>
      </div>
      {quote.title && <div className="mt-6 font-semibold">Objet : {quote.title}</div>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="bg-brand-navy text-left text-xs text-white">
              <th className="px-3 py-2 font-semibold">Désignation</th>
              <th className="px-3 py-2 text-right font-semibold">Qté</th>
              <th className="px-3 py-2 text-right font-semibold">PU HT</th>
              <th className="px-3 py-2 text-right font-semibold">Remise</th>
              <th className="px-3 py-2 text-right font-semibold">TVA</th>
              <th className="px-3 py-2 text-right font-semibold">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((it, i) => (
              <tr key={i} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2.5">
                  <div className="font-medium">{it.name}</div>
                  {it.description && <div className="mt-0.5 text-xs whitespace-pre-line text-slate-500">{it.description}</div>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {it.quantity} {it.unit !== "unité" ? it.unit : ""}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatEUR(it.unitPriceHT)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{it.discountPct ? `${it.discountPct} %` : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{it.vatRate} %</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatEUR(totals.lineTotals[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <div className="w-full space-y-1 md:w-80">
          <div className="flex justify-between">
            <span className="text-slate-500">Sous-total HT</span>
            <span className="tabular-nums">{formatEUR(totals.subtotalHT)}</span>
          </div>
          {totals.discountHT > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Remise globale ({quote.globalDiscountPct} %)</span>
              <span className="tabular-nums">- {formatEUR(totals.discountHT)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>Total HT</span>
            <span className="tabular-nums">{formatEUR(totals.totalHT)}</span>
          </div>
          {totals.vat.map((v) => (
            <div key={v.rate} className="flex justify-between">
              <span className="text-slate-500">TVA {v.rate} %</span>
              <span className="tabular-nums">{formatEUR(v.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between rounded-md bg-slate-100 px-2 py-1.5 text-base font-bold">
            <span>Total TTC</span>
            <span className="tabular-nums">{formatEUR(totals.totalTTC)}</span>
          </div>
        </div>
      </div>
      {(quote.notes || quote.terms) && (
        <div className="mt-6 space-y-3 text-xs text-slate-600">
          {quote.notes && (
            <div>
              <div className="font-semibold text-slate-800">Remarques</div>
              <p className="whitespace-pre-line">{quote.notes}</p>
            </div>
          )}
          {quote.terms && (
            <div>
              <div className="font-semibold text-slate-800">Conditions</div>
              <p className="whitespace-pre-line">{quote.terms}</p>
            </div>
          )}
        </div>
      )}
      <div className="mt-8 border-t pt-3 text-center text-[11px] text-slate-400">
        {[company.legalName || company.name, company.siret ? `SIRET ${company.siret}` : null, company.vatNumber ? `TVA ${company.vatNumber}` : null].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}
