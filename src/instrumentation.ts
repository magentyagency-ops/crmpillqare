/**
 * Démarrage du serveur : vérifie la configuration de production puis lance le planificateur intégré
 * (relances, rappels, synchronisations, planning quotidien) sauf si SCHEDULER_MODE=external
 * (worker séparé `npm run worker` ou appel périodique de /api/cron/tick).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "production") checkProductionConfig();
  if (process.env.SCHEDULER_MODE === "external") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000));
}

/** Avertissements explicites au démarrage : liens erronés dans les emails, secrets manquants… */
function checkProductionConfig() {
  const problems: string[] = [];
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) problems.push("APP_URL n'est pas défini : les liens des emails (RDV, devis, désinscription) seront faux.");
  else if (!appUrl.startsWith("https://")) problems.push(`APP_URL (${appUrl}) devrait être une adresse https:// en production.`);
  if (!process.env.ENCRYPTION_KEY?.trim()) problems.push("ENCRYPTION_KEY est obligatoire : les connexions Gmail/IMAP/Shopify ne pourront pas être enregistrées.");
  if (process.env.SCHEDULER_MODE === "external" && !process.env.CRON_SECRET?.trim()) {
    problems.push("SCHEDULER_MODE=external sans CRON_SECRET : /api/cron/tick refusera les appels (utilisez `npm run worker` ou définissez CRON_SECRET).");
  }
  for (const p of problems) console.error(`[config] ⚠ ${p}`);
}
