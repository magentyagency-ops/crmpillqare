import { NextResponse, type NextRequest } from "next/server";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verifyState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeGoogleCode, fetchGoogleUserInfo, saveGoogleConnection } from "@/lib/google/oauth";

type State = { mode?: "connect" | "login"; userId?: string; returnTo?: string; next?: string };

function redirect(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, env.appUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function loginError(message: string) {
  return redirect("/login", { erreur: message });
}

/** Retour de Google, pour un branchement de compte (utilisateur connecté) ou une connexion au CRM. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = verifyState<State>(sp.get("state") ?? "");
  const login = state?.mode === "login";

  if (sp.get("error")) {
    const message = sp.get("error") === "access_denied" ? "Connexion Google annulée." : `Google : ${sp.get("error")}`;
    return login || !state ? loginError(message) : redirect(state.returnTo ?? "/parametres/integrations", { google: "error", message });
  }
  if (!state) return loginError("Lien de connexion expiré : recommencez.");
  const code = sp.get("code");
  if (!code) return loginError("Réponse de Google incomplète : recommencez.");

  try {
    const tokens = await exchangeGoogleCode(code);
    const profile = await fetchGoogleUserInfo(tokens.access_token);
    const email = profile.email.toLowerCase();

    if (login) {
      if (profile.email_verified === false) return loginError("Adresse Google non vérifiée.");
      // Utilisateur du CRM : même adresse email, ou compte Google déjà associé
      const linked = await db.googleAccount.findFirst({ where: { OR: [{ googleUserId: profile.sub }, { email }] }, select: { userId: true } });
      const user = await db.user.findFirst({
        where: { active: true, OR: [{ email: { equals: email, mode: "insensitive" } }, ...(linked ? [{ id: linked.userId }] : [])] },
      });
      if (!user) return loginError(`Aucun accès au CRM pour ${email}. Demandez à votre administrateur de vous inviter avec cette adresse.`);
      const account = await saveGoogleConnection(user, tokens, profile);
      await createSession(user.id);
      // Premier branchement sans jeton durable (autorisation déjà donnée auparavant) : on redemande une fois l'accord
      if (!account.refreshTokenEnc) return redirect("/api/integrations/google/connect", { returnTo: state.next || "/aujourdhui" });
      return redirect(state.next || (user.role === "SALES" ? "/aujourdhui" : "/tableau-de-bord"));
    }

    const user = await getSessionUser();
    if (!user || user.id !== state.userId) return loginError("Session expirée : reconnectez-vous.");
    await saveGoogleConnection(user, tokens, profile);
    return redirect(state.returnTo?.startsWith("/") ? state.returnTo : "/parametres/integrations", { google: "ok" });
  } catch (error) {
    console.error("[google] connexion :", error);
    const message = error instanceof Error ? error.message : "Erreur de connexion Google";
    return login ? loginError(message) : redirect(state.returnTo ?? "/parametres/integrations", { google: "error", message });
  }
}
