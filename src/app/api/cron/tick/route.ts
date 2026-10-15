import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runSchedulerTick } from "@/lib/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Déclenchement externe du planificateur (cron Vercel, GitHub Actions, crontab…), protégé par CRON_SECRET. */
async function handle(req: NextRequest) {
  const secret = env.cronSecret;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : (req.nextUrl.searchParams.get("secret") ?? "");
  if (!provided || !safeEqual(provided, secret)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const res = await runSchedulerTick();
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handle;
export const POST = handle;
