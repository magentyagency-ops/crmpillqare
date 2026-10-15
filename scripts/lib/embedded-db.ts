/**
 * Postgres embarqué pour le développement local : aucune installation système requise.
 * Les données sont stockées hors du projet (~/.pillqare-crm/postgres, ou EMBEDDED_POSTGRES_DIR) :
 * dans le dossier du projet, chaque écriture de la base déclencherait le rechargement à chaud de Next.js.
 * En production, utilisez un vrai PostgreSQL (DATABASE_URL) et EMBEDDED_POSTGRES=false.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function dataDirectory(): string {
  const dir = process.env.EMBEDDED_POSTGRES_DIR
    ? path.resolve(process.env.EMBEDDED_POSTGRES_DIR)
    : path.join(os.homedir(), ".pillqare-crm", "postgres");
  // Ancien emplacement (./.data/postgres) : déplacé une fois vers le nouvel emplacement
  const legacy = path.resolve(process.cwd(), ".data/postgres");
  if (!fs.existsSync(path.join(dir, "PG_VERSION")) && fs.existsSync(path.join(legacy, "PG_VERSION"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try {
      fs.renameSync(legacy, dir);
    } catch {
      fs.cpSync(legacy, dir, { recursive: true });
      fs.rmSync(legacy, { recursive: true, force: true });
    }
    console.log(`[db] Données déplacées de ${legacy} vers ${dir}.`);
  }
  return dir;
}

export type EmbeddedDbHandle = { stop: () => Promise<void>; alreadyRunning: boolean };

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || "postgres"),
    port: Number(u.port || 5432),
    host: u.hostname,
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
}

function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function startEmbeddedPostgres(databaseUrl: string): Promise<EmbeddedDbHandle> {
  const cfg = parseDatabaseUrl(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(cfg.host)) {
    throw new Error(`EMBEDDED_POSTGRES=true mais DATABASE_URL ne pointe pas vers localhost (${cfg.host}).`);
  }

  if (await isPortOpen(cfg.port)) {
    console.log(`[db] Postgres déjà actif sur le port ${cfg.port} — réutilisation.`);
    return { stop: async () => {}, alreadyRunning: true };
  }

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = dataDirectory();
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (e) => {
      const msg = String(e instanceof Error ? e.message : e);
      if (/error|fatal|panic/i.test(msg)) console.error("[db]", msg.trim());
    },
  });

  const initialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  if (!initialised) {
    console.log("[db] Initialisation du cluster Postgres embarqué…");
    fs.mkdirSync(path.dirname(databaseDir), { recursive: true });
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [cfg.database]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${cfg.database.replace(/"/g, "")}"`);
    console.log(`[db] Base « ${cfg.database} » créée.`);
  }
  await client.end();
  console.log(`[db] Postgres embarqué démarré sur le port ${cfg.port}.`);

  return {
    alreadyRunning: false,
    stop: async () => {
      await pg.stop();
      console.log("[db] Postgres embarqué arrêté.");
    },
  };
}
