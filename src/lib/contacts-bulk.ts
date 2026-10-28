import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { isAdmin, ownerScope } from "@/lib/auth/guards";
import { contactsWhere, type ContactSearch } from "@/lib/contacts-query";

/** Contacts visés par une action groupée : une liste d'identifiants, ou tous ceux qui correspondent aux filtres de la liste. */
export type BulkTarget = { ids: string[] } | { filter: ContactSearch };

export type BulkOp =
  | { type: "delete" }
  | { type: "archive" }
  | { type: "restore" }
  | { type: "owner"; ownerId: string }
  | { type: "segment"; segmentId: string | null }
  | { type: "status"; status: "PROSPECT" | "CUSTOMER" | "PARTNER" | "INACTIVE" }
  | { type: "addTag"; tag: string }
  | { type: "doNotContact"; value: boolean };

export const BULK_LABELS: Record<BulkOp["type"], string> = {
  delete: "Supprimer définitivement",
  archive: "Archiver",
  restore: "Restaurer",
  owner: "Attribuer à un commercial",
  segment: "Changer la cible",
  status: "Changer le statut",
  addTag: "Ajouter une étiquette",
  doNotContact: "Marquer « ne pas contacter »",
};

/** Filtre Prisma limité aux contacts que l'utilisateur peut modifier. */
export async function bulkWhere(user: SessionUser, target: BulkTarget): Promise<Prisma.ContactWhereInput> {
  const scope = (await ownerScope(user)) as Record<string, string>;
  if ("ids" in target) return { ...scope, id: { in: target.ids.slice(0, 10_000) } };
  return contactsWhere(target.filter, user.id, scope);
}

export async function countBulk(user: SessionUser, target: BulkTarget) {
  return db.contact.count({ where: await bulkWhere(user, target) });
}

/** Applique l'action à tous les contacts visés ; renvoie le nombre traité et le nombre ignoré (avec la raison). */
export async function runBulk(user: SessionUser, target: BulkTarget, op: BulkOp): Promise<{ done: number; skipped: number; note: string | null }> {
  const where = await bulkWhere(user, target);
  const ids = (await db.contact.findMany({ where, select: { id: true } })).map((c) => c.id);
  if (!ids.length) return { done: 0, skipped: 0, note: null };
  const { stopContactEnrollments } = await import("@/lib/sequences/engine");
  const stopAll = async (reason: "MANUAL" | "UNSUBSCRIBED") => {
    for (const id of ids) await stopContactEnrollments(id, reason);
  };
  const byIds = { id: { in: ids } };

  switch (op.type) {
    case "delete": {
      if (!isAdmin(user)) throw new Error("Suppression définitive réservée aux administrateurs : archivez plutôt.");
      // Devis émis et commandes sont des pièces commerciales : ces contacts sont archivés au lieu d'être supprimés
      const [quotes, orders] = await Promise.all([
        db.quote.findMany({ where: { contactId: { in: ids }, status: { not: "DRAFT" } }, select: { contactId: true }, distinct: ["contactId"] }),
        db.order.findMany({ where: { contactId: { in: ids } }, select: { contactId: true }, distinct: ["contactId"] }),
      ]);
      const keep = new Set([...quotes, ...orders].map((r) => r.contactId).filter(Boolean) as string[]);
      const del = ids.filter((id) => !keep.has(id));
      for (let i = 0; i < del.length; i += 500) {
        const chunk = del.slice(i, i + 500);
        await db.emailMessage.deleteMany({ where: { contactId: { in: chunk } } });
        await db.contact.deleteMany({ where: { id: { in: chunk } } });
      }
      if (keep.size) await db.contact.updateMany({ where: { id: { in: [...keep] } }, data: { archivedAt: new Date() } });
      return { done: del.length, skipped: keep.size, note: keep.size ? `${keep.size} contact(s) avec devis ou commandes archivé(s) au lieu d'être supprimé(s)` : null };
    }
    case "archive":
      await db.contact.updateMany({ where: byIds, data: { archivedAt: new Date() } });
      await stopAll("MANUAL");
      break;
    case "restore":
      await db.contact.updateMany({ where: byIds, data: { archivedAt: null } });
      break;
    case "owner":
      await db.contact.updateMany({ where: byIds, data: { ownerId: op.ownerId } });
      break;
    case "segment":
      await db.contact.updateMany({ where: byIds, data: { segmentId: op.segmentId } });
      break;
    case "status":
      await db.contact.updateMany({ where: byIds, data: { status: op.status } });
      break;
    case "addTag": {
      const tag = op.tag.trim();
      if (!tag) throw new Error("Étiquette vide.");
      await db.contact.updateMany({ where: { ...byIds, NOT: { tags: { has: tag } } }, data: { tags: { push: tag } } });
      break;
    }
    case "doNotContact":
      await db.contact.updateMany({ where: byIds, data: { doNotContact: op.value, unsubscribedAt: op.value ? new Date() : null } });
      if (op.value) await stopAll("UNSUBSCRIBED");
      break;
  }
  return { done: ids.length, skipped: 0, note: null };
}
