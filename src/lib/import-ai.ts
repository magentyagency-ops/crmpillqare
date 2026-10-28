import { z } from "zod";

const IMPORT_FIELDS = ["firstname", "lastname", "name", "email", "phone", "company", "jobtitle", "message", "postalcode", "city", "postalcity", "segment", "extra", "ignore"] as const;

/**
 * Lecture d'un tableau quelconque (Excel, CSV) par l'IA : repère la ligne d'en-têtes (titres, lignes vides au-dessus…)
 * et associe chaque colonne à un champ du CRM. Les colonnes « extra » sont conservées dans les notes.
 * Sans IA disponible : première ligne = en-têtes, reconnaissance par alias.
 */
export async function aiNormalizeSheet(name: string, rows: string[][]): Promise<Record<string, string>[]> {
  const { llmAvailable, llmJson } = await import("@/lib/ai/llm");
  const width = Math.max(...rows.slice(0, 30).map((r) => r.length));
  if (!llmAvailable()) {
    const headers = rows[0]!.map((h) => h.trim());
    return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]?.trim() ?? ""])));
  }
  const sample = rows.slice(0, 15).map((r, i) => `${i}: ${JSON.stringify(r.slice(0, width).map((c) => c.slice(0, 60)))}`).join("\n");
  const res = await llmJson({
    name: "mapping_import",
    system: `Tu prépares l'import d'un tableau de contacts dans un CRM. Identifie la ligne d'en-têtes (index, -1 s'il n'y en a pas) et le champ CRM de chaque colonne (par index, de 0 à ${width - 1}).
Champs : firstname (prénom), lastname (nom), name (nom complet si prénom et nom sont dans la même colonne), email, phone, company (société, établissement, pharmacie…), jobtitle (fonction), message (commentaire libre), postalcode, city, postalcity (code postal et ville dans la même colonne), segment (type de client / cible / secteur), extra (information utile à garder en note : adresse, SIRET, chiffre d'affaires, date…), ignore (vide, numéro de ligne, colonne technique).
Un même champ (hors extra/ignore) ne peut être attribué qu'à une colonne : choisis la meilleure. Si le tableau ne contient aucun contact, mets contacts = false.`,
    user: `Feuille « ${name} », ${rows.length} lignes. Premières lignes :\n${sample}`,
    schema: z.object({
      contacts: z.boolean(),
      headerRow: z.number().int(),
      columns: z.array(z.object({ index: z.number().int(), field: z.enum(IMPORT_FIELDS), label: z.string() })),
    }),
  });
  if (!res.contacts) return [];
  const header = res.headerRow >= 0 ? rows[res.headerRow] ?? [] : [];
  return rows.slice(res.headerRow + 1).map((r) => {
    const rec: Record<string, string> = {};
    for (const c of res.columns) {
      const v = r[c.index]?.trim() ?? "";
      if (!v || c.field === "ignore") continue;
      if (c.field === "postalcity") {
        const m = v.match(/\b(\d{5})\b/);
        if (m) rec.postalcode = m[1]!;
        rec.city = v.replace(/\b\d{5}\b/, "").replace(/^[\s,/-]+|[\s,/-]+$/g, "") || rec.city || "";
        continue;
      }
      const key = c.field === "extra" ? header[c.index]?.trim() || c.label || `colonne ${c.index + 1}` : c.field;
      rec[key] = rec[key] ? `${rec[key]} ${v}` : v;
    }
    return rec;
  });
}
