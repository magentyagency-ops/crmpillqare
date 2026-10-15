import { describe, expect, it } from "vitest";
import { computeQuoteTotals } from "@/lib/quotes/totals";
import { composeEmail, escapeHtml, renderTemplate, textToHtml } from "@/lib/email/render";

describe("totaux de devis", () => {
  it("applique remise ligne, remise globale et TVA (exemple vérifié en recette)", () => {
    const t = computeQuoteTotals(
      [
        { quantity: 24, unitPriceHT: 665.83, discountPct: 5, vatRate: 20 },
        { quantity: 2, unitPriceHT: 57.5, discountPct: 0, vatRate: 20 },
      ],
      3,
    );
    expect(t.lineTotals).toEqual([15180.92, 115]);
    expect(t.subtotalHT).toBe(15295.92);
    expect(t.discountHT).toBe(458.88);
    expect(t.totalHT).toBe(14837.04);
    expect(t.totalVAT).toBe(2967.41);
    expect(t.totalTTC).toBe(17804.45);
  });

  it("ventile la TVA par taux et borne les remises", () => {
    const t = computeQuoteTotals(
      [
        { quantity: 1, unitPriceHT: 100, discountPct: 150, vatRate: 20 },
        { quantity: 2, unitPriceHT: 50, discountPct: 0, vatRate: 5.5 },
        { quantity: 1, unitPriceHT: 200, discountPct: 0, vatRate: 20 },
      ],
      -10,
    );
    expect(t.lineTotals).toEqual([0, 100, 200]);
    expect(t.vat).toEqual([
      { rate: 5.5, base: 100, amount: 5.5 },
      { rate: 20, base: 200, amount: 40 },
    ]);
    expect(t.totalTTC).toBe(345.5);
  });
});

describe("modèles d'email", () => {
  const vars = { contact: { firstName: "Isabelle", greeting: "Bonjour Isabelle," }, org: { name: "PillQare" } };

  it("remplace les variables, avec valeur de repli", () => {
    expect(renderTemplate("{{contact.greeting}} — {{org.name}}", vars)).toBe("Bonjour Isabelle, — PillQare");
    expect(renderTemplate("Bonjour {{contact.lastName|Madame, Monsieur}}", vars)).toBe("Bonjour Madame, Monsieur");
    expect(renderTemplate("{{inconnu.champ}}", vars)).toBe("");
  });

  it("échappe le HTML et rend les liens cliquables", () => {
    expect(escapeHtml(`<b>"x"</b> & 'y'`)).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;");
    const html = textToHtml("Voir https://pillqare.com/rdv.\n\n<script>alert(1)</script>");
    expect(html).toContain('<a href="https://pillqare.com/rdv"');
    expect(html).not.toContain("<script>");
  });

  it("assemble corps, signature et lien de désinscription", () => {
    const e = composeEmail({ subject: "Votre demande — {{org.name}}", body: "{{contact.greeting}}\n\nMerci !", vars, signature: "Julie Martin", unsubscribeUrl: "https://crm.example.com/p/desinscription/abc" });
    expect(e.subject).toBe("Votre demande — PillQare");
    expect(e.text).toBe("Bonjour Isabelle,\n\nMerci !\n\n--\nJulie Martin\n\nVous ne souhaitez plus recevoir nos messages ? https://crm.example.com/p/desinscription/abc");
    expect(e.html).toContain("Se désinscrire");
  });
});
