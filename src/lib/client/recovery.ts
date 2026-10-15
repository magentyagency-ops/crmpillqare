"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";

/**
 * Récupération automatique côté navigateur :
 * - le CRM a été mis à jour pendant que la page était ouverte (action ou fichier JS introuvable) → rechargement ;
 * - la session a expiré → retour à la connexion, puis à la page en cours.
 */

const RELOAD_KEY = "pq:stale-reload";
let leaving = false;

function isChunkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

export function isStaleDeploymentError(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error) || isChunkError(error);
}

/** Recharge la page si l'erreur vient d'une version périmée (une seule fois par minute, jamais en boucle). */
export function reloadIfStale(error: unknown): boolean {
  if (!isStaleDeploymentError(error)) return false;
  if (leaving) return true;
  let recent = false;
  try {
    recent = Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 60_000;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // stockage indisponible : rechargement quand même
  }
  if (recent) {
    toast.error("La page n'est plus à jour. Rechargez-la (Cmd/Ctrl + Maj + R).");
    return true;
  }
  leaving = true;
  toast.info("Le CRM vient d'être mis à jour : rechargement de la page…");
  setTimeout(() => window.location.reload(), 700);
  return true;
}

/** Session expirée : connexion puis retour à la page en cours. */
export function redirectToLogin(message = "Votre session a expiré : reconnectez-vous.") {
  if (leaving) return;
  leaving = true;
  toast.error(message);
  const next = window.location.pathname + window.location.search;
  // Rechargement complet volontaire : repart d'un état propre après la reconnexion
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  setTimeout(() => window.location.assign(`/login?next=${encodeURIComponent(next)}`), 900);
}
