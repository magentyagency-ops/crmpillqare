import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, slugify, splitFullName } from "@/lib/normalize";
import { mapFormFields } from "@/lib/forms";
import { detectSegment, matchSegment, normalizeForMatch, type SegmentCandidate } from "@/lib/segments";
import { contactSearchWhere } from "@/lib/search";

describe("normalisation", () => {
  it("emails et téléphones français", () => {
    expect(normalizeEmail("  S.Lambert@EHPAD-roses.fr ")).toBe("s.lambert@ehpad-roses.fr");
    expect(normalizeEmail("pas un email")).toBeNull();
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("+33 (0)6.12.34.56.78")).toBe("+33612345678");
    expect(normalizePhone("0033612345678")).toBe("+33612345678");
    expect(normalizePhone("12")).toBeNull();
  });

  it("noms et identifiants", () => {
    expect(splitFullName("Marc Petit")).toEqual({ firstName: "Marc", lastName: "Petit" });
    expect(slugify("Hélène Garnier-Dupré")).toBe("helene-garnier-dupre");
  });
});

describe("formulaires du site", () => {
  it("reconnaît les noms de champs français et anglais", () => {
    const f = mapFormFields({ Prénom: "Sophie", nom: "Lambert", "E-mail": "s@x.fr", téléphone: "0612345678", Société: "EHPAD Les Roses", "Vous êtes": "EHPAD", message: "Bonjour", budget: "10k" });
    expect(f).toMatchObject({ firstName: "Sophie", lastName: "Lambert", email: "s@x.fr", phone: "0612345678", company: "EHPAD Les Roses", segment: "EHPAD", message: "Bonjour" });
    expect(f.extras).toEqual({ budget: "10k" });
  });

  it("découpe un nom complet", () => {
    expect(mapFormFields({ name: "Jean Dupont", email: "j@d.fr" })).toMatchObject({ firstName: "Jean", lastName: "Dupont" });
  });
});

describe("détection de la cible", () => {
  const seg = (id: string, name: string, kind: "B2B" | "B2C", keywords: string[], position: number): SegmentCandidate => ({ id, name, kind, keywords, position });
  const segments = [
    seg("pharma", "Pharmacies", "B2B", ["pharmacie", "pharmacien", "officine"], 0),
    seg("ehpad", "EHPAD & résidences seniors", "B2B", ["ehpad", "maison de retraite"], 1),
    seg("ssiad", "SSIAD / SAAD / aide à domicile", "B2B", ["ssiad", "aide à domicile"], 2),
    seg("idel", "Infirmiers & professionnels de santé", "B2B", ["infirmier", "infirmière"], 3),
    seg("distrib", "Distributeurs & revendeurs", "B2B", ["revendeur", "grossiste"], 7),
    seg("aidants", "Particuliers — aidants", "B2C", ["aidant", "ma mère", "mon père"], 8),
    seg("patients", "Particuliers — patients", "B2C", ["pour moi"], 9),
  ];

  it("normalise accents, ponctuation et pluriels", () => {
    expect(normalizeForMatch("Maisons de Retraite !")).toBe("maison de retraite");
    expect(matchSegment("Une pharmacie", segments)?.id).toBe("pharma");
  });

  it("priorise organisation > défaut du formulaire > message > fonction", () => {
    expect(detectSegment({ company: "EHPAD Les Roses" }, segments)?.id).toBe("ehpad");
    expect(detectSegment({ company: "Les Glycines", jobTitle: "Infirmière coordinatrice", message: "Nous sommes un SSIAD" }, segments, { kind: "B2B" })?.id).toBe("ssiad");
    expect(detectSegment({ company: "Les Glycines", jobTitle: "Infirmière coordinatrice" }, segments, { kind: "B2B" })?.id).toBe("idel");
    expect(detectSegment({ message: "c'est pour ma mère" }, segments, { kind: "B2C", defaultId: "patients" })?.id).toBe("patients");
  });

  it("évite les faux positifs du message", () => {
    expect(detectSegment({ message: "Intéressés par le distributeur automatique" }, segments, { kind: "B2B" })).toBeNull();
    expect(detectSegment({ message: "Je voudrais l'acheter en pharmacie" }, segments, { kind: "B2C" })).toBeNull();
  });
});

describe("recherche", () => {
  it("chaque mot doit correspondre et le téléphone est reconnu", () => {
    const where = contactSearchWhere("Marc Petit") as { OR: { AND?: unknown[] }[] };
    expect(where.OR[0]!.AND).toHaveLength(2);
    const phone = contactSearchWhere("06 12 34 56 78") as { OR: unknown[] };
    expect(phone.OR[1]).toEqual({ phoneNormalized: { contains: "612345678" } });
  });
});
