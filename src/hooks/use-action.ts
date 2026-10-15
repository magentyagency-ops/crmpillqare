"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";
import { redirectToLogin, reloadIfStale } from "@/lib/client/recovery";

type Options<T> = {
  /** Message de succès par défaut (si l'action n'en renvoie pas) ; false = aucun toast de succès */
  success?: string | false;
  onSuccess?: (data: T | undefined) => void;
  onError?: (error: string) => void;
  /** Rafraîchit les données de la page après succès (défaut : oui) */
  refresh?: boolean;
};

/** Exécute une Server Action avec état de chargement, toast et rafraîchissement. */
export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<ActionResult<T>>, options: Options<T> = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (...args: A) =>
      new Promise<ActionResult<T> | null>((resolve) => {
        startTransition(async () => {
          try {
            const res = await action(...args);
            if (res.ok) {
              const msg = options.success === false ? null : (res.message ?? options.success);
              if (msg) toast.success(msg);
              options.onSuccess?.(res.data);
              if (options.refresh !== false) router.refresh();
            } else if (res.code === "UNAUTHENTICATED") {
              redirectToLogin(res.error);
            } else {
              toast.error(res.error);
              options.onError?.(res.error);
            }
            resolve(res);
          } catch (error) {
            // Redirections Next.js
            if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
              throw error;
            }
            // Application mise à jour pendant que la page était ouverte : rechargement transparent
            if (reloadIfStale(error)) {
              resolve(null);
              return;
            }
            const offline = typeof navigator !== "undefined" && !navigator.onLine;
            const message = offline ? "Connexion internet interrompue : réessayez dans un instant." : error instanceof Error && error.message ? error.message : "Erreur inattendue";
            toast.error(message);
            options.onError?.(message);
            resolve(null);
          }
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, router],
  );

  return { run, pending };
}
