import type { AssignmentStrategy } from "@/generated/prisma/enums";
import { db } from "./db";
import { getSettings, updateSettings } from "./settings";

/**
 * Attribution automatique d'un commercial à un lead entrant.
 * - ROUND_ROBIN : tour de rôle entre les commerciaux actifs qui reçoivent des leads
 * - SEGMENT : tour de rôle parmi les commerciaux affectés à la cible (sinon tour de rôle global)
 * - FIXED : commercial fixe
 * Retourne toujours un utilisateur actif (repli sur un admin).
 */
export async function pickOwner(opts: {
  strategy?: AssignmentStrategy;
  segmentId?: string | null;
  fixedOwnerId?: string | null;
}): Promise<string> {
  const strategy = opts.strategy ?? "ROUND_ROBIN";

  if (strategy === "FIXED" && opts.fixedOwnerId) {
    const u = await db.user.findFirst({ where: { id: opts.fixedOwnerId, active: true }, select: { id: true } });
    if (u) return u.id;
  }

  let candidates: { id: string }[] = [];
  if (strategy === "SEGMENT" && opts.segmentId) {
    candidates = await db.user.findMany({
      where: { active: true, receivesLeads: true, segments: { some: { segmentId: opts.segmentId } } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (candidates.length === 0) {
    candidates = await db.user.findMany({
      where: { active: true, receivesLeads: true, role: { in: ["SALES", "MANAGER"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (candidates.length === 0) {
    candidates = await db.user.findMany({ where: { active: true, receivesLeads: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  }
  if (candidates.length === 0) {
    const fallback = await db.user.findFirst({ where: { active: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true } });
    if (!fallback) throw new Error("Aucun utilisateur actif pour recevoir le lead.");
    return fallback.id;
  }
  if (candidates.length === 1) return candidates[0]!.id;

  const settings = await getSettings("assignment");
  const idx = candidates.findIndex((c) => c.id === settings.lastAssignedUserId);
  const next = candidates[(idx + 1) % candidates.length]!;
  await updateSettings("assignment", { lastAssignedUserId: next.id });
  return next.id;
}

/** Commercial par défaut pour les entrées hors formulaire (Shopify, email entrant, Google Agenda). */
export async function defaultOwner(segmentId?: string | null): Promise<string> {
  const settings = await getSettings("assignment");
  if (settings.defaultOwnerId) {
    const u = await db.user.findFirst({ where: { id: settings.defaultOwnerId, active: true }, select: { id: true } });
    if (u) return u.id;
  }
  return pickOwner({ strategy: "SEGMENT", segmentId });
}
