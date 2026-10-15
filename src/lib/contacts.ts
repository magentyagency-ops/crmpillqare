import type { ContactKind, ContactSource, ContactStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, isUniqueViolation } from "./db";
import {
  capitalizeName,
  emailDomain,
  isFreeMailDomain,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "./normalize";

export type ContactUpsertInput = {
  kind?: ContactKind;
  status?: ContactStatus;
  civility?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  segmentId?: string | null;
  ownerId?: string | null;
  source?: ContactSource;
  sourceDetail?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
  tags?: string[];
  shopifyCustomerId?: string | null;
};

export type UpsertResult = {
  contact: Prisma.ContactGetPayload<object>;
  created: boolean;
};

/** Trouve un contact existant par identifiant Shopify, email ou téléphone (sans créer de doublon). */
export async function findExistingContact(input: {
  email?: string | null;
  phone?: string | null;
  shopifyCustomerId?: string | null;
}) {
  if (input.shopifyCustomerId) {
    const byShopify = await db.contact.findUnique({ where: { shopifyCustomerId: input.shopifyCustomerId } });
    if (byShopify) return byShopify;
  }
  const email = normalizeEmail(input.email);
  if (email) {
    const byEmail = await db.contact.findUnique({ where: { emailNormalized: email } });
    if (byEmail) return byEmail;
  }
  const phone = normalizePhone(input.phone);
  if (phone) {
    const byPhone = await db.contact.findFirst({
      where: {
        phoneNormalized: phone,
        archivedAt: null,
        // Un même numéro avec un email différent = personne différente (ex. conjoints)
        ...(email ? { OR: [{ emailNormalized: null }, { emailNormalized: email }] } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    if (byPhone) return byPhone;
  }
  return null;
}

/** Trouve ou crée l'organisation (B2B) à partir du nom ou du domaine email. */
export async function findOrCreateCompany(input: {
  name?: string | null;
  website?: string | null;
  email?: string | null;
  segmentId?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  city?: string | null;
  postalCode?: string | null;
  address?: string | null;
}) {
  const name = input.name?.trim().replace(/\s+/g, " ");
  const domain = normalizeDomain(input.website) ?? (() => {
    const d = emailDomain(input.email);
    return d && !isFreeMailDomain(d) ? d : null;
  })();

  if (name) {
    const byName = await db.company.findFirst({ where: { name: { equals: name, mode: "insensitive" }, archivedAt: null } });
    if (byName) {
      if (!byName.domain && domain) await db.company.update({ where: { id: byName.id }, data: { domain } });
      return byName;
    }
  } else if (domain) {
    // Sans nom d'organisation : rattachement par domaine email. Avec un nom, le domaine ne suffit pas
    // (plusieurs établissements d'un même groupe partagent souvent le même domaine).
    return db.company.findFirst({ where: { domain, archivedAt: null }, orderBy: { createdAt: "asc" } });
  }
  if (!name) return null;
  return db.company.create({
    data: {
      name,
      kind: "B2B",
      domain,
      website: input.website ?? (domain ? `https://${domain}` : null),
      segmentId: input.segmentId ?? null,
      ownerId: input.ownerId ?? null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      postalCode: input.postalCode ?? null,
      address: input.address ?? null,
    },
  });
}

/**
 * Crée ou met à jour un contact en garantissant l'absence de doublon (email / téléphone /
 * identifiant Shopify). Les champs existants ne sont pas écrasés, seuls les champs vides sont complétés.
 */
export async function upsertContact(input: ContactUpsertInput): Promise<UpsertResult> {
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);
  const firstName = capitalizeName(input.firstName);
  const lastName = capitalizeName(input.lastName);

  let companyId = input.companyId ?? null;
  if (!companyId && input.companyName) {
    const company = await findOrCreateCompany({
      name: input.companyName,
      website: input.companyWebsite,
      email: input.email,
      segmentId: input.segmentId,
      ownerId: input.ownerId,
      city: input.city,
      postalCode: input.postalCode,
    });
    companyId = company?.id ?? null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findExistingContact({ email: emailNormalized, phone: phoneNormalized, shopifyCustomerId: input.shopifyCustomerId });
    if (existing) {
      const data: Prisma.ContactUpdateInput = {};
      const fill = <K extends keyof typeof existing>(key: K, value: unknown) => {
        if ((existing[key] === null || existing[key] === "" || existing[key] === undefined) && value !== null && value !== undefined && value !== "") {
          (data as Record<string, unknown>)[key as string] = value;
        }
      };
      fill("firstName", firstName);
      fill("lastName", lastName);
      fill("civility", input.civility);
      fill("jobTitle", input.jobTitle);
      fill("address", input.address);
      fill("postalCode", input.postalCode);
      fill("city", input.city);
      if (!existing.email && input.email && emailNormalized) {
        data.email = input.email.trim();
        data.emailNormalized = emailNormalized;
      }
      if (!existing.phone && input.phone) {
        data.phone = input.phone.trim();
        data.phoneNormalized = phoneNormalized;
      }
      if (!existing.companyId && companyId) data.company = { connect: { id: companyId } };
      if (!existing.segmentId && input.segmentId) data.segment = { connect: { id: input.segmentId } };
      if (!existing.ownerId && input.ownerId) data.owner = { connect: { id: input.ownerId } };
      if (!existing.shopifyCustomerId && input.shopifyCustomerId) {
        const taken = await db.contact.findUnique({ where: { shopifyCustomerId: input.shopifyCustomerId }, select: { id: true } });
        if (!taken) data.shopifyCustomerId = input.shopifyCustomerId;
      }
      if (input.status === "CUSTOMER" && existing.status !== "CUSTOMER") data.status = "CUSTOMER";
      if (input.tags?.length) {
        const merged = Array.from(new Set([...existing.tags, ...input.tags]));
        if (merged.length !== existing.tags.length) data.tags = merged;
      }
      if (input.notes) {
        data.notes = existing.notes ? `${existing.notes}\n\n${input.notes}` : input.notes;
      }
      if (existing.archivedAt) data.archivedAt = null;
      const contact = Object.keys(data).length ? await db.contact.update({ where: { id: existing.id }, data }) : existing;
      return { contact, created: false };
    }

    try {
      const contact = await db.contact.create({
        data: {
          kind: input.kind ?? (companyId ? "B2B" : "B2C"),
          status: input.status ?? "PROSPECT",
          civility: input.civility ?? null,
          firstName,
          lastName,
          email: input.email?.trim() || null,
          emailNormalized,
          phone: input.phone?.trim() || null,
          phoneNormalized,
          jobTitle: input.jobTitle ?? null,
          companyId,
          segmentId: input.segmentId ?? null,
          ownerId: input.ownerId ?? null,
          source: input.source ?? "MANUAL",
          sourceDetail: input.sourceDetail ?? null,
          address: input.address ?? null,
          postalCode: input.postalCode ?? null,
          city: input.city ?? null,
          country: input.country ?? "France",
          notes: input.notes ?? null,
          tags: input.tags ?? [],
          shopifyCustomerId: input.shopifyCustomerId ?? null,
        },
      });
      if (emailNormalized) await attachOrphanEmails(contact.id, emailNormalized);
      return { contact, created: true };
    } catch (error) {
      // Création concurrente (ex. deux webhooks Shopify simultanés) : on relit et on fusionne
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Impossible de créer le contact (conflit répété).");
}

/** Doublons potentiels d'un contact (même téléphone, ou même nom dans la même organisation). */
export async function findPotentialDuplicates(contactId: string) {
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return [];
  const or: Prisma.ContactWhereInput[] = [];
  if (c.phoneNormalized) or.push({ phoneNormalized: c.phoneNormalized });
  if (c.firstName && c.lastName) {
    or.push({
      firstName: { equals: c.firstName, mode: "insensitive" },
      lastName: { equals: c.lastName, mode: "insensitive" },
      ...(c.companyId ? { companyId: c.companyId } : {}),
    });
  }
  if (or.length === 0) return [];
  return db.contact.findMany({
    where: { id: { not: c.id }, archivedAt: null, OR: or },
    include: { company: { select: { name: true } } },
    take: 10,
  });
}

/**
 * Fusionne `duplicateId` dans `primaryId` : tout l'historique est rattaché au contact principal,
 * les champs vides du principal sont complétés, puis le doublon est supprimé.
 */
export async function mergeContacts(primaryId: string, duplicateId: string) {
  if (primaryId === duplicateId) throw new Error("Impossible de fusionner un contact avec lui-même.");
  const [primary, dup] = await Promise.all([
    db.contact.findUniqueOrThrow({ where: { id: primaryId } }),
    db.contact.findUniqueOrThrow({ where: { id: duplicateId } }),
  ]);

  await db.$transaction(async (tx) => {
    const where = { contactId: dup.id };
    const data = { contactId: primary.id };
    await tx.deal.updateMany({ where, data });
    await tx.activity.updateMany({ where, data });
    await tx.task.updateMany({ where, data });
    await tx.meeting.updateMany({ where, data });
    await tx.emailMessage.updateMany({ where, data });
    await tx.sequenceEnrollment.updateMany({ where, data });
    await tx.quote.updateMany({ where, data });
    await tx.trial.updateMany({ where, data });
    await tx.order.updateMany({ where, data });
    await tx.aiSession.updateMany({ where, data });
    await tx.formSubmission.updateMany({ where, data });

    const patch: Prisma.ContactUpdateInput = {};
    const keys = ["firstName", "lastName", "civility", "phone", "phoneNormalized", "jobTitle", "address", "postalCode", "city"] as const;
    for (const k of keys) if (!primary[k] && dup[k]) (patch as Record<string, unknown>)[k] = dup[k];
    if (!primary.companyId && dup.companyId) patch.company = { connect: { id: dup.companyId } };
    if (!primary.segmentId && dup.segmentId) patch.segment = { connect: { id: dup.segmentId } };
    if (!primary.ownerId && dup.ownerId) patch.owner = { connect: { id: dup.ownerId } };
    if (dup.status === "CUSTOMER") patch.status = "CUSTOMER";
    patch.tags = Array.from(new Set([...primary.tags, ...dup.tags]));
    if (dup.notes) patch.notes = primary.notes ? `${primary.notes}\n\n${dup.notes}` : dup.notes;
    const emailToMove = !primary.emailNormalized && dup.emailNormalized ? { email: dup.email, emailNormalized: dup.emailNormalized } : null;
    const shopifyToMove = !primary.shopifyCustomerId && dup.shopifyCustomerId ? dup.shopifyCustomerId : null;

    await tx.contact.delete({ where: { id: dup.id } });
    await tx.contact.update({
      where: { id: primary.id },
      data: {
        ...patch,
        ...(emailToMove ?? {}),
        ...(shopifyToMove ? { shopifyCustomerId: shopifyToMove } : {}),
      },
    });
    await tx.activity.create({
      data: {
        type: "SYSTEM",
        title: "Fusion de doublon",
        body: `Le contact ${[dup.firstName, dup.lastName].filter(Boolean).join(" ") || dup.email || dup.id} a été fusionné dans cette fiche.`,
        contactId: primary.id,
        companyId: primary.companyId,
      },
    });
  });
}

/** Recherche un contact connu par adresse email (pour rattacher les emails synchronisés). */
export async function findContactByEmail(email: string | null | undefined) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return db.contact.findUnique({ where: { emailNormalized: e } });
}

/** Rattache au contact les emails déjà synchronisés avec son adresse (reçus avant que la fiche existe). */
export async function attachOrphanEmails(contactId: string, emailNormalized: string) {
  await db.emailMessage.updateMany({
    where: { contactId: null, OR: [{ fromEmail: { equals: emailNormalized, mode: "insensitive" } }, { toEmails: { has: emailNormalized } }] },
    data: { contactId },
  });
}
