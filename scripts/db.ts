/**
 * Démarre uniquement le Postgres embarqué (utile pour lancer Prisma Studio, les migrations
 * ou les tests dans un autre terminal). Ctrl+C pour arrêter.
 */
import "dotenv/config";
import { startEmbeddedPostgres } from "./lib/embedded-db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example).");
  process.exit(1);
}

const handle = await startEmbeddedPostgres(url);
if (handle.alreadyRunning) process.exit(0);

console.log("[db] Prêt. Ctrl+C pour arrêter.");
const shutdown = async () => {
  await handle.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
