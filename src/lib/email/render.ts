/**
 * Rendu des modèles d'email : variables {{contact.firstName}}, valeurs de repli
 * {{contact.firstName|Madame, Monsieur}}, conversion texte → HTML et signature.
 */

export type TemplateVars = Record<string, unknown>;

function lookup(vars: TemplateVars, path: string): unknown {
  let cur: unknown = vars;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g, (_m, path: string, fallback?: string) => {
    const v = lookup(vars, path);
    if (v === undefined || v === null || v === "") return fallback?.trim() ?? "";
    return String(v);
  });
}

/** Variables utilisées dans un modèle (pour l'aide à la saisie / validation) */
export function templateVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) out.add(m[1]!);
  return [...out];
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (url) => `<a href="${url}" style="color:#12295A">${url}</a>`);
}

/** Texte brut → HTML simple (paragraphes, retours à la ligne, liens cliquables, **gras**). */
export function textToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const html = linkify(escapeHtml(p))
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 12px 0">${html}</p>`;
    })
    .join("\n");
}

/** HTML → texte brut (pour la partie texte des emails et les aperçus). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) => (label.includes(href) ? label : `${label} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ComposedEmail = { subject: string; text: string; html: string };

/**
 * Assemble un email à partir d'un corps en texte brut : variables, signature, pied de page
 * de désinscription éventuel. Le rendu reste sobre (aspect « email personnel », meilleure délivrabilité).
 */
export function composeEmail(input: {
  subject: string;
  body: string;
  vars?: TemplateVars;
  signature?: string | null;
  unsubscribeUrl?: string | null;
  quotedHtml?: string | null;
}): ComposedEmail {
  const vars = input.vars ?? {};
  const subject = renderTemplate(input.subject, vars).replace(/\s+/g, " ").trim();
  const body = renderTemplate(input.body, vars).trim();
  const signature = input.signature ? renderTemplate(input.signature, vars).trim() : "";

  const textParts = [body];
  if (signature) textParts.push(`--\n${signature}`);
  if (input.unsubscribeUrl) textParts.push(`Vous ne souhaitez plus recevoir nos messages ? ${input.unsubscribeUrl}`);
  const text = textParts.join("\n\n");

  const htmlParts = [textToHtml(body)];
  if (signature) {
    htmlParts.push(`<div style="margin-top:16px;color:#4A5568;font-size:13px">${escapeHtml(signature).replace(/\n/g, "<br>")}</div>`);
  }
  if (input.unsubscribeUrl) {
    htmlParts.push(
      `<p style="margin-top:24px;color:#94a3b8;font-size:11px">Vous ne souhaitez plus recevoir nos messages ? <a href="${input.unsubscribeUrl}" style="color:#94a3b8">Se désinscrire</a></p>`,
    );
  }
  if (input.quotedHtml) {
    htmlParts.push(`<blockquote style="margin:16px 0 0 0;padding-left:12px;border-left:3px solid #e2e8f0;color:#64748b">${input.quotedHtml}</blockquote>`);
  }
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2937">${htmlParts.join("\n")}</div>`;
  return { subject, text, html };
}

/** Variables disponibles dans les modèles (documentation affichée dans l'éditeur) */
export const TEMPLATE_VARIABLE_HELP: { key: string; label: string }[] = [
  { key: "contact.firstName", label: "Prénom du contact" },
  { key: "contact.lastName", label: "Nom du contact" },
  { key: "contact.fullName", label: "Nom complet du contact" },
  { key: "contact.greeting", label: "Formule d'appel (« Bonjour Marie, »)" },
  { key: "company.name", label: "Organisation du contact" },
  { key: "deal.title", label: "Titre du dossier" },
  { key: "user.firstName", label: "Prénom du commercial" },
  { key: "user.fullName", label: "Nom complet du commercial" },
  { key: "user.phone", label: "Téléphone du commercial" },
  { key: "user.email", label: "Email du commercial" },
  { key: "bookingLink", label: "Lien de prise de RDV du commercial" },
  { key: "org.name", label: "Nom de l'entreprise (PillQare)" },
  { key: "org.website", label: "Site web" },
  { key: "quote.number", label: "Numéro de devis" },
  { key: "quote.link", label: "Lien de consultation / acceptation du devis" },
  { key: "quote.totalTTC", label: "Montant TTC du devis" },
  { key: "order.number", label: "Numéro de commande" },
  { key: "satisfactionLink", label: "Lien du questionnaire de satisfaction" },
  { key: "meeting.dateTime", label: "Date et heure du RDV" },
  { key: "meeting.link", label: "Lien de visio du RDV" },
];
