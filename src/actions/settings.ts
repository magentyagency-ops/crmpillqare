"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertRole, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { randomToken, sha256, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { uniqueBookingSlug } from "@/lib/bootstrap";
import { slugify } from "@/lib/normalize";
import { updateSettings, type SettingsMap } from "@/lib/settings";
import { sendSystemEmail } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/render";
import { parseWorkingHours } from "@/lib/booking/slots";
import { optionalString } from "@/lib/validation";

// ───────────── Profil ─────────────

const profileSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: optionalString,
  jobTitle: optionalString,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  signature: optionalString,
  timezone: z.string().min(3).default("Europe/Paris"),
  dailyDigest: z.boolean(),
  syncTasksToCalendar: z.boolean(),
});

export async function updateProfileAction(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = profileSchema.parse(input);
    try {
      new Intl.DateTimeFormat("fr-FR", { timeZone: data.timezone });
    } catch {
      throw new UserError("Fuseau horaire invalide.");
    }
    await db.user.update({ where: { id: user.id }, data });
  }, "Profil enregistré");
}

export async function changePasswordAction(current: string, next: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(current, row.passwordHash))) throw new UserError("Mot de passe actuel incorrect.");
    const problem = passwordProblem(next);
    if (problem) throw new UserError(problem);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  }, "Mot de passe modifié");
}

// ───────────── Prise de RDV ─────────────

const bookingSchema = z.object({
  bookingEnabled: z.boolean(),
  bookingSlug: z.string().trim().min(2),
  bookingTitle: z.string().trim().min(1),
  bookingDescription: optionalString,
  bookingDurationMin: z.coerce.number().int().min(10).max(240),
  bookingBufferMin: z.coerce.number().int().min(0).max(120),
  bookingMinNoticeHours: z.coerce.number().int().min(0).max(240),
  bookingMaxDaysAhead: z.coerce.number().int().min(1).max(180),
  bookingMeetingType: z.enum(["VIDEO", "PHONE", "IN_PERSON"]),
  bookingLocation: optionalString,
  videoRoomUrl: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => !v || /^https:\/\/\S+$/i.test(v), "Le lien de visio doit commencer par https://"),
  workingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))),
});

export async function updateBookingAction(input: z.input<typeof bookingSchema>): Promise<ActionResult<{ slug: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = bookingSchema.parse(input);
    const wanted = slugify(data.bookingSlug);
    if (!wanted) throw new UserError("Lien invalide.");
    const slug = wanted === user.bookingSlug ? wanted : await uniqueBookingSlug(wanted, user.id);
    const hours = parseWorkingHours(data.workingHours);
    if (Object.values(hours).every((r) => r.length === 0)) throw new UserError("Indiquez au moins une plage horaire de disponibilité.");
    await db.user.update({ where: { id: user.id }, data: { ...data, bookingSlug: slug, workingHours: hours } });
    return { slug };
  }, "Prise de RDV enregistrée");
}

// ───────────── Équipe ─────────────

async function sendInvite(userId: string, invitedBy: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomToken(32);
  await db.userToken.create({ data: { userId, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  const link = `${env.appUrl}/reinitialiser/${token}`;
  await sendSystemEmail({
    to: user.email,
    subject: "Votre accès au CRM PillQare",
    text: `Bonjour ${user.firstName},\n\n${invitedBy} vous a créé un accès au CRM PillQare.\nChoisissez votre mot de passe (lien valable 7 jours) :\n${link}\n\nÀ bientôt !`,
    html: `<p>Bonjour ${escapeHtml(user.firstName)},</p><p>${escapeHtml(invitedBy)} vous a créé un accès au CRM PillQare.</p><p><a href="${link}">Choisir mon mot de passe</a> (lien valable 7 jours)</p>`,
  });
  return link;
}

const memberSchema = z.object({
  email: z.email("Email invalide").transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]),
  phone: optionalString,
  jobTitle: optionalString,
});

export async function inviteMemberAction(input: z.input<typeof memberSchema>): Promise<ActionResult<{ link: string }>> {
  return runAction(async () => {
    const me = await assertRole("ADMIN", "MANAGER");
    const data = memberSchema.parse(input);
    if (data.role === "ADMIN" && me.role !== "ADMIN") throw new UserError("Seul un administrateur peut créer un administrateur.");
    if (await db.user.findUnique({ where: { email: data.email } })) throw new UserError("Un utilisateur existe déjà avec cet email.");
    const colors = ["#1B7A45", "#D97706", "#7C3AED", "#0E7490", "#DB2777", "#2563EB", "#B91C1C"];
    const user = await db.user.create({
      data: {
        ...data,
        color: colors[(await db.user.count()) % colors.length]!,
        bookingSlug: await uniqueBookingSlug(`${data.firstName}-${data.lastName}`),
        signature: `${data.firstName} ${data.lastName}${data.jobTitle ? `\n${data.jobTitle}` : ""} — PillQare${data.phone ? `\n${data.phone}` : ""}`,
      },
    });
    let link: string;
    try {
      link = await sendInvite(user.id, `${me.firstName} ${me.lastName}`);
    } catch {
      // Envoi impossible (SMTP non configuré) : le lien est affiché à l'administrateur
      const token = randomToken(32);
      await db.userToken.create({ data: { userId: user.id, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      link = `${env.appUrl}/reinitialiser/${token}`;
    }
    return { link };
  }, "Invitation créée");
}

export async function resendInviteAction(userId: string): Promise<ActionResult<{ link: string }>> {
  return runAction(async () => {
    const me = await assertRole("ADMIN", "MANAGER");
    let link: string;
    try {
      link = await sendInvite(userId, `${me.firstName} ${me.lastName}`);
    } catch {
      const token = randomToken(32);
      await db.userToken.create({ data: { userId, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      link = `${env.appUrl}/reinitialiser/${token}`;
    }
    return { link };
  }, "Nouveau lien d'accès généré");
}

const memberUpdateSchema = z.object({
  role: z.enum(["ADMIN", "MANAGER", "SALES"]),
  active: z.boolean(),
  receivesLeads: z.boolean(),
  segmentIds: z.array(z.string()),
});

export async function updateMemberAction(userId: string, input: z.input<typeof memberUpdateSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const me = await assertRole("ADMIN", "MANAGER");
    const data = memberUpdateSchema.parse(input);
    const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if ((target.role === "ADMIN" || data.role === "ADMIN") && me.role !== "ADMIN") throw new UserError("Action réservée aux administrateurs.");
    if (userId === me.id && (!data.active || data.role !== me.role)) throw new UserError("Vous ne pouvez pas modifier votre propre rôle ou vous désactiver.");
    if (target.role === "ADMIN" && (data.role !== "ADMIN" || !data.active)) {
      const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) throw new UserError("Il doit rester au moins un administrateur actif.");
    }
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { role: data.role, active: data.active, receivesLeads: data.receivesLeads } }),
      db.userSegment.deleteMany({ where: { userId } }),
      db.userSegment.createMany({ data: data.segmentIds.map((segmentId) => ({ userId, segmentId })) }),
    ]);
    if (!data.active) await revokeAllSessions(userId);
  }, "Membre mis à jour");
}

/** Transfert des dossiers, contacts et tâches ouvertes d'un commercial (départ, absence). */
export async function transferPortfolioAction(fromUserId: string, toUserId: string): Promise<ActionResult<{ deals: number }>> {
  return runAction(async () => {
    const me = await assertRole("ADMIN", "MANAGER");
    if (fromUserId === toUserId) throw new UserError("Choisissez un autre commercial.");
    const { reassignDeal } = await import("@/lib/deals");
    const deals = await db.deal.findMany({ where: { ownerId: fromUserId, stage: { notIn: ["WON", "LOST"] } }, select: { id: true } });
    for (const d of deals) await reassignDeal(d.id, toUserId, me.id);
    await db.contact.updateMany({ where: { ownerId: fromUserId }, data: { ownerId: toUserId } });
    await db.company.updateMany({ where: { ownerId: fromUserId }, data: { ownerId: toUserId } });
    await db.task.updateMany({ where: { assigneeId: fromUserId, status: "OPEN" }, data: { assigneeId: toUserId } });
    await db.sequenceEnrollment.updateMany({ where: { ownerId: fromUserId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { ownerId: toUserId } });
    return { deals: deals.length };
  }, "Portefeuille transféré");
}

// ───────────── Paramètres de l'entreprise ─────────────

export async function updateSettingsAction<K extends keyof SettingsMap>(key: K, patch: Partial<SettingsMap[K]>): Promise<ActionResult> {
  return runAction(async () => {
    const adminOnly: (keyof SettingsMap)[] = ["company", "quotes", "visibility", "shopify", "ai"];
    if (adminOnly.includes(key)) await assertRole("ADMIN");
    else await assertRole("ADMIN", "MANAGER");
    if (key === "followups") {
      const f = patch as Partial<SettingsMap["followups"]>;
      if (f.windowStart && f.windowEnd && f.windowStart >= f.windowEnd) throw new UserError("L'heure de début d'envoi doit précéder l'heure de fin.");
    }
    await updateSettings(key, patch);
  }, "Paramètres enregistrés");
}

// ───────────── Référentiels ─────────────

export async function saveSegmentAction(input: { id?: string | null; name: string; kind: "B2B" | "B2C"; color: string; description?: string | null; keywords?: string[]; active: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    if (!input.name.trim()) throw new UserError("Nom obligatoire.");
    const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 60);
    const data = { name: input.name.trim(), kind: input.kind, color: input.color, description: input.description ?? null, keywords, active: input.active };
    if (input.id) await db.segment.update({ where: { id: input.id }, data });
    else await db.segment.create({ data: { ...data, position: await db.segment.count() } });
  }, "Cible enregistrée");
}

export async function deleteSegmentAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const used = (await db.contact.count({ where: { segmentId: id } })) + (await db.deal.count({ where: { segmentId: id } }));
    if (used) {
      await db.segment.update({ where: { id }, data: { active: false } });
      return;
    }
    await db.segment.delete({ where: { id } });
  }, "Cible supprimée (ou désactivée si utilisée)");
}

export async function saveLostReasonAction(input: { id?: string | null; label: string; active: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    if (!input.label.trim()) throw new UserError("Libellé obligatoire.");
    if (input.id) await db.lostReason.update({ where: { id: input.id }, data: { label: input.label.trim(), active: input.active } });
    else await db.lostReason.create({ data: { label: input.label.trim(), position: await db.lostReason.count() } });
  }, "Motif enregistré");
}

const productSchema = z.object({
  id: optionalString,
  name: z.string().trim().min(1, "Nom obligatoire"),
  sku: optionalString,
  description: optionalString,
  type: z.enum(["HARDWARE", "SUBSCRIPTION", "SERVICE", "CONSUMABLE"]),
  unitPriceHT: z.coerce.number().min(0),
  vatRate: z.coerce.number().min(0).max(100),
  unit: z.string().trim().min(1).default("unité"),
  active: z.boolean(),
  shopifyVariantId: optionalString,
});

export async function saveProductAction(input: z.input<typeof productSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const { id, ...data } = productSchema.parse(input);
    if (id) await db.product.update({ where: { id }, data });
    else await db.product.create({ data });
  }, "Produit enregistré");
}

// ───────────── Formulaires du site ─────────────

const formSchema = z.object({
  id: optionalString,
  name: z.string().trim().min(1),
  key: z.string().trim().min(2),
  active: z.boolean(),
  description: optionalString,
  contactKind: z.enum(["B2B", "B2C"]),
  segmentId: optionalString,
  assignmentStrategy: z.enum(["ROUND_ROBIN", "SEGMENT", "FIXED"]),
  fixedOwnerId: optionalString,
  createDeal: z.boolean(),
  sendConfirmation: z.boolean(),
  confirmationSubject: optionalString,
  confirmationBody: optionalString,
  callbackDelayMinutes: z.coerce.number().int().min(0).max(10080),
  successMessage: optionalString,
  redirectUrl: optionalString,
  allowedOrigins: z.array(z.string()).default([]),
});

export async function saveFormAction(input: z.input<typeof formSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const { id, ...data } = formSchema.parse(input);
    const key = slugify(data.key);
    if (data.assignmentStrategy === "FIXED" && !data.fixedOwnerId) throw new UserError("Choisissez le commercial qui reçoit les demandes.");
    const other = await db.webForm.findUnique({ where: { key } });
    if (other && other.id !== id) throw new UserError("Cet identifiant de formulaire est déjà utilisé.");
    const origins = data.allowedOrigins.map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
    const payload = { ...data, key, allowedOrigins: origins };
    const form = id ? await db.webForm.update({ where: { id }, data: payload }) : await db.webForm.create({ data: payload });
    return { id: form.id };
  }, "Formulaire enregistré");
}

export async function deleteFormAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    await db.webForm.delete({ where: { id } });
  }, "Formulaire supprimé");
}

// ───────────── Intégrations ─────────────

const imapSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  displayName: optionalString,
  imapHost: z.string().trim().min(3),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(3),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

/** Connexion d'une boîte professionnelle (OVH, Ionos, Office 365, Infomaniak…) en IMAP/SMTP, testée avant enregistrement. */
export async function connectImapMailboxAction(input: z.input<typeof imapSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = imapSchema.parse(input);
    const { testImap } = await import("@/lib/email/imap");
    const { testSmtp } = await import("@/lib/email/smtp");
    let sentFolder: string | null = null;
    try {
      sentFolder = (await testImap({ host: data.imapHost, port: data.imapPort, secure: data.imapSecure, user: data.username, password: data.password })).sentFolder;
    } catch (error) {
      throw new UserError(`Connexion IMAP impossible : ${error instanceof Error ? error.message : error}`);
    }
    try {
      await testSmtp({ host: data.smtpHost, port: data.smtpPort, secure: data.smtpSecure, user: data.username, password: data.password });
    } catch (error) {
      throw new UserError(`Connexion SMTP impossible : ${error instanceof Error ? error.message : error}`);
    }
    await db.mailbox.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await db.mailbox.upsert({
      where: { userId_email: { userId: user.id, email: data.email } },
      create: {
        userId: user.id,
        provider: "IMAP",
        email: data.email,
        displayName: data.displayName,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecure: data.imapSecure,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecure: data.smtpSecure,
        username: data.username,
        passwordEnc: encrypt(data.password),
        sentFolder,
        isDefault: true,
      },
      update: {
        provider: "IMAP",
        displayName: data.displayName,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecure: data.imapSecure,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecure: data.smtpSecure,
        username: data.username,
        passwordEnc: encrypt(data.password),
        sentFolder,
        isDefault: true,
        status: "ACTIVE",
        lastError: null,
      },
    });
    const box = await db.mailbox.findUniqueOrThrow({ where: { userId_email: { userId: user.id, email: data.email } } });
    const { enqueueJob } = await import("@/lib/jobs");
    await enqueueJob("mailbox.sync", { mailboxId: box.id });
  }, "Boîte mail connectée — import des 30 derniers jours en cours");
}

export async function removeMailboxAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const box = await db.mailbox.findUniqueOrThrow({ where: { id } });
    if (box.userId !== user.id && user.role !== "ADMIN") throw new UserError("Accès refusé.");
    await db.mailbox.delete({ where: { id } });
  }, "Boîte mail déconnectée (l'historique des emails est conservé)");
}

export async function setDefaultMailboxAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await db.mailbox.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await db.mailbox.update({ where: { id, userId: user.id }, data: { isDefault: true } });
  }, "Adresse d'envoi par défaut mise à jour");
}

export async function disconnectGoogleAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const account = await db.googleAccount.findUnique({ where: { userId: user.id } });
    if (!account) return;
    const { revokeGoogleToken } = await import("@/lib/google/oauth");
    await revokeGoogleToken(account);
    await db.googleAccount.delete({ where: { id: account.id } });
  }, "Compte Google déconnecté");
}

export async function syncGoogleNowAction(): Promise<ActionResult<{ created: number; updated: number }>> {
  return runAction(async () => {
    const user = await assertUser();
    const account = await db.googleAccount.findUnique({ where: { userId: user.id } });
    if (!account) throw new UserError("Aucun compte Google connecté.");
    const { syncGoogleCalendar } = await import("@/lib/google/calendar");
    return syncGoogleCalendar(account);
  }, "Agenda synchronisé");
}

const shopifySchema = z.object({
  shopDomain: z.string().min(3),
  authMode: z.enum(["CLIENT_CREDENTIALS", "ACCESS_TOKEN"]),
  clientId: optionalString,
  clientSecret: optionalString,
  accessToken: optionalString,
  webhookSecret: optionalString,
  apiVersion: optionalString,
});

/** Connexion de la boutique Shopify (identifiants vérifiés avant enregistrement). */
export async function connectShopifyAction(input: z.input<typeof shopifySchema>): Promise<ActionResult<{ shop: string; webhooks: string }>> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const data = shopifySchema.parse(input);
    const { normalizeShopDomain, requestClientCredentialsToken, testShopifyConnection, registerShopifyWebhooks } = await import("@/lib/shopify/client");
    const shop = normalizeShopDomain(data.shopDomain);
    if (!shop) throw new UserError("Domaine invalide : utilisez « votre-boutique.myshopify.com ».");
    const apiVersion = data.apiVersion || env.shopify.apiVersion;
    let accessTokenEnc: string | null = null;
    let tokenExpiresAt: Date | null = null;
    let scopes: string | null = null;
    if (data.authMode === "CLIENT_CREDENTIALS") {
      if (!data.clientId || !data.clientSecret) throw new UserError("Client ID et Client secret obligatoires.");
      const t = await requestClientCredentialsToken(shop, data.clientId, data.clientSecret);
      accessTokenEnc = encrypt(t.accessToken);
      tokenExpiresAt = new Date(Date.now() + t.expiresIn * 1000);
      scopes = t.scope;
    } else {
      if (!data.accessToken) throw new UserError("Jeton d'accès Admin API obligatoire.");
      accessTokenEnc = encrypt(data.accessToken);
    }
    const existing = await db.shopifyConnection.findFirst();
    const payload = {
      shopDomain: shop,
      authMode: data.authMode,
      clientId: data.clientId,
      clientSecretEnc: data.clientSecret ? encrypt(data.clientSecret) : (existing?.clientSecretEnc ?? null),
      accessTokenEnc,
      tokenExpiresAt,
      scopes,
      apiVersion,
      webhookSecretEnc: data.webhookSecret ? encrypt(data.webhookSecret) : (existing?.webhookSecretEnc ?? null),
      status: "ACTIVE" as const,
      lastError: null,
    };
    const conn = existing ? await db.shopifyConnection.update({ where: { id: existing.id }, data: payload }) : await db.shopifyConnection.create({ data: payload });
    const info = await testShopifyConnection(conn);
    let webhooks = "";
    try {
      const res = await registerShopifyWebhooks(conn);
      webhooks = res.errors.length ? res.errors.join(" ; ") : `${res.created} webhook(s) créé(s), ${res.existing} existant(s)`;
    } catch (error) {
      webhooks = `Webhooks non enregistrés : ${error instanceof Error ? error.message : error}`;
    }
    const { enqueueJob } = await import("@/lib/jobs");
    await enqueueJob("shopify.sync", { full: true });
    return { shop: info.name, webhooks };
  }, "Boutique Shopify connectée — import des clients et commandes en cours");
}

export async function shopifySyncNowAction(full: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN", "MANAGER");
    const { enqueueJob } = await import("@/lib/jobs");
    await enqueueJob("shopify.sync", { full });
    const { runJobsNow } = await import("@/lib/scheduler");
    await runJobsNow(5);
  }, "Synchronisation Shopify effectuée");
}

export async function shopifyRegisterWebhooksAction(): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const { getShopifyConnection, registerShopifyWebhooks } = await import("@/lib/shopify/client");
    const conn = await getShopifyConnection();
    if (!conn) throw new UserError("Shopify n'est pas connecté.");
    const res = await registerShopifyWebhooks(conn);
    if (res.errors.length) throw new UserError(res.errors.join(" ; "));
    return { message: `${res.created} webhook(s) créé(s), ${res.existing} déjà actif(s)` };
  });
}

export async function disconnectShopifyAction(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN");
    await db.shopifyConnection.deleteMany({});
  }, "Shopify déconnecté (les clients et commandes importés sont conservés)");
}

// ───────────── Système ─────────────

export async function runSchedulerNowAction(): Promise<ActionResult<{ ran: string[] }>> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const { runSchedulerTick } = await import("@/lib/scheduler");
    const res = await runSchedulerTick({ only: ["jobs", "sequences", "meetingReminders", "taskReminders", "endedMeetings", "aiRecovery", "emailSync", "calendarSync", "digests"] });
    if (res.skipped) throw new UserError("Le planificateur est déjà en cours d'exécution, réessayez dans un instant.");
    return { ran: res.ran };
  }, "Planificateur exécuté");
}

export async function retryFailedJobsAction(): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const res = await db.job.updateMany({ where: { status: "FAILED" }, data: { status: "PENDING", attempts: 0, runAt: new Date() } });
    return { count: res.count };
  }, "Tâches relancées");
}

export async function sendTestDigestAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const { sendDigestNow } = await import("@/lib/scheduler/digest");
    await sendDigestNow(user.id);
  }, "Planning du jour envoyé sur votre email");
}

// ───────────── Application Google (OAuth) ─────────────

/**
 * Enregistre les identifiants de l'application Google après les avoir vérifiés auprès de Google
 * (un code fictif est échangé : « invalid_grant » prouve que l'ID et le secret sont reconnus).
 */
export async function saveGoogleConfigAction(input: { clientId: string; clientSecret: string }): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new UserError("L'ID client doit se terminer par « .apps.googleusercontent.com ».");
    if (clientSecret.length < 10) throw new UserError("Code secret du client manquant ou incomplet.");
    const { googleRedirectUri } = await import("@/lib/google/oauth");
    let error = "";
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: "verification-crm", client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }),
      });
      error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "";
    } catch {
      throw new UserError("Impossible de joindre Google pour vérifier les identifiants : réessayez.");
    }
    if (error === "invalid_client" || error === "unauthorized_client") throw new UserError("Google ne reconnaît pas cet ID client ou ce code secret : vérifiez le copier-coller.");
    if (error === "redirect_uri_mismatch") throw new UserError(`L'URI de redirection n'est pas autorisée : ajoutez exactement ${googleRedirectUri()} dans le client OAuth.`);
    const { saveGoogleCredentials } = await import("@/lib/google/config");
    await saveGoogleCredentials(clientId, clientSecret);
  }, "Connexion Google activée");
}

export async function clearGoogleConfigAction(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN");
    const { clearGoogleCredentials } = await import("@/lib/google/config");
    await clearGoogleCredentials();
  }, "Configuration Google retirée");
}
