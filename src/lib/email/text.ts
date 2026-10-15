/** Utilitaires texte des emails (utilisables côté client). */

/**
 * Retire la partie citée d'une réponse (« Le … a écrit : », lignes « > ») pour un aperçu lisible.
 */
export function stripQuotedReply(text: string | null): string {
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const quoteHeader = /^(Le|On) .{5,300}(a écrit|wrote)\s*:\s*$/i;
  for (const [i, line] of lines.entries()) {
    const t = line.trim();
    // « Le …, Nom <adresse> a écrit : » peut être coupé sur deux lignes (Gmail)
    if (quoteHeader.test(t) || (/^(Le|On) /i.test(t) && quoteHeader.test(`${t} ${lines[i + 1]?.trim() ?? ""}`))) break;
    if (/^-{2,}\s*(Original Message|Message d'origine)/i.test(line.trim())) break;
    if (/^(De|From)\s*:.+/i.test(line.trim()) && out.length > 0) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
