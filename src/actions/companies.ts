"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertCanEdit, assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { normalizeDomain } from "@/lib/normalize";
import { optionalEmail, optionalInt, optionalString } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

const companySchema = z.object({
  name: z.string().trim().min(1, "Nom obligatoire"),
  segmentId: optionalString,
  ownerId: optionalString,
  siret: optionalString,
  website: optionalString,
  email: optionalEmail,
  phone: optionalString,
  address: optionalString,
  postalCode: optionalString,
  city: optionalString,
  capacity: optionalInt,
  employees: optionalInt,
  notes: optionalString,
});

export async function createCompanyAction(input: z.input<typeof companySchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const data = companySchema.parse(input);
    const dup = await db.company.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, archivedAt: null } });
    if (dup) throw new UserError(`L'organisation « ${dup.name} » existe déjà.`);
    const company = await db.company.create({
      data: { ...data, kind: "B2B", ownerId: data.ownerId ?? user.id, domain: normalizeDomain(data.website) },
    });
    return { id: company.id };
  }, "Organisation créée");
}

export async function updateCompanyAction(id: string, input: z.input<typeof companySchema>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const company = await db.company.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, company.ownerId);
    const data = companySchema.parse(input);
    await db.company.update({ where: { id }, data: { ...data, domain: normalizeDomain(data.website) ?? company.domain } });
    // Les contacts et dossiers de l'organisation héritent de la cible
    if (data.segmentId && data.segmentId !== company.segmentId) {
      await db.contact.updateMany({ where: { companyId: id, segmentId: null }, data: { segmentId: data.segmentId } });
      await db.deal.updateMany({ where: { companyId: id, segmentId: null }, data: { segmentId: data.segmentId } });
    }
    await logActivity({ type: "SYSTEM", title: "Organisation mise à jour", companyId: id, userId: user.id });
  }, "Organisation mise à jour");
}

export async function archiveCompanyAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const company = await db.company.findUniqueOrThrow({ where: { id } });
    await assertCanEdit(user, company.ownerId);
    await db.company.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  }, archived ? "Organisation archivée" : "Organisation restaurée");
}
