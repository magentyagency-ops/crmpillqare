"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reloadIfStale } from "@/lib/client/recovery";

/** Écran d'erreur commun : nouvel essai, retour à l'accueil, référence pour le support. */
export function ErrorView({ error, retry, homeHref, homeLabel }: { error: Error & { digest?: string }; retry: () => void; homeHref: string; homeLabel: string }) {
  useEffect(() => {
    // Version périmée après une mise à jour : rechargement automatique plutôt qu'une erreur
    if (!reloadIfStale(error)) console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-amber-50">
        <AlertTriangle className="size-7 text-amber-600" />
      </span>
      <h1 className="text-xl font-semibold text-brand-navy">Une erreur est survenue</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Cette page n&apos;a pas pu s&apos;afficher. Réessayez dans un instant ; si le problème persiste, transmettez la référence ci-dessous à votre administrateur.
      </p>
      {error.digest && <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">Réf. {error.digest}</code>}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCw /> Réessayer
        </Button>
        <Button variant="outline" asChild>
          <Link href={homeHref}>{homeLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
