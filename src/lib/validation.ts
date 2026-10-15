import { z } from "zod";

/** Chaîne optionnelle : "" → null */
export const optionalString = z
  .string()
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t === "" ? null : t;
  });

export const requiredString = (label: string) =>
  z.string({ error: `${label} est obligatoire` }).trim().min(1, `${label} est obligatoire`);

export const optionalEmail = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Adresse email invalide");

export const optionalInt = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Nombre invalide" });
      return z.NEVER;
    }
    return Math.round(n);
  });

export const optionalNumber = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Montant invalide" });
      return z.NEVER;
    }
    return n;
  });

export const checkbox = z
  .union([z.string(), z.boolean()])
  .nullish()
  .transform((v) => v === true || v === "on" || v === "true" || v === "1");

export const stringArray = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((v) => {
    if (!v) return [] as string[];
    const arr = Array.isArray(v) ? v : v.split(",");
    return arr.map((s) => s.trim()).filter(Boolean);
  });
