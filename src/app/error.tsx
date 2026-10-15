"use client";

import { ErrorView } from "@/components/app/error-view";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] bg-[radial-gradient(60rem_26rem_at_50%_-8%,rgba(18,41,90,0.09),transparent)]">
      <ErrorView error={error} retry={retry} homeHref="/" homeLabel="Retour à l'accueil" />
    </div>
  );
}
