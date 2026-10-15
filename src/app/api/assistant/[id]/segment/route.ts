import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addAudioSegment } from "@/lib/ai/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Réception d'un segment audio (≈ 20 s) enregistré pendant l'échange, transcrit immédiatement. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;
  const session = await db.aiSession.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!session || session.userId !== user.id) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  const form = await req.formData();
  const audio = form.get("audio");
  const index = Number(form.get("index"));
  if (!(audio instanceof Blob) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "Segment invalide" }, { status: 400 });
  }
  if (audio.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Segment trop volumineux" }, { status: 413 });
  try {
    const segment = await addAudioSegment(id, index, Buffer.from(await audio.arrayBuffer()), audio.type || "audio/webm", {
      offsetMs: Number(form.get("offsetMs") ?? 0) || 0,
      durationMs: Number(form.get("durationMs") ?? 0) || 0,
    });
    return NextResponse.json({ index: segment.index, text: segment.text ?? "", status: segment.status, error: segment.error });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: 409 });
  }
}
