import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { upsertContact } from "./contacts";
import { pickOwner } from "./assignment";
import { createDeal, findOpenDealForContact } from "./deals";
import { logActivity } from "./activity";
import { notify } from "./notifications";
import { createTask } from "./tasks";
import { contactDisplayName } from "./labels";
import { clampToBusinessWindow } from "./dates";
import { getSettings } from "./settings";
import { composeEmail } from "./email/render";
import { buildTemplateVars } from "./email/vars";
import { enqueueJob } from "./jobs";
import { normalizeEmail, normalizePhone, splitFullName } from "./normalize";
import { detectSegment, loadSegmentCandidates } from "./segments";

/** Correspondance des noms de champs usuels (français / anglais) vers le modèle du CRM. */
const ALIASES: Record<string, string[]> = {
  firstName: ["firstname", "first_name", "prenom", "prénom", "given_name"],
  lastName: ["lastname", "last_name", "nom", "family_name", "surname"],
  fullName: ["name", "fullname", "full_name", "nom_complet", "nomcomplet"],
  email: ["email", "e-mail", "mail", "courriel", "adresse_email"],
  phone: ["phone", "tel", "telephone", "téléphone", "mobile", "portable", "numero", "phone_number"],
  company: ["company", "societe", "société", "entreprise", "organisation", "organization", "etablissement", "établissement", "structure", "pharmacie"],
  jobTitle: ["jobtitle", "job_title", "fonction", "poste", "role", "profession"],
  message: ["message", "commentaire", "comment", "demande", "question", "besoin", "precisions", "précisions"],
  postalCode: ["postalcode", "postal_code", "zip", "code_postal", "codepostal", "cp"],
  city: ["city", "ville", "commune"],
  segment: ["segment", "cible", "profil", "vous_etes", "vousetes", "vous_etes_", "type_structure", "type_etablissement", "type_établissement", "type_organisation", "secteur", "activite", "activité", "categorie", "catégorie"],
  kind: ["kind", "type_client", "client_type"],
  quantity: ["quantity", "quantite", "quantité", "nombre", "nb_piluliers", "nombre_de_piluliers", "nb_patients", "nombre_patients"],
};
const META_FIELDS = new Set(["website", "_hp", "_ts", "_redirect", "utm_source", "utm_medium", "utm_campaign", "page_url", "consent", "rgpd", "g-recaptcha-response"]);

function normKey(k: string) {
  return k
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function mapFormFields(data: Record<string, unknown>) {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    flat[normKey(k)] = Array.isArray(v) ? v.map(String).join(", ") : String(v).trim();
  }
  const pick = (field: string): string | null => {
    for (const alias of [field.toLowerCase(), ...(ALIASES[field] ?? [])]) {
      const v = flat[normKey(alias)];
      if (v) return v.slice(0, 2000);
    }
    return null;
  };
  const used = new Set<string>();
  for (const [field, aliases] of Object.entries(ALIASES)) for (const a of [field, ...aliases]) used.add(normKey(a));
  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!used.has(k) && !META_FIELDS.has(k) && v) extras[k] = v.slice(0, 1000);
  }
  let firstName = pick("firstName");
  let lastName = pick("lastName");
  const fullName = pick("fullName");
  if (!firstName && !lastName && fullName) ({ firstName, lastName } = splitFullName(fullName));
  return {
    firstName,
    lastName,
    email: pick("email"),
    phone: pick("phone"),
    company: pick("company"),
    jobTitle: pick("jobTitle"),
    message: pick("message"),
    postalCode: pick("postalCode"),
    city: pick("city"),
    segment: pick("segment"),
    kind: pick("kind"),
    quantity: pick("quantity"),
    extras,
  };
}

export type SubmissionMeta = {
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  referrer?: string | null;
};

export type SubmissionResult =
  | { ok: true; message: string; redirectUrl: string | null; submissionId: string }
  | { ok: false; error: string; status: number };

const DEFAULT_CONFIRMATION_SUBJECT = "Nous avons bien reçu votre demande — {{org.name}}";
const DEFAULT_CONFIRMATION_BODY = `{{contact.greeting}}

Merci pour votre message, nous avons bien reçu votre demande.

{{user.fullName}}, votre conseiller {{org.name}}, vous recontacte très rapidement (sous 24 h ouvrées).

Vous préférez choisir vous-même un créneau ? Réservez directement un échange ici : {{bookingLink}}

À très bientôt,`;

export async function processFormSubmission(formKey: string, raw: Record<string, unknown>, meta: SubmissionMeta = {}): Promise<SubmissionResult> {
  const form = await db.webForm.findUnique({ where: { key: formKey } });
  if (!form || !form.active) return { ok: false, error: "Formulaire introuvable ou désactivé.", status: 404 };

  const successMessage = form.successMessage ?? "Merci ! Votre demande a bien été envoyée. Nous vous recontactons très vite.";
  const honeypot = String(raw.website ?? raw._hp ?? "").trim();
  const ts = Number(raw._ts ?? 0);
  const tooFast = ts > 0 && Date.now() - ts < 2500;
  const utm = {
    utmSource: raw.utm_source ? String(raw.utm_source).slice(0, 200) : null,
    utmMedium: raw.utm_medium ? String(raw.utm_medium).slice(0, 200) : null,
    utmCampaign: raw.utm_campaign ? String(raw.utm_campaign).slice(0, 200) : null,
  };
  const cleanData = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => !["_hp", "_ts", "website", "g-recaptcha-response"].includes(k))
      .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 5000) : v]),
  ) as Prisma.InputJsonValue;

  if (honeypot || tooFast) {
    const spam = await db.formSubmission.create({
      data: { formId: form.id, data: cleanData, isSpam: true, ip: meta.ip, userAgent: meta.userAgent, pageUrl: meta.pageUrl, referrer: meta.referrer, ...utm },
    });
    // On répond « succès » pour ne pas renseigner les robots
    return { ok: true, message: successMessage, redirectUrl: form.redirectUrl, submissionId: spam.id };
  }

  const f = mapFormFields(raw);
  const email = normalizeEmail(f.email);
  const phone = normalizePhone(f.phone);
  if (!email && !phone) return { ok: false, error: "Merci d'indiquer au moins un email ou un téléphone.", status: 422 };
  if (f.email && !email) return { ok: false, error: "L'adresse email semble invalide.", status: 422 };

  // Type de contact : champ explicite, sinon présence d'une organisation, sinon réglage du formulaire
  let kind = form.contactKind;
  if (f.kind && /b2b|pro/i.test(f.kind)) kind = "B2B";
  else if (f.kind && /b2c|part/i.test(f.kind)) kind = "B2C";
  else if (f.company) kind = "B2B";

  // Cible : détectée (champ « cible », organisation, défaut du formulaire, message, fonction)
  const detected = detectSegment(
    { explicit: f.segment, company: f.company, message: f.message, jobTitle: f.jobTitle },
    await loadSegmentCandidates(),
    { kind, defaultId: form.segmentId },
  );
  const segmentId = detected?.id ?? null;
  if (detected) kind = detected.kind;

  const existing = await db.contact.findFirst({
    where: { OR: [...(email ? [{ emailNormalized: email }] : []), ...(phone ? [{ phoneNormalized: phone }] : [])] },
    select: { id: true, ownerId: true },
  });
  const ownerId =
    existing?.ownerId ??
    (await pickOwner({ strategy: form.assignmentStrategy, segmentId, fixedOwnerId: form.fixedOwnerId }));

  const extrasText = Object.entries(f.extras).map(([k, v]) => `${k} : ${v}`).join("\n");
  const { contact, created } = await upsertContact({
    kind,
    firstName: f.firstName,
    lastName: f.lastName,
    email: f.email,
    phone: f.phone,
    companyName: kind === "B2B" ? f.company : null,
    jobTitle: f.jobTitle,
    postalCode: f.postalCode,
    city: f.city,
    segmentId,
    ownerId,
    source: "WEBSITE_FORM",
    sourceDetail: form.name,
    tags: ["site web"],
  });
  const assignee = contact.ownerId ?? ownerId;

  let dealId: string | null = null;
  if (form.createDeal) {
    const open = await findOpenDealForContact(contact.id);
    if (open) dealId = open.id;
    else {
      const quantity = f.quantity ? Number(f.quantity.replace(/\D/g, "")) || null : null;
      const deal = await createDeal({
        title: `Demande site — ${f.company ? `${f.company} (${contactDisplayName(contact)})` : contactDisplayName(contact)}`,
        contactId: contact.id,
        ownerId: assignee,
        stage: "PROSPECT",
        source: "WEBSITE_FORM",
        kind,
        segmentId,
        quantity,
        notes: f.message,
        skipAutomation: true,
      });
      dealId = deal.id;
    }
  }

  await logActivity({
    type: "FORM_SUBMITTED",
    title: `Demande via « ${form.name} »`,
    body: [f.message, extrasText].filter(Boolean).join("\n\n") || null,
    contactId: contact.id,
    dealId,
    metadata: { formId: form.id, pageUrl: meta.pageUrl ?? null, ...utm },
  });

  // Tâche de rappel pour le commercial
  const followSettings = await getSettings("followups");
  const assigneeUser = await db.user.findUnique({ where: { id: assignee }, select: { timezone: true } });
  const dueAt = clampToBusinessWindow(new Date(Date.now() + form.callbackDelayMinutes * 60_000), {
    start: followSettings.windowStart,
    end: followSettings.windowEnd,
    skipWeekends: followSettings.skipWeekends,
    tz: assigneeUser?.timezone,
  });
  const callbackDetails = [f.message ? `Message : ${f.message}` : null, f.phone ? `Téléphone : ${f.phone}` : null, extrasText || null].filter(Boolean).join("\n");
  // Une seule tâche de rappel ouverte par contact : une nouvelle demande complète la tâche existante
  const openCallback = await db.task.findFirst({
    where: { contactId: contact.id, type: "CALLBACK", status: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true, description: true, dueAt: true },
  });
  if (openCallback) {
    const stamp = new Date().toLocaleString("fr-FR", { timeZone: assigneeUser?.timezone ?? "Europe/Paris", dateStyle: "short", timeStyle: "short" });
    await db.task.update({
      where: { id: openCallback.id },
      data: {
        priority: "HIGH",
        dueAt: openCallback.dueAt && openCallback.dueAt < dueAt ? openCallback.dueAt : dueAt,
        description: [openCallback.description, `— Nouvelle demande (${stamp}) —`, callbackDetails].filter(Boolean).join("\n").slice(0, 10_000),
      },
    });
    if (dealId) {
      const { refreshDealNextAction } = await import("./deals");
      await refreshDealNextAction(dealId);
    }
  } else {
    await createTask({
      title: `Rappeler ${contactDisplayName(contact)} — demande via le site`,
      description: callbackDetails,
      type: "CALLBACK",
      priority: "HIGH",
      source: "WEB_FORM",
      dueAt,
      hasTime: true,
      assigneeId: assignee,
      contactId: contact.id,
      dealId,
    });
  }

  // Relances automatiques adaptées aux leads entrants (sinon celles de l'étape « Prospect »)
  if (dealId) {
    const { autoEnroll, onDealStageChanged } = await import("./sequences/engine");
    const enrolled = await autoEnroll("WEB_FORM", { contactId: contact.id, dealId, ownerId: assignee, contactKind: kind, segmentId });
    if (!enrolled) {
      const deal = await db.deal.findUnique({ where: { id: dealId }, select: { stage: true } });
      if (deal?.stage === "PROSPECT") await onDealStageChanged(dealId, null, "PROSPECT");
    }
  }

  const submission = await db.formSubmission.create({
    data: {
      formId: form.id,
      data: cleanData,
      contactId: contact.id,
      dealId,
      ownerId: assignee,
      isExistingContact: !created,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
      pageUrl: meta.pageUrl?.slice(0, 500),
      referrer: meta.referrer?.slice(0, 500),
      ...utm,
    },
  });

  await notify({
    userId: assignee,
    type: "LEAD_ASSIGNED",
    title: `${created ? "Nouveau lead" : "Nouvelle demande"} : ${contactDisplayName(contact)}${f.company ? ` (${f.company})` : ""}`,
    body: `Formulaire « ${form.name} » — rappel prévu ${dueAt.toLocaleString("fr-FR", { timeZone: assigneeUser?.timezone ?? "Europe/Paris", dateStyle: "short", timeStyle: "short" })}`,
    link: `/contacts/${contact.id}`,
  });

  // Email de confirmation au prospect, envoyé depuis la boîte du commercial attribué
  if (form.sendConfirmation && contact.email) {
    try {
      await sendFormConfirmation(form.id, contact.id, dealId, assignee);
    } catch (error) {
      console.error("[forms] Confirmation non envoyée :", error instanceof Error ? error.message : error);
      await enqueueJob("form.confirmation", { formId: form.id, contactId: contact.id, dealId, ownerId: assignee }, { runAt: new Date(Date.now() + 5 * 60_000) });
    }
  }

  return { ok: true, message: successMessage, redirectUrl: form.redirectUrl, submissionId: submission.id };
}

export async function sendFormConfirmation(formId: string, contactId: string, dealId: string | null, ownerId: string) {
  const [form, contact, owner] = await Promise.all([
    db.webForm.findUniqueOrThrow({ where: { id: formId } }),
    db.contact.findUniqueOrThrow({ where: { id: contactId }, select: { email: true } }),
    db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { signature: true, firstName: true, lastName: true } }),
  ]);
  if (!contact.email) return;
  const vars = await buildTemplateVars({ contactId, dealId, userId: ownerId });
  const composed = composeEmail({
    subject: form.confirmationSubject || DEFAULT_CONFIRMATION_SUBJECT,
    body: form.confirmationBody || DEFAULT_CONFIRMATION_BODY,
    vars,
    signature: owner.signature ?? `${owner.firstName} ${owner.lastName}`,
  });
  const { sendEmail } = await import("./email/send");
  await sendEmail({
    senderId: ownerId,
    to: [contact.email],
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    contactId,
    dealId,
    isAutomated: true,
  });
}

export { DEFAULT_FORM_FIELDS, parseFormFields, type FormFieldDef } from "./forms-fields";
