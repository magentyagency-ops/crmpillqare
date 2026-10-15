import type { EmailMessage, GoogleAccount, Mailbox } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { advanceDealTo } from "@/lib/deals";
import { truncate } from "@/lib/format";
import { buildMime, generateMessageId, type Address, type MimeAttachment, type MimeInput } from "./mime";
import { gmailSend } from "./gmail";
import { appendToSent } from "./imap";
import { smtpSendRaw, type SmtpConfig } from "./smtp";
import { decryptOptional } from "@/lib/crypto";
import { htmlToText } from "./render";

export type SendEmailInput = {
  senderId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
  contactId?: string | null;
  dealId?: string | null;
  /** EmailMessage.id auquel on répond (fil de discussion) */
  replyToId?: string | null;
  stepRunId?: string | null;
  isAutomated?: boolean;
  attachments?: MimeAttachment[];
  icalEvent?: MimeInput["icalEvent"];
  skipActivity?: boolean;
};

type MailboxWithGoogle = Mailbox & { googleAccount: GoogleAccount | null };

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export async function getSenderMailbox(userId: string): Promise<MailboxWithGoogle | null> {
  return db.mailbox.findFirst({
    where: { userId, status: { not: "DISCONNECTED" } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { googleAccount: true },
  });
}

function systemSmtp(): SmtpConfig | null {
  if (!env.smtp.configured) return null;
  return { host: env.smtp.host!, port: env.smtp.port, secure: env.smtp.secure, user: env.smtp.user, password: env.smtp.password };
}

function parseFrom(value: string): Address {
  const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim() };
  return { email: value.trim() };
}


/**
 * Mode test (EMAIL_DELIVERY=log) : les emails sont enregistrés sans être envoyés, sauf si TOUS les destinataires
 * figurent dans EMAIL_TEST_ALLOWLIST (adresses ou domaines « @exemple.fr », séparés par des virgules).
 */
export function isDeliveryLogged(recipients: string[]): boolean {
  if (env.emailDelivery !== "log") return false;
  const allow = (process.env.EMAIL_TEST_ALLOWLIST ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.length || !recipients.length) return true;
  return !recipients.every((r) => {
    const e = r.trim().toLowerCase();
    return allow.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a));
  });
}

/**
 * Envoie un email au nom d'un commercial depuis sa boîte connectée (Gmail API ou SMTP),
 * l'enregistre sur la fiche du contact et met à jour le fil, l'historique et le pipeline.
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailMessage> {
  const to = [...new Set(input.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) throw new EmailConfigError("Aucun destinataire.");
  const sender = await db.user.findUniqueOrThrow({ where: { id: input.senderId } });
  const mailbox = await getSenderMailbox(sender.id);
  const smtp = systemSmtp();
  const logged = isDeliveryLogged([...to, ...(input.cc ?? []), ...(input.bcc ?? [])]);
  if (!mailbox && !smtp && !logged) {
    throw new EmailConfigError(
      "Aucune boîte mail connectée pour cet utilisateur. Connectez votre adresse dans Paramètres > Intégrations.",
    );
  }

  const senderName = `${sender.firstName} ${sender.lastName}`.trim();
  const from: Address = mailbox
    ? { email: mailbox.email, name: mailbox.displayName ?? senderName }
    : smtp
      ? { ...parseFrom(env.smtp.from!), name: `${senderName} (${parseFrom(env.smtp.from!).name ?? "PillQare"})` }
      : { email: sender.email, name: senderName };
  const replyTo: Address | null = mailbox ? null : { email: sender.email, name: senderName };

  const parent = input.replyToId
    ? await db.emailMessage.findUnique({
        where: { id: input.replyToId },
        select: { messageId: true, references: true, threadKey: true, mailboxId: true, contactId: true, dealId: true },
      })
    : null;
  const references = parent ? [...(parent.references?.split(/\s+/).filter(Boolean) ?? []), parent.messageId] : [];
  const messageId = generateMessageId(from.email);
  const mimeInput: MimeInput = {
    from,
    replyTo,
    to: to.map((email) => ({ email })),
    cc: (input.cc ?? []).filter(Boolean).map((email) => ({ email })),
    bcc: (input.bcc ?? []).filter(Boolean).map((email) => ({ email })),
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId,
    inReplyTo: parent?.messageId ?? null,
    references,
    attachments: input.attachments,
    icalEvent: input.icalEvent ?? null,
  };

  const contactId = input.contactId ?? parent?.contactId ?? null;
  const dealId = input.dealId ?? parent?.dealId ?? null;
  const record = await db.emailMessage.create({
    data: {
      mailboxId: mailbox?.id ?? null,
      direction: "OUTBOUND",
      status: "SENDING",
      messageId,
      threadKey: parent?.threadKey ?? messageId,
      inReplyTo: parent?.messageId ?? null,
      references: references.join(" ") || null,
      fromEmail: from.email,
      fromName: from.name ?? null,
      toEmails: to,
      ccEmails: input.cc ?? [],
      bccEmails: input.bcc ?? [],
      subject: input.subject.slice(0, 500),
      textBody: input.text,
      htmlBody: input.html,
      snippet: truncate(input.text, 200),
      contactId,
      dealId,
      userId: sender.id,
      stepRunId: input.stepRunId ?? null,
      isAutomated: input.isAutomated ?? false,
      attachments: input.attachments?.length
        ? input.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType ?? "application/octet-stream", size: Buffer.byteLength(a.content) }))
        : undefined,
      attempts: 1,
    },
  });

  try {
    let finalMessageId = messageId;
    let threadKey = parent?.threadKey ?? messageId;
    let providerId: string | null = null;

    if (logged) {
      console.info(`[email:log] ${from.email} → ${to.join(", ")} | ${input.subject}`);
      providerId = `log:${record.id}`;
    } else if (mailbox?.provider === "GOOGLE") {
      if (!mailbox.googleAccount) throw new EmailConfigError("Compte Google introuvable pour cette boîte.");
      const raw = await buildMime(mimeInput, { keepBcc: true });
      const gmailThread = parent && parent.mailboxId === mailbox.id && /^[0-9a-f]{10,}$/i.test(parent.threadKey) ? parent.threadKey : null;
      const res = await gmailSend(mailbox.googleAccount, raw, gmailThread);
      providerId = res.id;
      threadKey = res.threadId;
      if (res.messageId) finalMessageId = res.messageId;
    } else if (mailbox?.provider === "IMAP") {
      const raw = await buildMime(mimeInput);
      if (!mailbox.smtpHost || !mailbox.smtpPort) throw new EmailConfigError("Serveur SMTP non configuré pour cette boîte.");
      await smtpSendRaw(
        { host: mailbox.smtpHost, port: mailbox.smtpPort, secure: mailbox.smtpSecure, user: mailbox.username, password: decryptOptional(mailbox.passwordEnc) },
        raw,
        { from: from.email, to: [...to, ...(input.cc ?? []), ...(input.bcc ?? [])] },
      );
      providerId = `smtp:${record.id}`;
      appendToSent(mailbox, raw).catch((e) => console.warn("[email] Copie dans Envoyés impossible :", e instanceof Error ? e.message : e));
    } else if (smtp) {
      const raw = await buildMime(mimeInput);
      await smtpSendRaw(smtp, raw, { from: from.email, to: [...to, ...(input.cc ?? []), ...(input.bcc ?? [])] });
      providerId = `smtp:${record.id}`;
    } else {
      throw new EmailConfigError("Aucun moyen d'envoi configuré.");
    }

    const sent = await db.emailMessage.update({
      where: { id: record.id },
      data: { status: "SENT", sentAt: new Date(), providerId, messageId: finalMessageId, threadKey, error: null },
    });

    if (contactId) {
      await db.contact.update({ where: { id: contactId }, data: { lastContactedAt: new Date() } });
      // Répondre clôt les messages entrants du fil
      await db.emailMessage.updateMany({
        where: { threadKey: { in: [threadKey, parent?.threadKey ?? threadKey] }, direction: "INBOUND", handledAt: null },
        data: { handledAt: new Date() },
      });
      if (parent) await db.emailMessage.updateMany({ where: { id: input.replyToId!, handledAt: null }, data: { handledAt: new Date() } });
    }
    if (!input.skipActivity && (contactId || dealId)) {
      await logActivity({
        type: "EMAIL_SENT",
        title: input.subject.slice(0, 200),
        body: truncate(input.text, 300),
        contactId,
        dealId,
        userId: sender.id,
        emailMessageId: sent.id,
        metadata: input.isAutomated ? { automated: true } : undefined,
      });
    }
    if (!input.isAutomated) {
      const { isRealExchange, onManualEmailSent } = await import("@/lib/sequences/engine");
      if (dealId && (await isRealExchange(contactId))) await advanceDealTo(dealId, "CONTACTED", { userId: sender.id });
      if (contactId) await onManualEmailSent(contactId);
    }
    return sent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.emailMessage.update({ where: { id: record.id }, data: { status: "FAILED", error: message.slice(0, 2000) } });
    throw error;
  }
}

/** Réessaie l'envoi d'un email en échec (même contenu). */
export async function retryEmail(emailId: string) {
  const e = await db.emailMessage.findUniqueOrThrow({ where: { id: emailId } });
  if (e.status !== "FAILED" || e.direction !== "OUTBOUND" || !e.userId) throw new Error("Cet email ne peut pas être renvoyé.");
  await db.emailMessage.delete({ where: { id: e.id } });
  return sendEmail({
    senderId: e.userId,
    to: e.toEmails,
    cc: e.ccEmails,
    bcc: e.bccEmails,
    subject: e.subject,
    text: e.textBody ?? htmlToText(e.htmlBody ?? ""),
    html: e.htmlBody ?? e.textBody ?? "",
    contactId: e.contactId,
    dealId: e.dealId,
    stepRunId: e.stepRunId,
    isAutomated: e.isAutomated,
  });
}

/**
 * Email système (invitation, réinitialisation de mot de passe, planning quotidien…).
 * Ordre : SMTP système → boîte Google d'un administrateur → journal (développement).
 */
export async function sendSystemEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MimeAttachment[];
}): Promise<void> {
  const smtp = systemSmtp();
  const base: Omit<MimeInput, "from"> = {
    to: [{ email: input.to }],
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: "",
    attachments: input.attachments,
  };
  if (isDeliveryLogged([input.to])) {
    console.info(`[email:log] (système) → ${input.to} | ${input.subject}\n${input.text.slice(0, 600)}`);
    return;
  }
  if (smtp) {
    const from = parseFrom(env.smtp.from!);
    const raw = await buildMime({ ...base, from, messageId: generateMessageId(from.email) });
    await smtpSendRaw(smtp, raw, { from: from.email, to: [input.to] });
    return;
  }
  const adminMailbox = await db.mailbox.findFirst({
    where: { provider: "GOOGLE", status: "ACTIVE", user: { role: "ADMIN", active: true } },
    include: { googleAccount: true },
  });
  if (adminMailbox?.googleAccount) {
    const from = { email: adminMailbox.email, name: "PillQare CRM" };
    const raw = await buildMime({ ...base, from, messageId: generateMessageId(from.email) });
    await gmailSend(adminMailbox.googleAccount, raw);
    return;
  }
  throw new EmailConfigError("Aucun serveur d'envoi système configuré (SMTP_HOST / SMTP_FROM) ni boîte Google administrateur.");
}

/**
 * Email interne destiné à un utilisateur du CRM (planning quotidien, synthèse…) :
 * SMTP système, sinon sa propre boîte connectée (envoi à soi-même), sinon boîte administrateur.
 */
export async function sendInternalEmail(userId: string, content: { subject: string; text: string; html: string }) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  if (isDeliveryLogged([user.email]) || systemSmtp()) {
    return sendSystemEmail({ to: user.email, ...content });
  }
  const mailbox = await getSenderMailbox(userId);
  if (mailbox?.provider === "GOOGLE" && mailbox.googleAccount) {
    const from = { email: mailbox.email, name: "PillQare CRM" };
    const raw = await buildMime({ from, to: [{ email: user.email }], subject: content.subject, text: content.text, html: content.html, messageId: generateMessageId(from.email) });
    await gmailSend(mailbox.googleAccount, raw);
    return;
  }
  if (mailbox?.provider === "IMAP" && mailbox.smtpHost && mailbox.smtpPort) {
    const from = { email: mailbox.email, name: "PillQare CRM" };
    const raw = await buildMime({ from, to: [{ email: user.email }], subject: content.subject, text: content.text, html: content.html, messageId: generateMessageId(from.email) });
    await smtpSendRaw(
      { host: mailbox.smtpHost, port: mailbox.smtpPort, secure: mailbox.smtpSecure, user: mailbox.username, password: decryptOptional(mailbox.passwordEnc) },
      raw,
      { from: from.email, to: [user.email] },
    );
    return;
  }
  return sendSystemEmail({ to: user.email, ...content });
}
