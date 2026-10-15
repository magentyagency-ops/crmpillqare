/** Définition des champs des formulaires (utilisable côté client). */

/** Champs par défaut du formulaire hébergé / à intégrer. */
export type FormFieldDef = { name: string; label: string; type: "text" | "email" | "tel" | "textarea" | "select"; required?: boolean; options?: string[] };

export const DEFAULT_FORM_FIELDS: FormFieldDef[] = [
  { name: "firstName", label: "Prénom", type: "text", required: true },
  { name: "lastName", label: "Nom", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Téléphone", type: "tel", required: true },
  { name: "company", label: "Établissement / société (si professionnel)", type: "text" },
  { name: "message", label: "Votre demande", type: "textarea" },
];

export function parseFormFields(value: unknown): FormFieldDef[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_FORM_FIELDS;
  return value.filter((f): f is FormFieldDef => Boolean(f && typeof f === "object" && "name" in f && "label" in f));
}
