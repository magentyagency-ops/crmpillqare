import crypto from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";

export type Address = { email: string; name?: string | null };

export type MimeAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type MimeInput = {
  from: Address;
  replyTo?: Address | null;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: MimeAttachment[];
  /** Invitation calendrier (text/calendar; method=REQUEST) */
  icalEvent?: { content: string; method?: "REQUEST" | "CANCEL" | "PUBLISH"; filename?: string } | null;
  headers?: Record<string, string>;
  date?: Date;
};

function fmt(a: Address) {
  return a.name ? { name: a.name, address: a.email } : a.email;
}

/** Génère un Message-ID RFC 5322 rattaché au domaine de l'expéditeur. */
export function generateMessageId(fromEmail: string): string {
  const domain = fromEmail.split("@")[1] || "pillqare.local";
  return `<${Date.now().toString(36)}.${crypto.randomBytes(8).toString("hex")}@${domain}>`;
}

/** Normalise un Message-ID (avec chevrons). */
export function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const t = id.trim();
  if (!t) return null;
  return t.startsWith("<") ? t : `<${t}>`;
}

/** Construit le message brut RFC 822 (Buffer). */
export async function buildMime(input: MimeInput, opts: { keepBcc?: boolean } = {}): Promise<Buffer> {
  const composer = new MailComposer({
    from: fmt(input.from),
    replyTo: input.replyTo ? fmt(input.replyTo) : undefined,
    to: input.to.map(fmt),
    cc: input.cc?.length ? input.cc.map(fmt) : undefined,
    bcc: input.bcc?.length ? input.bcc.map(fmt) : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references?.length ? input.references : undefined,
    date: input.date ?? new Date(),
    attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    icalEvent: input.icalEvent
      ? { content: input.icalEvent.content, method: input.icalEvent.method ?? "REQUEST", filename: input.icalEvent.filename ?? "invitation.ics" }
      : undefined,
    headers: input.headers,
  });
  const node = composer.compile();
  // L'API Gmail lit l'en-tête Bcc puis le retire ; en SMTP il ne doit jamais apparaître dans le brut
  node.keepBcc = Boolean(opts.keepBcc);
  return node.build();
}
