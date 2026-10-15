"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Messages transmis par l'URL (ex. redirection après un accès refusé), affichés une seule fois. */
export function UrlNotices() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const forbidden = params.get("forbidden");
  useEffect(() => {
    if (!forbidden) return;
    toast.error("Cette page est réservée aux administrateurs et managers.");
    const next = new URLSearchParams(params.toString());
    next.delete("forbidden");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [forbidden, params, pathname, router]);
  return null;
}
