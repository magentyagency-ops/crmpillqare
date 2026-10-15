"use client";

import { useEffect } from "react";

/** Erreur dans la mise en page racine : page autonome (sans les styles de l'application). */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f5f6f2", color: "#12295A" }}>
        <title>Erreur · PillQare CRM</title>
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Le CRM rencontre un problème</h1>
          <p style={{ color: "#4a5568", maxWidth: 440, margin: 0 }}>Rechargez la page dans un instant. Si le problème persiste, contactez votre administrateur.</p>
          {error.digest && <code style={{ fontSize: 12, color: "#64748b" }}>Réf. {error.digest}</code>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => retry()} style={{ background: "#12295A", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}>
              Réessayer
            </button>
            <button onClick={() => window.location.reload()} style={{ background: "white", color: "#12295A", border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}>
              Recharger
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
