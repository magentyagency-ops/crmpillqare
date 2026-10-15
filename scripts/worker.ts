/**
 * Worker autonome (SCHEDULER_MODE=external) : exécute le planificateur toutes les 30 s.
 * Utile si le serveur web est déployé en serverless ou sur plusieurs instances.
 */
import "dotenv/config";
import { runSchedulerTick } from "../src/lib/scheduler";

const INTERVAL = Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function loop() {
  console.info(`[worker] démarré (toutes les ${INTERVAL / 1000} s)`);
  while (!stopping) {
    const started = Date.now();
    try {
      const res = await runSchedulerTick();
      if (res.ran.length) console.info(`[worker] ${new Date().toISOString()} : ${res.ran.join(", ")}`);
    } catch (error) {
      console.error("[worker]", error instanceof Error ? error.message : error);
    }
    const wait = Math.max(1_000, INTERVAL - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
await loop();
process.exit(0);
