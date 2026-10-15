import { NextResponse, type NextRequest } from "next/server";

/**
 * Vérification optimiste : sans cookie de session, les pages internes redirigent vers /login.
 * La validation réelle de la session est faite côté serveur (requireUser).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/installation",
  "/mot-de-passe-oublie",
  "/reinitialiser",
  "/rdv",
  "/p/",
  "/f/",
  "/api/public",
  "/api/webhooks",
  "/api/cron",
  "/api/health",
  "/api/auth/google",
  "/api/integrations/google/callback",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || pathname === p.replace(/\/$/, ""))) {
    return NextResponse.next();
  }
  if (!request.cookies.get("pq_session")?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  // Chemin demandé, pour revenir sur la bonne page si la session a expiré entre-temps
  const headers = new Headers(request.headers);
  headers.set("x-pq-path", pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|apple-icon.png|pillqare-mark.png|logo-pillqare.webp|robots.txt).*)"],
};
