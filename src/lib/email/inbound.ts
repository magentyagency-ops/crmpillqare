import type { Mailbox } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { advanceDealTo, findOpenDealForContact } from "@/lib/deals";
import { contactDisplayName } from "@/lib/labels";
import { normalizeEmail } from "@/lib/normalize";
import { getSettings } from "@/lib/settings";
import { truncate } from "@/lib/format";
import { stripQuotedReply, type NormalizedMessage } from "./parse";

export type IngestResult = "stored" | "duplicate" | "skipped" | "bounce";

/** Adresses appartenant aux utilisateurs du CRM (pour ignorer les échanges internes). */
async function internalAddresses(): Promise<Set<string>> {
  const [users, mailboxes] = await Promise.all([
    db.user.findMany({ select: { email: true } }),
    db.mailbox.findMany({ select: { email: true } }),
  ]);
  return new Set([...users.map((u) => u.email.toLowerCase()), ...mailboxes.map((m) => m.email.toLowerCase())]);
}

/**
 * Intègre un message synchronisé (IMAP ou Gmail) : rattachement au contact / dossier,
 * historique, détection des réponses (adaptation des relances), rebonds et réponses automatiques.
 */
export async function ingestMessage(
  mailbox: Pick<Mailbox, "id" | "userId" | "email">,
  msg: NormalizedMessage,
  opts: { folder: "INBOX" | "SENT" | "OTHER"; internal?: Set<string> } = { folder: "OTHER" },
): Promise<IngestResult> {
  // 1. Doublon (même boîte, même Message-ID ou même identifiant fournisseur)
  const existing = await db.emailMessage.findFirst({
    where: {
      mailboxId: mailbox.id,
      OR: [{ messageId: msg.messageId }, ...(msg.providerId ? [{ providerId: msg.providerId }] : [])],
    },
    select: { id: true, providerId: true, threadKey: true },
  });
  if (existing) {
    if ((!existing.providerId && msg.providerId) || (msg.providerThreadId && existing.threadKey !== msg.providerThreadId)) {
      await db.emailMessage.update({
        where: { id: existing.id },
        data: { providerId: existing.providerId ?? msg.providerId, ...(msg.providerThreadId ? { threadKey: msg.providerThreadId } : {}) },
      });
    }
    return "duplicate";
  }

  const internal = opts.internal ?? (await internalAddresses());
  const mailboxAddr = mailbox.email.toLowerCase();
  const outbound = opts.folder === "SENT" || msg.from.email === mailboxAddr || internal.has(msg.from.email);

  // 2. Rebond (adresse invalide)
  if (!outbound && msg.isBounce) {
    await handleBounce(mailbox, msg);
    return "bounce";
  }

  // 3. Fil de discussion existant
  const threadIds = [msg.inReplyTo, ...msg.references].filter((x): x is string => Boolean(x));
  const parent = threadIds.length
    ? await db.emailMessage.findFirst({
        where: { messageId: { in: threadIds } },
        orderBy: { sentAt: "desc" },
        select: { contactId: true, dealId: true, threadKey: true },
      })
    : null;

  // 4. Contact concerné
  let contact: { id: string; ownerId: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null = null;
  const contactSelect = { id: true, ownerId: true, firstName: true, lastName: true, email: true, phone: true } as const;
  if (!outbound) {
    const e = normalizeEmail(msg.from.email);
    if (e) contact = await db.contact.findUnique({ where: { emailNormalized: e }, select: contactSelect });
  } else {
    const recipients = [...msg.to, ...msg.cc].map((a) => normalizeEmail(a.email)).filter((e): e is string => Boolean(e) && !internal.has(e!));
    if (recipients.length) {
      contact = await db.contact.findFirst({ where: { emailNormalized: { in: recipients } }, select: contactSelect });
    }
  }
  if (!contact && parent?.contactId) {
    contact = await db.contact.findUnique({ where: { id: parent.contactId }, select: contactSelect });
  }
  // Échange purement interne
  const everyone = [msg.from, ...msg.to, ...msg.cc].map((a) => a.email.toLowerCase());
  if (everyone.every((e) => internal.has(e))) return "skipped";

  // Email sans contact du CRM (newsletter, nouveau correspondant…) : conservé dans la boîte de réception, sans automatisme
  if (!contact) {
    const threadKey = msg.providerThreadId ?? parent?.threadKey ?? msg.references[0] ?? msg.inReplyTo ?? msg.messageId;
    await db.emailMessage.create({
      data: {
        mailboxId: mailbox.id,
        direction: outbound ? "OUTBOUND" : "INBOUND",
        status: outbound ? "SENT" : "RECEIVED",
        messageId: msg.messageId,
        threadKey,
        providerId: msg.providerId,
        inReplyTo: msg.inReplyTo,
        references: msg.references.join(" ") || null,
        fromEmail: msg.from.email,
        fromName: msg.from.name,
        toEmails: msg.to.map((a) => a.email),
        ccEmails: msg.cc.map((a) => a.email),
        subject: msg.subject.slice(0, 500),
        textBody: msg.text,
        htmlBody: msg.html,
        snippet: truncate(stripQuotedReply(msg.text), 200),
        sentAt: msg.date,
        userId: mailbox.userId,
        attachments: msg.attachments.length ? msg.attachments : undefined,
        handledAt: outbound || msg.isAutoReply ? new Date() : null,
      },
    });
    if (outbound) {
      await db.emailMessage.updateMany({ where: { threadKey, direction: "INBOUND", handledAt: null, sentAt: { lte: msg.date } }, data: { handledAt: new Date() } });
    }
    return "stored";
  }

  const deal = parent?.dealId ? { id: parent.dealId } : await findOpenDealForContact(contact.id);
  const threadKey = msg.providerThreadId ?? parent?.threadKey ?? msg.references[0] ?? msg.inReplyTo ?? msg.messageId;
  const preview = truncate(stripQuotedReply(msg.text), 200);

  const message = await db.emailMessage.create({
    data: {
      mailboxId: mailbox.id,
      direction: outbound ? "OUTBOUND" : "INBOUND",
      status: outbound ? "SENT" : "RECEIVED",
      messageId: msg.messageId,
      threadKey,
      providerId: msg.providerId,
      inReplyTo: msg.inReplyTo,
      references: msg.references.join(" ") || null,
      fromEmail: msg.from.email,
      fromName: msg.from.name,
      toEmails: msg.to.map((a) => a.email),
      ccEmails: msg.cc.map((a) => a.email),
      subject: msg.subject.slice(0, 500),
      textBody: msg.text,
      htmlBody: msg.html,
      snippet: preview,
      sentAt: msg.date,
      contactId: contact.id,
      dealId: deal?.id ?? null,
      userId: mailbox.userId,
      attachments: msg.attachments.length ? msg.attachments : undefined,
      handledAt: outbound || msg.isAutoReply ? new Date() : null,
    },
  });

  await logActivity({
    type: outbound ? "EMAIL_SENT" : "EMAIL_RECEIVED",
    title: msg.subject.slice(0, 200),
    body: preview || null,
    occurredAt: msg.date,
    contactId: contact.id,
    dealId: deal?.id ?? null,
    userId: outbound ? mailbox.userId : null,
    emailMessageId: message.id,
    metadata: msg.isAutoReply ? { autoReply: true } : undefined,
  });

  if (outbound) {
    // Le commercial a répondu depuis sa messagerie : les messages entrants du fil sont traités
    await db.emailMessage.updateMany({
      where: { threadKey, direction: "INBOUND", handledAt: null, sentAt: { lte: msg.date } },
      data: { handledAt: new Date() },
    });
    await db.contact.update({ where: { id: contact.id }, data: { lastContactedAt: msg.date } });
    const { isRealExchange, onManualEmailSent } = await import("@/lib/sequences/engine");
    if (deal?.id && (await isRealExchange(contact.id))) await advanceDealTo(deal.id, "CONTACTED", { userId: mailbox.userId });
    // Email écrit depuis la messagerie (hors CRM) dans les dernières heures : mêmes précautions qu'un envoi depuis le CRM
    if (Date.now() - msg.date.getTime() < 6 * 3600_000) await onManualEmailSent(contact.id);
    return "stored";
  }

  if (msg.isAutoReply) return "stored";

  // 5. Vraie réponse du prospect : adaptation immédiate
  await db.contact.update({ where: { id: contact.id }, data: { lastInboundAt: msg.date } });
  const { onContactReplied } = await import("@/lib/sequences/engine");
  await onContactReplied(contact.id, msg.date);
  if (deal?.id) await advanceDealTo(deal.id, "CONTACTED", { userId: null });

  const ownerId = contact.ownerId ?? mailbox.userId;
  const name = contactDisplayName(contact);
  await notify({
    userId: ownerId,
    type: "EMAIL_REPLY",
    title: `${name} a répondu : ${truncate(msg.subject, 80)}`,
    body: preview,
    link: `/contacts/${contact.id}?tab=emails`,
  });

  const settings = await getSettings("followups");
  if (settings.replyTask) {
    const open = await db.task.findFirst({ where: { contactId: contact.id, status: "OPEN", type: "EMAIL", source: "SYSTEM" } });
    if (!open) {
      const { createTask } = await import("@/lib/tasks");
      await createTask({
        title: `Répondre à ${name} : ${truncate(msg.subject, 80)}`,
        type: "EMAIL",
        priority: "HIGH",
        source: "SYSTEM",
        dueAt: new Date(),
        hasTime: false,
        assigneeId: ownerId,
        contactId: contact.id,
        dealId: deal?.id ?? null,
      });
    }
  }
  return "stored";
}

async function handleBounce(mailbox: Pick<Mailbox, "id" | "userId">, msg: NormalizedMessage) {
  const recipient = msg.bouncedRecipient;
  const original = await db.emailMessage.findFirst({
    where: {
      direction: "OUTBOUND",
      status: "SENT",
      ...(recipient ? { toEmails: { has: recipient } } : msg.inReplyTo ? { messageId: msg.inReplyTo } : { id: "__none__" }),
      sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    orderBy: { sentAt: "desc" },
    include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true } } },
  });
  if (!original) return;
  await db.emailMessage.update({
    where: { id: original.id },
    data: { status: "FAILED", error: `Email non distribué (rejeté par le serveur du destinataire)${recipient ? ` : ${recipient}` : ""}` },
  });
  if (original.stepRunId) {
    await db.sequenceStepRun.update({ where: { id: original.stepRunId }, data: { status: "FAILED", error: "Adresse email invalide (rebond)" } });
  }
  if (original.contact) {
    const { stopContactEnrollments } = await import("@/lib/sequences/engine");
    await stopContactEnrollments(original.contact.id, "ERROR");
    await logActivity({
      type: "SYSTEM",
      title: "Email non distribué",
      body: `L'adresse ${recipient ?? original.toEmails.join(", ")} semble invalide. Vérifiez les coordonnées du contact.`,
      contactId: original.contact.id,
      dealId: original.dealId,
    });
    await notify({
      userId: original.contact.ownerId ?? mailbox.userId,
      type: "SYSTEM",
      title: `Email non distribué à ${contactDisplayName(original.contact)}`,
      body: `« ${original.subject} » a été rejeté. Vérifiez l'adresse email.`,
      link: `/contacts/${original.contact.id}`,
    });
  }
}
