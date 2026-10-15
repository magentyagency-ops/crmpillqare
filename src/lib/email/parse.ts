import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { normalizeMessageId } from "./mime";
import { htmlToText } from "./render";

/** Message normalisé, quelle que soit la source (IMAP, Gmail). */
export type NormalizedMessage = {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: { email: string; name: string | null };
  to: { email: string; name: string | null }[];
  cc: { email: string; name: string | null }[];
  subject: string;
  text: string | null;
  html: string | null;
  date: Date;
  providerId: string | null;
  providerThreadId: string | null;
  attachments: { filename: string; contentType: string; size: number }[];
  isAutoReply: boolean;
  isBounce: boolean;
  bouncedRecipient: string | null;
};

function addresses(obj: AddressObject | AddressObject[] | undefined): { email: string; name: string | null }[] {
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : [obj];
  const out: { email: string; name: string | null }[] = [];
  for (const group of list) {
    for (const v of group.value ?? []) {
      if (v.address) out.push({ email: v.address.toLowerCase(), name: v.name || null });
      for (const sub of v.group ?? []) if (sub.address) out.push({ email: sub.address.toLowerCase(), name: sub.name || null });
    }
  }
  return out;
}

function headerValue(parsed: ParsedMail, name: string): string {
  const v = parsed.headers.get(name.toLowerCase());
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value);
  return String(v);
}

const AUTO_REPLY_SUBJECT = /^(r[ée]ponse automatique|automatic reply|auto(matic)?[- ]?reply|out of (the )?office|absence|absent|abwesenheit|risposta automatica|respuesta autom[aá]tica|je suis absent)/i;

export async function parseRawMessage(
  raw: Buffer | string,
  meta: { providerId?: string | null; providerThreadId?: string | null; fallbackDate?: Date } = {},
): Promise<NormalizedMessage> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const from = addresses(parsed.from)[0] ?? { email: "inconnu@inconnu", name: null };
  const refsRaw = parsed.references;
  const references = (Array.isArray(refsRaw) ? refsRaw : refsRaw ? refsRaw.split(/\s+/) : [])
    .map((r) => normalizeMessageId(r))
    .filter((r): r is string => Boolean(r));
  const subject = (parsed.subject ?? "").trim();
  const autoSubmitted = headerValue(parsed, "auto-submitted").toLowerCase();
  const precedence = headerValue(parsed, "precedence").toLowerCase();
  const isAutoReply =
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    ["auto_reply", "bulk", "junk", "list"].includes(precedence) ||
    Boolean(headerValue(parsed, "x-autoreply") || headerValue(parsed, "x-autorespond")) ||
    AUTO_REPLY_SUBJECT.test(subject);
  const isBounce =
    /^(mailer-daemon|postmaster)@/i.test(from.email) ||
    /^(undeliver|delivery status notification|mail delivery (failed|subsystem)|non remis|message non remis|returned mail)/i.test(subject);
  let bouncedRecipient: string | null = null;
  if (isBounce) {
    const failed = headerValue(parsed, "x-failed-recipients");
    bouncedRecipient = failed ? failed.split(",")[0]!.trim().toLowerCase() : null;
    if (!bouncedRecipient && parsed.text) {
      const m = parsed.text.match(/(?:to|à|destinataire)[^\n]*?([^\s<>"']+@[^\s<>"']+\.[a-z]{2,})/i);
      bouncedRecipient = m?.[1]?.toLowerCase() ?? null;
    }
  }
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text?.trim() || (html ? htmlToText(html) : null);
  const messageId =
    normalizeMessageId(parsed.messageId) ??
    `<generated-${meta.providerId ?? Date.now().toString(36)}@pillqare.local>`;

  return {
    messageId,
    inReplyTo: normalizeMessageId(parsed.inReplyTo ?? null),
    references,
    from,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    subject: subject || "(sans objet)",
    text,
    html,
    date: parsed.date ?? meta.fallbackDate ?? new Date(),
    providerId: meta.providerId ?? null,
    providerThreadId: meta.providerThreadId ?? null,
    attachments: (parsed.attachments ?? [])
      .filter((a) => a.contentDisposition !== "inline" || !a.cid)
      .map((a) => ({ filename: a.filename ?? "piece-jointe", contentType: a.contentType, size: a.size })),
    isAutoReply,
    isBounce,
    bouncedRecipient,
  };
}

export { stripQuotedReply } from "./text";
