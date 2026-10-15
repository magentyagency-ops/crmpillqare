import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { signState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { googleConfigured } from "@/lib/google/config";
import { googleAuthUrl } from "@/lib/google/oauth";

/** Branche le compte Google (Gmail + Agenda + Meet) de l'utilisateur connecté. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl));
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/parametres/integrations";
  if (!(await googleConfigured())) {
    return NextResponse.redirect(new URL(`/parametres/integrations?google=error&message=${encodeURIComponent("La connexion Google n'est pas encore activée par l'administrateur.")}`, env.appUrl));
  }
  const state = signState({ mode: "connect", userId: user.id, returnTo });
  return NextResponse.redirect(await googleAuthUrl(state, { loginHint: user.email, prompt: "consent" }));
}
