"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertCanEdit, assertRole, assertUser, ownerScope, canView } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { findExistingContact, findOrCreateCompany, mergeContacts, upsertContact } from "@/lib/contacts";
import { createDeal } from "@/lib/deals";
import { logActivity } from "@/lib/activity";
import { createTask, NEXT_ACTION_TO_TASK_TYPE } from "@/lib/tasks";
import { contactDisplayName, NEXT_ACTION_LABELS } from "@/lib/labels";
import { normalizeEmail, normalizePhone, capitalizeName } from "@/lib/normalize";
import { parseDateTimeLocal } from "@/lib/dates";
import { optionalEmail, optionalString, stringArray } from "@/lib/validation";
import { mapFormFields } from "@/lib/forms";
import { aiNormalizeSheet } from "@/lib/import-ai";
import { detectSegment, loadSegmentCandidates } from "@/lib/segments";
import { contactSearchWhere } from "@/lib/search";

const contactSchema = z.object({
  kind: z.enum(["B2B", "B2C"]),
  status: z.enum(["PROSPECT", "CUSTOMER", "PARTNER", "INACTIVE"]).default("PROSPECT"),
  civility: optionalString,
  firstName: optionalString,
  lastName: optionalString,
  email: optionalEmail,
  phone: optionalString,
  jobTitle: optionalString,
  companyId: optionalString,
  companyName: optionalString,
  segmentId: optionalString,
  ownerId: optionalString,
  source: z
    .enum(["MANUAL", "WEBSITE_FORM", "BOOKING", "SHOPIFY", "EMAIL", "IMPORT", "REFERRAL", "EVENT", "PHONE", "LINKEDIN", "OTHER"])
    .default("MANUAL"),
  sourceDetail: optionalString,
  address: optionalString,
  postalCode: optionalString,
  city: optionalString,
  notes: optionalString,
  tags: stringArray,
});

const nextActionSchema = z
  .object({
    type: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "DEMO", "TASK"]),
    label: optionalString,
    dueAt: z.string().min(1, "Date de la prochaine action obligatoire"),
  })
  .nullable()
  .optional();

export type ContactFormInput = z.input<typeof contactSchema> & {
  createDeal?: boolean;
  dealTitle?: string | null;
  dealAmount?: string | number | null;
  nextAction?: z.input<typeof nextActionSchema>;
};

export async function createContactAction(input: ContactFormInput): Promise<ActionResult<{ id: string; dealId: string | null }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = contactSchema.parse(input);
    if (!data.firstName && !data.lastName && !data.email && !data.phone) throw new UserError("Renseignez au moins un nom, un email ou un téléphone.");
    const existing = await findExistingContact({ email: data.email, phone: data.phone });
    if (existing) {
      throw new UserError(`Ce contact existe déjà : ${contactDisplayName(existing)} (même email ou téléphone). Ouvrez sa fiche plutôt que de créer un doublon.`);
    }
    // Tout est validé avant d'écrire : pas de contact créé à moitié si le dossier est incomplet
    const next = input.createDeal ? nextActionSchema.parse(input.nextAction ?? null) : null;
    const due = next ? parseDateTimeLocal(next.dueAt, user.timezone) : null;
    if (input.createDeal && (!next || !due)) throw new UserError("Indiquez la prochaine action du dossier et son échéance.");

    // Cible non choisie : organisation existante, sinon détection (nom de l'organisation, fonction)
    let segmentId = data.segmentId ?? null;
    if (!segmentId) {
      const existingCompany = data.kind === "B2B" && data.companyId ? await db.company.findUnique({ where: { id: data.companyId }, select: { name: true, segmentId: true } }) : null;
      segmentId =
        existingCompany?.segmentId ??
        detectSegment({ company: data.kind === "B2B" ? (existingCompany?.name ?? data.companyName) : null, jobTitle: data.jobTitle }, await loadSegmentCandidates(), { kind: data.kind })?.id ??
        null;
    }

    const ownerId = data.ownerId ?? user.id;
    const { contact } = await upsertContact({ ...data, segmentId, companyName: data.kind === "B2B" ? data.companyName : null, companyId: data.kind === "B2B" ? data.companyId : null, ownerId });
    await logActivity({ type: "SYSTEM", title: "Contact créé", contactId: contact.id, userId: user.id });

    let dealId: string | null = null;
    if (input.createDeal && next && due) {
      const company = contact.companyId ? await db.company.findUnique({ where: { id: contact.companyId }, select: { name: true } }) : null;
      const deal = await createDeal({
        title: input.dealTitle?.trim() || (company ? `${company.name} — ${contactDisplayName(contact)}` : contactDisplayName(contact)),
        contactId: contact.id,
        ownerId,
        createdById: user.id,
        amount: input.dealAmount ? Number(String(input.dealAmount).replace(",", ".")) || null : null,
        source: data.source,
        nextAction: { type: next.type, label: next.label, dueAt: due, hasTime: next.dueAt.includes("T") },
      });
      dealId = deal.id;
    }
    return { id: contact.id, dealId };
  }, "Contact créé");
}

export async function updateContactAction(id: string, input: ContactFormInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const current = await db.contact.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, current.ownerId);
    const data = contactSchema.parse(input);
    const emailNormalized = normalizeEmail(data.email);
    if (emailNormalized && emailNormalized !== current.emailNormalized) {
      const other = await db.contact.findUnique({ where: { emailNormalized } });
      if (other && other.id !== id) throw new UserError(`L'email est déjà utilisé par ${contactDisplayName(other)}. Fusionnez les deux fiches si c'est la même personne.`);
    }
    let companyId = data.kind === "B2B" ? data.companyId : null;
    if (data.kind === "B2B" && !companyId && data.companyName) {
      companyId = (await findOrCreateCompany({ name: data.companyName, email: data.email, segmentId: data.segmentId, ownerId: data.ownerId }))?.id ?? null;
    }
    await db.contact.update({
      where: { id },
      data: {
        kind: data.kind,
        status: data.status,
        civility: data.civility,
        firstName: capitalizeName(data.firstName),
        lastName: capitalizeName(data.lastName),
        email: data.email,
        emailNormalized,
        phone: data.phone,
        phoneNormalized: normalizePhone(data.phone),
        jobTitle: data.jobTitle,
        companyId,
        segmentId: data.segmentId,
        ownerId: data.ownerId ?? current.ownerId,
        source: data.source,
        sourceDetail: data.sourceDetail,
        address: data.address,
        postalCode: data.postalCode,
        city: data.city,
        notes: data.notes,
        tags: data.tags,
      },
    });
    if (data.ownerId && data.ownerId !== current.ownerId) {
      await logActivity({ type: "OWNER_CHANGED", title: "Changement de commercial responsable", contactId: id, userId: user.id });
    }
  }, "Contact mis à jour");
}

export async function archiveContactAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const c = await db.contact.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, c.ownerId);
    await db.contact.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    if (archived) {
      const { stopContactEnrollments } = await import("@/lib/sequences/engine");
      await stopContactEnrollments(id, "MANUAL");
    }
  }, archived ? "Contact archivé" : "Contact restauré");
}

/** Suppression définitive (droit à l'effacement RGPD) — administrateurs uniquement. */
export async function deleteContactAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole("ADMIN");
    // Devis émis et commandes sont des pièces commerciales : elles doivent être conservées
    const [quotes, orders] = await Promise.all([
      db.quote.count({ where: { contactId: id, status: { not: "DRAFT" } } }),
      db.order.count({ where: { contactId: id } }),
    ]);
    if (quotes || orders) {
      throw new UserError(`Ce contact a ${[quotes ? `${quotes} devis émis` : null, orders ? `${orders} commande(s)` : null].filter(Boolean).join(" et ")} : archivez-le plutôt (les pièces commerciales doivent être conservées).`);
    }
    await db.emailMessage.deleteMany({ where: { contactId: id } });
    await db.contact.delete({ where: { id } });
  }, "Contact supprimé définitivement");
}

export async function mergeContactsAction(primaryId: string, duplicateId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const dup = await db.contact.findUniqueOrThrow({ where: { id: duplicateId } });
    await assertCanEdit(user, dup.ownerId);
    await mergeContacts(primaryId, duplicateId);
  }, "Fiches fusionnées");
}

export async function setDoNotContactAction(id: string, value: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const contact = await db.contact.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
    await assertCanEdit(user, contact.ownerId);
    await db.contact.update({ where: { id }, data: { doNotContact: value, unsubscribedAt: value ? new Date() : null } });
    if (value) {
      const { stopContactEnrollments } = await import("@/lib/sequences/engine");
      await stopContactEnrollments(id, "UNSUBSCRIBED");
    }
    await logActivity({ type: "SYSTEM", title: value ? "Ne plus contacter (opposition)" : "Contact réautorisé", contactId: id, userId: user.id });
  }, value ? "Le contact ne recevra plus d'emails automatiques" : "Contact réautorisé");
}

export async function addNoteAction(input: { contactId?: string | null; dealId?: string | null; companyId?: string | null; body: string }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const body = input.body.trim();
    if (!body) throw new UserError("La note est vide.");
    let contactId = input.contactId ?? null;
    const deal = input.dealId ? await db.deal.findUnique({ where: { id: input.dealId }, select: { contactId: true, ownerId: true } }) : null;
    if (!contactId && deal) contactId = deal.contactId;
    const contact = contactId ? await db.contact.findUnique({ where: { id: contactId }, select: { ownerId: true } }) : null;
    if (!(await canView(user, [contact?.ownerId, deal?.ownerId]))) throw new UserError("Vous n'avez pas accès à ce contact.");
    await logActivity({ type: "NOTE", title: "Note", body, contactId, dealId: input.dealId ?? null, companyId: input.companyId ?? null, userId: user.id });
  }, "Note ajoutée");
}

const callSchema = z.object({
  contactId: z.string().min(1),
  dealId: optionalString,
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  outcome: z.enum(["REACHED", "NO_ANSWER", "VOICEMAIL", "BUSY", "WRONG_NUMBER", "CALLBACK_REQUESTED"]),
  durationMin: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined || v === "" ? null : Math.max(0, Math.round(Number(v) * 60)))),
  notes: optionalString,
  taskId: optionalString,
  nextAction: nextActionSchema,
});

/** Journal d'appel (+ clôture de la tâche liée, prochaine action, passage « Contacté »). */
export async function logCallAction(input: z.input<typeof callSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const data = callSchema.parse(input);
    const contact = await db.contact.findUniqueOrThrow({ where: { id: data.contactId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } });
    let dealId = data.dealId;
    if (!dealId) dealId = (await db.deal.findFirst({ where: { contactId: contact.id, stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, select: { id: true } }))?.id ?? null;
    const { CALL_OUTCOME_LABELS } = await import("@/lib/labels");
    await logActivity({
      type: "CALL",
      title: `Appel ${data.direction === "OUTBOUND" ? "sortant" : "entrant"} — ${CALL_OUTCOME_LABELS[data.outcome]}`,
      body: data.notes,
      contactId: contact.id,
      dealId,
      userId: user.id,
      callDirection: data.direction,
      callOutcome: data.outcome,
      callDurationSec: data.durationMin,
    });
    if (data.outcome === "REACHED") {
      await db.contact.update({ where: { id: contact.id }, data: { lastContactedAt: new Date() } });
      if (dealId) {
        const { advanceDealTo } = await import("@/lib/deals");
        await advanceDealTo(dealId, "CONTACTED", { userId: user.id });
      }
    }
    const { completeTask } = await import("@/lib/tasks");
    const note = `${CALL_OUTCOME_LABELS[data.outcome]}${data.notes ? ` — ${data.notes}` : ""}`;
    if (data.taskId) await completeTask(data.taskId, user.id, { note });
    // L'appel vient d'avoir lieu : la demande de rappel et les appels prévus jusqu'à aujourd'hui sont faits
    // (un appel planifié plus tard, ex. « rappeler dans une semaine », reste ouvert)
    const { endOfDayTz } = await import("@/lib/dates");
    const pendingCalls = await db.task.findMany({
      where: {
        contactId: contact.id,
        status: "OPEN",
        id: data.taskId ? { not: data.taskId } : undefined,
        OR: [{ type: "CALLBACK" }, { type: "CALL", OR: [{ dueAt: null }, { dueAt: { lte: endOfDayTz(new Date(), user.timezone) } }] }],
      },
      select: { id: true },
    });
    for (const t of pendingCalls) await completeTask(t.id, user.id, { note });
    if (data.nextAction) {
      const due = parseDateTimeLocal(data.nextAction.dueAt, user.timezone);
      const type = NEXT_ACTION_TO_TASK_TYPE[data.nextAction.type];
      // Même action déjà prévue au même moment (double saisie) : pas de doublon
      const duplicate = due ? await db.task.findFirst({ where: { contactId: contact.id, status: "OPEN", type, dueAt: due }, select: { id: true } }) : null;
      if (due && !duplicate) {
        await createTask({
          title: data.nextAction.label || `${NEXT_ACTION_LABELS[data.nextAction.type]} — ${contactDisplayName(contact)}`,
          type,
          dueAt: due,
          hasTime: data.nextAction.dueAt.includes("T"),
          assigneeId: user.id,
          createdById: user.id,
          contactId: contact.id,
          dealId,
        });
      }
    }
  }, "Appel enregistré");
}

export type PickerOption = { id: string; label: string; sublabel?: string | null; extra?: Record<string, string | null> };

export async function searchContactsAction(q: string): Promise<PickerOption[]> {
  const user = await assertUser();
  const term = q.trim();
  const scope = await ownerScope(user);
  const where: Prisma.ContactWhereInput = {
    archivedAt: null,
    ...scope,
    ...(term ? contactSearchWhere(term) : {}),
  };
  const rows = await db.contact.findMany({
    where,
    take: 12,
    orderBy: { updatedAt: "desc" },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyId: true, company: { select: { name: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    label: contactDisplayName(c),
    sublabel: [c.company?.name, c.email].filter(Boolean).join(" · ") || null,
    extra: { companyId: c.companyId, email: c.email },
  }));
}

export async function searchCompaniesAction(q: string): Promise<PickerOption[]> {
  await assertUser();
  const rows = await db.company.findMany({
    where: { archivedAt: null, ...(q.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}) },
    take: 12,
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, segment: { select: { name: true } } },
  });
  return rows.map((c) => ({ id: c.id, label: c.name, sublabel: [c.segment?.name, c.city].filter(Boolean).join(" · ") || null }));
}

// ───────────── Import CSV ─────────────

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Import de contacts depuis un CSV ou un classeur Excel (feuilles lues et rangées par l'IA, sans doublon). */
export async function importContactsAction(
  input: string | { sheets: { name: string; rows: string[][] }[] },
  opts: { segmentId?: string | null; ownerId?: string | null; kind?: "B2B" | "B2C" | null; createDeals?: boolean; startSequences?: boolean },
): Promise<ActionResult<{ created: number; updated: number; skipped: number }>> {
  return runAction(async () => {
    const user = await assertUser();
    const sheets = (typeof input === "string" ? [{ name: "CSV", rows: parseCsv(input.replace(/^﻿/, "")) }] : input.sheets)
      .map((sh) => ({ ...sh, rows: sh.rows.map((r) => r.map((c) => String(c ?? ""))).filter((r) => r.some((c) => c.trim())) }))
      .filter((sh) => sh.rows.length >= 2);
    if (!sheets.length) throw new UserError("Le fichier doit contenir une ligne d'en-têtes et au moins une ligne de données.");
    if (sheets.reduce((n, sh) => n + sh.rows.length, 0) > 5000 + sheets.length) throw new UserError("5 000 lignes maximum par import.");
    const records = (await Promise.all(sheets.map((sh) => aiNormalizeSheet(sh.name, sh.rows)))).flat();
    const candidates = await loadSegmentCandidates();
    // Premiers appels des dossiers importés : 15 par jour ouvré à partir du prochain jour ouvré, 9 h 30
    const { addBusinessDaysTz, zonedDateTime, dayKey } = await import("@/lib/dates");
    const CALLS_PER_DAY = 15;
    let dealsCreated = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const record of records) {
      const f = mapFormFields(record);
      if (!f.email && !f.phone && !f.lastName && !f.firstName) {
        skipped++;
        continue;
      }
      let kind: "B2B" | "B2C" = opts.kind ?? (f.company ? "B2B" : "B2C");
      // Cible choisie pour tout l'import, sinon détectée ligne par ligne (colonne « cible », organisation, fonction)
      const segment = opts.segmentId
        ? (candidates.find((c) => c.id === opts.segmentId) ?? null)
        : detectSegment({ explicit: f.segment, company: f.company, jobTitle: f.jobTitle }, candidates, { kind });
      const segmentId = opts.segmentId ?? segment?.id ?? null;
      if (!opts.kind && segment) kind = segment.kind;
      const ownerId = opts.ownerId ?? user.id;
      const { contact, created: isNew } = await upsertContact({
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
        source: "IMPORT",
        notes: [f.message, ...Object.entries(f.extras).map(([k, v]) => `${k} : ${v}`)].filter(Boolean).join("\n") || null,
        tags: ["import"],
      });
      if (isNew) created++;
      else updated++;
      if (isNew && opts.createDeals) {
        const day = addBusinessDaysTz(new Date(), 1 + Math.floor(dealsCreated / CALLS_PER_DAY), user.timezone);
        const deal = await createDeal({
          title: f.company ? `${f.company} — ${contactDisplayName(contact)}` : contactDisplayName(contact),
          contactId: contact.id,
          ownerId,
          createdById: user.id,
          source: "IMPORT",
          skipAutomation: true,
          nextAction: { type: "CALL", label: `Premier contact : ${contactDisplayName(contact)}`, dueAt: zonedDateTime(dayKey(day, user.timezone), "09:30", user.timezone), hasTime: true },
        });
        dealsCreated++;
        if (opts.startSequences) {
          const { onDealStageChanged } = await import("@/lib/sequences/engine");
          await onDealStageChanged(deal.id, null, "PROSPECT");
        }
      }
    }
    return { created, updated, skipped };
  });
}
