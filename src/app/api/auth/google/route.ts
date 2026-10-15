import { NextResponse, type NextRequest } from "next/server";
import { signState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { googleConfigured } from "@/lib/google/config";
import { googleAuthUrl } from "@/lib/google/oauth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** « Se connecter avec Google » : connexion au CRM et branchement de Gmail + Agenda en une seule étape. */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "";
  if (!(await googleConfigured())) return NextResponse.redirect(new URL("/login", env.appUrl));
  if (!(await rateLimit(`google-login:${clientIp(req.headers)}`, 20, 15 * 60)).allowed) {
    return NextResponse.redirect(new URL(`/login?erreur=${encodeURIComponent("Trop de tentatives, réessayez dans quelques minutes.")}`, env.appUrl));
  }
  const state = signState({ mode: "login", next: next.startsWith("/") && !next.startsWith("//") ? next : "" });
  // Choix du compte ; l'écran d'autorisations n'apparaît que la première fois
  return NextResponse.redirect(await googleAuthUrl(state, { prompt: "select_account" }));
}
