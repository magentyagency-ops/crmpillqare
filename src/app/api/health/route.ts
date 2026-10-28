import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { openaiModel } from "@/lib/ai/llm";

export const runtime = "nodejs";

/** Sonde de disponibilité (base de données joignable). `?ai=1` : vérifie la clé OpenAI sans la révéler. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("ai")) {
    const k = env.ai.openaiKey ?? "";
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${k.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openaiModel("smart"), input: "ok", max_output_tokens: 16 }),
    }).catch((e) => ({ status: 0, text: async () => String(e) }));
    return NextResponse.json({
      longueur: k.length, prefixeSk: k.trim().startsWith("sk-"), caracteresInvalides: /[^A-Za-z0-9_\-]/.test(k.trim()), espacesAutour: k !== k.trim(),
      modele: openaiModel("smart"), statut: res.status, reponse: (await res.text()).slice(0, 300),
    });
  }
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
