/**
 * `npm run dev` : démarre (si besoin) le Postgres embarqué, applique les migrations,
 * installe les données de référence puis lance Next.js en mode développement.
 */
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { startEmbeddedPostgres, type EmbeddedDbHandle } from "./lib/embedded-db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant : copiez .env.example vers .env");
  process.exit(1);
}

let db: EmbeddedDbHandle | null = null;
if (process.env.EMBEDDED_POSTGRES === "true") {
  db = await startEmbeddedPostgres(url);
}

const run = (cmd: string, args: string[]) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} a échoué`);
};

run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["prisma", "generate"]);
run("npx", ["tsx", "prisma/seed.ts"]);

const next = spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit", shell: process.platform === "win32" });

const shutdown = async (code = 0) => {
  next.kill("SIGINT");
  if (db) await db.stop().catch(() => undefined);
  process.exit(code);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
next.on("exit", (code) => shutdown(code ?? 0));
