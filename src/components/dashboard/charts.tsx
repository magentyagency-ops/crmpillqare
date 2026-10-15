"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Table2, BarChart3 } from "lucide-react";

/** Palette validée (outil dataviz) : bleu, aqua, orange — ordre fixe, jamais recyclé. */
export const SERIES = { s1: "#2a78d6", s2: "#1baf7a", s3: "#eb6834" } as const;
const GRID = "#e8e9e4";
const AXIS = "#6b7280";
const SURFACE = "#ffffff";

const eur = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v).replace(/\u202f/g, "\u00a0");
const compactEur = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10} k€`.replace(".", ",") : `${v} €`);
const monthLabel = (m: string) => new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(`${m}-15T12:00:00`));
const weekLabel = (w: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(`${w}T12:00:00`));

function ChartFrame({ title, description, table, children }: { title: string; description?: string; table: React.ReactNode; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="rounded-xl bg-card surface">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <button onClick={() => setAsTable((v) => !v)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" aria-label={asTable ? "Afficher le graphique" : "Afficher le tableau"}>
          {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} {asTable ? "Graphique" : "Tableau"}
        </button>
      </div>
      <div className="p-4">{asTable ? <div className="max-h-72 overflow-y-auto text-sm">{table}</div> : children}</div>
    </section>
  );
}

const tooltipStyle = { borderRadius: 8, border: "1px solid #e3e6e0", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" };

export function RevenueChart({ data }: { data: { month: string; signe: number; boutique: number }[] }) {
  return (
    <ChartFrame
      title="Chiffre d'affaires par mois (HT)"
      description="Dossiers signés et ventes de la boutique en ligne"
      table={
        <table className="w-full">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium">Mois</th>
              <th className="text-right font-medium">Signé</th>
              <th className="text-right font-medium">Boutique</th>
              <th className="text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t">
                <td className="py-1">{monthLabel(d.month)}</td>
                <td className="text-right tabular-nums">{eur(d.signe)}</td>
                <td className="text-right tabular-nums">{eur(d.boutique)}</td>
                <td className="text-right font-medium tabular-nums">{eur(d.signe + d.boutique)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compactEur} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(v, name) => [eur(Number(v)), name === "signe" ? "Dossiers signés" : "Boutique"]} labelFormatter={(l) => monthLabel(String(l))} contentStyle={tooltipStyle} cursor={{ fill: "rgba(18,41,90,.05)" }} />
          <Legend formatter={(v) => (v === "signe" ? "Dossiers signés" : "Boutique en ligne")} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="signe" stackId="ca" fill={SERIES.s1} stroke={SURFACE} strokeWidth={2} />
          <Bar dataKey="boutique" stackId="ca" fill={SERIES.s2} stroke={SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ActivityChart({ data }: { data: { week: string; appels: number; emails: number; rdv: number }[] }) {
  return (
    <ChartFrame
      title="Activité commerciale par semaine"
      description="Appels, emails envoyés et rendez-vous réalisés"
      table={
        <table className="w-full">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium">Semaine du</th>
              <th className="text-right font-medium">Appels</th>
              <th className="text-right font-medium">Emails</th>
              <th className="text-right font-medium">RDV</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.week} className="border-t">
                <td className="py-1">{weekLabel(d.week)}</td>
                <td className="text-right tabular-nums">{d.appels}</td>
                <td className="text-right tabular-nums">{d.emails}</td>
                <td className="text-right tabular-nums">{d.rdv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Pas encore d&apos;activité enregistrée.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={32} />
            <Tooltip labelFormatter={(l) => `Semaine du ${weekLabel(String(l))}`} contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(v) => ({ appels: "Appels", emails: "Emails envoyés", rdv: "RDV réalisés" })[v as "appels"]} />
            <Line type="monotone" dataKey="appels" name="appels" stroke={SERIES.s1} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: SURFACE }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="emails" name="emails" stroke={SERIES.s2} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: SURFACE }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="rdv" name="rdv" stroke={SERIES.s3} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: SURFACE }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** Barres horizontales à une seule série (entonnoir, motifs de refus, origines). */
export function HorizontalBars({
  title,
  description,
  data,
  valueLabel,
  formatValue,
  emptyLabel = "Aucune donnée sur la période.",
}: {
  title: string;
  description?: string;
  data: { label: string; value: number; hint?: string }[];
  valueLabel: string;
  formatValue?: (v: number) => string;
  emptyLabel?: string;
}) {
  const fmt = formatValue ?? ((v: number) => String(v));
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ChartFrame
      title={title}
      description={description}
      table={
        <table className="w-full">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium" />
              <th className="text-right font-medium">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t">
                <td className="py-1">{d.label}</td>
                <td className="text-right tabular-nums">
                  {fmt(d.value)}
                  {d.hint ? ` · ${d.hint}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2.5">
          {data.map((d) => (
            <li key={d.label} className="group" title={`${d.label} : ${fmt(d.value)}${d.hint ? ` (${d.hint})` : ""}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-foreground/85">{d.label}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {fmt(d.value)}
                  {d.hint && <span className="font-normal text-muted-foreground"> · {d.hint}</span>}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted">
                <div className="h-full rounded-full transition-[width] group-hover:opacity-80" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: SERIES.s1 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}
