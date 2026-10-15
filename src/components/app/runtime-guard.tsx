"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/client/recovery";

/** Intercepte les erreurs non gérées liées à une version périmée de l'application (après une mise à jour). */
export function RuntimeGuard() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (reloadIfStale(event.reason)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      if (reloadIfStale(event.error)) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
