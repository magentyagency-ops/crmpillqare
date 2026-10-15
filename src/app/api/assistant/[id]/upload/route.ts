import { after, NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { finalizeSession, transcribeUpload } from "@/lib/ai/sessions";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Import d'un enregistrement complet (appel, visio, RDV) : transcription puis compte rendu IA. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;
  const session = await db.aiSession.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!session || session.userId !== user.id) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  if (file.size > 200 * 1024 * 1024) return NextResponse.json({ error: "Fichier trop volumineux (200 Mo maximum)" }, { status: 413 });
  const durationSec = Number(form.get("durationSec") ?? 0) || null;
  try {
    await transcribeUpload(id, Buffer.from(await file.arrayBuffer()), file.type || "audio/mpeg");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Transcription impossible" }, { status: 422 });
  }
  await db.aiSession.update({ where: { id }, data: { endedAt: new Date(), durationSec } });
  after(async () => {
    try {
      await finalizeSession(id, { durationSec });
    } catch (error) {
      console.error("[assistant] analyse :", error instanceof Error ? error.message : error);
    }
  });
  return NextResponse.json({ ok: true });
}
