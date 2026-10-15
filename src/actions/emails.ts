"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertRole, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { composeEmail, renderTemplate } from "@/lib/email/render";
import { buildTemplateVars } from "@/lib/email/vars";
import { retryEmail, sendEmail } from "@/lib/email/send";
import { optionalString } from "@/lib/validation";

export async function listTemplatesAction() {
  const user = await assertUser();
  return db.emailTemplate.findMany({
    where: { OR: [{ ownerId: null }, { ownerId: user.id }] },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true },
  });
}

/** Modèle personnalisé pour un contact (variables remplacées). */
export async function renderTemplateAction(templateId: string, ctx: { contactId?: string | null; dealId?: string | null }): Promise<ActionResult<{ subject: string; body: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const tpl = await db.emailTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const vars = await buildTemplateVars({ contactId: ctx.contactId, dealId: ctx.dealId, userId: user.id });
    return { subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars) };
  });
}

function emails(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Envoi d'un email depuis le CRM (boîte connectée du commercial), avec pièces jointes. */
export async function sendEmailAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const to = emails(form.get("to"));
    const cc = emails(form.get("cc"));
    const bcc = emails(form.get("bcc"));
    const invalid = [...to, ...cc, ...bcc].filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) throw new UserError(`Adresse(s) invalide(s) : ${invalid.join(", ")}`);
    if (!to.length) throw new UserError("Indiquez au moins un destinataire.");
    const subject = String(form.get("subject") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!subject) throw new UserError("L'objet est obligatoire.");
    if (!body) throw new UserError("Le message est vide.");
    const contactId = (form.get("contactId") as string) || null;
    const dealId = (form.get("dealId") as string) || null;
    const replyToId = (form.get("replyToId") as string) || null;

    const files = form.getAll("attachments").filter((f): f is File => typeof f !== "string" && f.size > 0);
    const totalSize = files.reduce((a, f) => a + f.size, 0);
    if (totalSize > 20 * 1024 * 1024) throw new UserError("Pièces jointes trop volumineuses (20 Mo maximum).");
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) })));

    const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { signature: true } });
    const vars = await buildTemplateVars({ contactId, dealId, userId: user.id });
    const composed = composeEmail({ subject, body, vars, signature: me.signature });

    // Rattachement automatique au contact du destinataire si besoin
    let finalContactId = contactId;
    if (!finalContactId) {
      const c = await db.contact.findFirst({ where: { emailNormalized: { in: to } }, select: { id: true } });
      finalContactId = c?.id ?? null;
    }
    const sent = await sendEmail({
      senderId: user.id,
      to,
      cc,
      bcc,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
      contactId: finalContactId,
      dealId,
      replyToId,
      attachments,
    });
    return { id: sent.id };
  }, "Email envoyé");
}

export async function markEmailHandledAction(id: string, handled = true): Promise<ActionResult> {
  return runAction(async () => {
    await assertUser();
    const email = await db.emailMessage.findUniqueOrThrow({ where: { id } });
    await db.emailMessage.updateMany({ where: { threadKey: email.threadKey, direction: "INBOUND" }, data: { handledAt: handled ? new Date() : null } });
    if (handled && email.contactId) {
      // La tâche « Répondre » associée n'a plus lieu d'être
      await db.task.updateMany({ where: { contactId: email.contactId, status: "OPEN", type: "EMAIL", source: "SYSTEM" }, data: { status: "DONE", completedAt: new Date() } });
    }
  }, handled ? "Marqué comme traité" : "Marqué comme à traiter");
}

export async function retryEmailAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertUser();
    await retryEmail(id);
  }, "Email renvoyé");
}

const templateSchema = z.object({
  name: z.string().trim().min(1, "Nom obligatoire"),
  category: z.enum(["PROSPECTION", "FOLLOW_UP", "MEETING", "QUOTE", "TRIAL", "POST_PURCHASE", "OTHER"]),
  subject: z.string().trim().min(1, "Objet obligatoire"),
  body: z.string().trim().min(1, "Message obligatoire"),
  shared: z.boolean().default(true),
  id: optionalString,
});

export async function saveTemplateAction(input: z.input<typeof templateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = templateSchema.parse(input);
    const ownerId = data.shared ? null : user.id;
    if (data.shared && user.role === "SALES") throw new UserError("Seuls les managers peuvent créer des modèles partagés.");
    if (data.id) {
      const tpl = await db.emailTemplate.findUniqueOrThrow({ where: { id: data.id } });
      if (tpl.ownerId === null && user.role === "SALES") throw new UserError("Modèle partagé : modification réservée aux managers.");
      if (tpl.ownerId && tpl.ownerId !== user.id) throw new UserError("Ce modèle appartient à un autre utilisateur.");
      await db.emailTemplate.update({ where: { id: data.id }, data: { name: data.name, category: data.category, subject: data.subject, body: data.body, ownerId } });
    } else {
      await db.emailTemplate.create({ data: { name: data.name, category: data.category, subject: data.subject, body: data.body, ownerId } });
    }
  }, "Modèle enregistré");
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const tpl = await db.emailTemplate.findUniqueOrThrow({ where: { id } });
    if (tpl.ownerId === null) await assertRole("ADMIN", "MANAGER");
    else if (tpl.ownerId !== user.id) throw new UserError("Ce modèle appartient à un autre utilisateur.");
    await db.emailTemplate.delete({ where: { id } });
  }, "Modèle supprimé");
}

/** Version HTML nettoyée d'un email (affichage dans un cadre isolé). */
export async function getEmailHtmlAction(id: string): Promise<string> {
  const user = await assertUser();
  const email = await db.emailMessage.findUniqueOrThrow({ where: { id }, select: { htmlBody: true, textBody: true, contactId: true, userId: true } });
  // Email hors CRM : réservé au propriétaire de la boîte
  if (!email.contactId && email.userId !== user.id) return "<p>Email privé.</p>";
  const { default: sanitizeHtml } = await import("sanitize-html");
  const html = email.htmlBody ?? `<pre style="white-space:pre-wrap;font-family:inherit">${(email.textBody ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span", "center", "font"]),
    allowedAttributes: { "*": ["style", "align", "width", "height", "color", "bgcolor"], a: ["href", "title"], img: ["src", "alt", "width", "height"] },
    allowedSchemes: ["http", "https", "mailto", "tel", "data", "cid"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}

/** Synchronise immédiatement les boîtes mail de l'utilisateur. */
export async function syncMyMailboxesAction(): Promise<ActionResult<{ stored: number }>> {
  return runAction(async () => {
    const user = await assertUser();
    const boxes = await db.mailbox.findMany({ where: { userId: user.id, status: { not: "DISCONNECTED" } }, select: { id: true, email: true } });
    if (boxes.length === 0) throw new UserError("Aucune boîte mail connectée : configurez-la dans Paramètres > Intégrations.");
    const { syncMailbox } = await import("@/lib/scheduler");
    let stored = 0;
    const errors: string[] = [];
    for (const b of boxes) {
      try {
        const res = await syncMailbox(b.id);
        stored += res?.stored ?? 0;
      } catch (error) {
        errors.push(`${b.email} : ${error instanceof Error ? error.message : error}`);
      }
    }
    if (errors.length) throw new UserError(`Synchronisation partielle — ${errors.join(" ; ")}`);
    return { stored };
  }, "Boîtes mail synchronisées");
}
