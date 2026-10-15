"use client";

import { ErrorView } from "@/components/app/error-view";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} homeHref="/aujourdhui" homeLabel="Retour à ma journée" />;
}
