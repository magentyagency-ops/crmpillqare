import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { generateQuotePdf } from "@/lib/quotes/pdf";

export const runtime = "nodejs";

/** Téléchargement du PDF par le client (lien sécurisé par jeton). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const quote = await db.quote.findUnique({ where: { publicToken: token }, select: { id: true, number: true, status: true } });
  if (!quote || quote.status === "DRAFT") return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
  const pdf = await generateQuotePdf(quote.id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Devis-${quote.number}.pdf"`, "Cache-Control": "no-store" },
  });
}
