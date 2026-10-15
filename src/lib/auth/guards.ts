import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { getSessionUser, type SessionUser } from "./session";
import { getSettings } from "@/lib/settings";

export class AuthError extends Error {
  /** UNAUTHENTICATED : session absente ou expirée ; FORBIDDEN : droits insuffisants */
  constructor(
    message = "Non autorisé",
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" = "FORBIDDEN",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Page demandée (renseignée par le proxy) pour y revenir après reconnexion. */
async function currentPath(): Promise<string | null> {
  const { headers } = await import("next/headers");
  const path = (await headers()).get("x-pq-path");
  return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
}

/** Pour les pages : redirige vers /login si non connecté. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const path = await currentPath();
    redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }
  return user;
}

/** Pour les pages réservées : redirige vers l'accueil si rôle insuffisant. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/aujourdhui?forbidden=1");
  return user;
}

/** Pour les Server Actions / API : lève une erreur au lieu de rediriger. */
export async function assertUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Session expirée : reconnectez-vous.", "UNAUTHENTICATED");
  return user;
}

export async function assertRole(...roles: Role[]): Promise<SessionUser> {
  const user = await assertUser();
  if (!roles.includes(user.role)) throw new AuthError("Action réservée aux administrateurs / managers.");
  return user;
}

export function isManager(user: Pick<SessionUser, "role">): boolean {
  return user.role === "ADMIN" || user.role === "MANAGER";
}

export function isAdmin(user: Pick<SessionUser, "role">): boolean {
  return user.role === "ADMIN";
}

/**
 * Filtre Prisma de visibilité pour les entités possédées (contacts, dossiers, devis…).
 * Manager/Admin : tout ; commercial : tout ou uniquement ses données selon les paramètres.
 */
export async function ownerScope(user: SessionUser, field: "ownerId" | "assigneeId" | "organizerId" | "userId" = "ownerId") {
  if (isManager(user)) return {};
  const vis = await getSettings("visibility");
  if (vis.salesSeeAll) return {};
  return { [field]: user.id } as Record<string, string>;
}

/**
 * Consultation d'un élément (fiche, dossier, devis…) : la direction voit tout ; un commercial voit tout
 * si la visibilité d'équipe est activée, sinon seulement ce qui le concerne (ou ce qui n'a pas de responsable).
 */
export async function canView(user: SessionUser, ownerIds: (string | null | undefined)[]): Promise<boolean> {
  if (isManager(user)) return true;
  const vis = await getSettings("visibility");
  if (vis.salesSeeAll) return true;
  const owners = ownerIds.filter((o): o is string => Boolean(o));
  return owners.length === 0 || owners.includes(user.id);
}

/** Vérifie qu'un utilisateur peut modifier une entité appartenant à ownerId. */
export async function canEdit(user: SessionUser, ownerId: string | null | undefined): Promise<boolean> {
  if (isManager(user) || !ownerId || ownerId === user.id) return true;
  const vis = await getSettings("visibility");
  return vis.salesSeeAll;
}

export async function assertCanEdit(user: SessionUser, ownerId: string | null | undefined): Promise<void> {
  if (!(await canEdit(user, ownerId))) throw new AuthError("Vous n'avez pas accès à cet élément.");
}
