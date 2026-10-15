import { round2 } from "@/lib/format";

export type QuoteLineInput = {
  quantity: number;
  unitPriceHT: number;
  discountPct: number;
  vatRate: number;
};

export type QuoteTotals = {
  lineTotals: number[];
  subtotalHT: number;
  discountHT: number;
  totalHT: number;
  vat: { rate: number; base: number; amount: number }[];
  totalVAT: number;
  totalTTC: number;
};

/** Calcul des totaux d'un devis (remise ligne, remise globale, TVA multi-taux). */
export function computeQuoteTotals(lines: QuoteLineInput[], globalDiscountPct = 0): QuoteTotals {
  const g = Math.min(100, Math.max(0, globalDiscountPct)) / 100;
  const lineTotals = lines.map((l) => round2(l.quantity * l.unitPriceHT * (1 - Math.min(100, Math.max(0, l.discountPct)) / 100)));
  const subtotalHT = round2(lineTotals.reduce((a, b) => a + b, 0));
  const discountHT = round2(subtotalHT * g);
  const totalHT = round2(subtotalHT - discountHT);
  const byRate = new Map<number, number>();
  lines.forEach((l, i) => byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineTotals[i]! * (1 - g)));
  const vat = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, base]) => ({ rate, base: round2(base), amount: round2((base * rate) / 100) }));
  const totalVAT = round2(vat.reduce((a, v) => a + v.amount, 0));
  return { lineTotals, subtotalHT, discountHT, totalHT, vat, totalVAT, totalTTC: round2(totalHT + totalVAT) };
}
