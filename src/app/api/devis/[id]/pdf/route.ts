import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { canView } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { generateQuotePdf } from "@/lib/quotes/pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;
  const quote = await db.quote.findUnique({ where: { id }, select: { number: true, ownerId: true, contact: { select: { ownerId: true } } } });
  if (!quote || !(await canView(user, [quote.ownerId, quote.contact.ownerId]))) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
  const pdf = await generateQuotePdf(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Devis-${quote.number}.pdf"`, "Cache-Control": "no-store" },
  });
}
