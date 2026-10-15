import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { processFormSubmission } from "@/lib/forms";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const APP_ORIGIN = new URL(env.appUrl).origin;

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function formOrigins(key: string): Promise<string[] | null> {
  const form = await db.webForm.findUnique({ where: { key }, select: { allowedOrigins: true } });
  return form ? form.allowedOrigins.map(normalizeOrigin).filter((o): o is string => Boolean(o)) : null;
}

function allowedOrigin(origins: string[] | null, origin: string | null): string | null {
  if (!origin) return null;
  if (origin === APP_ORIGIN) return origin;
  if (!origins) return null;
  if (origins.length === 0) return origin; // aucune restriction configurée
  return origins.includes(origin) ? origin : null;
}

/** Redirection demandée par le site (`_redirect`) : uniquement vers le CRM ou un site autorisé (pas de redirection ouverte). */
function safeRedirect(target: unknown, origins: string[], requestOrigin: string | null): string | null {
  if (typeof target !== "string" || !target.trim()) return null;
  let url: URL;
  try {
    url = new URL(target.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin === APP_ORIGIN || origins.includes(url.origin)) return url.toString();
  if (origins.length === 0 && requestOrigin && url.origin === requestOrigin) return url.toString();
  return null;
}

function cors(res: NextResponse, origin: string | null) {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "86400");
  }
  return res;
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  return cors(new NextResponse(null, { status: 204 }), allowedOrigin(await formOrigins(key), req.headers.get("origin")));
}

/**
 * Réception d'une demande du formulaire du site (JSON, x-www-form-urlencoded ou multipart).
 * Crée/complète la fiche, attribue un commercial, envoie la confirmation et crée la tâche de rappel.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const originHeader = req.headers.get("origin");
  const origins = await formOrigins(key);
  const origin = allowedOrigin(origins, originHeader);
  if (originHeader && !origin) {
    return NextResponse.json({ ok: false, error: "Origine non autorisée pour ce formulaire." }, { status: 403 });
  }
  const ip = clientIp(req.headers);
  if (!(await rateLimit(`form:${key}:${ip}`, 10, 600)).allowed) {
    return cors(NextResponse.json({ ok: false, error: "Trop de demandes, réessayez dans quelques minutes." }, { status: 429 }), origin);
  }

  const contentType = req.headers.get("content-type") ?? "";
  let data: Record<string, unknown> = {};
  const isJson = contentType.includes("application/json");
  try {
    if (isJson) data = (await req.json()) as Record<string, unknown>;
    else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") data[k] = data[k] !== undefined ? `${data[k]}, ${v}` : v;
    }
  } catch {
    return cors(NextResponse.json({ ok: false, error: "Données illisibles." }, { status: 400 }), origin);
  }

  const result = await processFormSubmission(key, data, {
    ip,
    userAgent: req.headers.get("user-agent"),
    pageUrl: (data.page_url as string | undefined) ?? req.headers.get("referer"),
    referrer: req.headers.get("referer"),
  });

  // Formulaire HTML classique (sans JavaScript) : redirection
  if (!isJson && (req.headers.get("accept") ?? "").includes("text/html")) {
    if (!result.ok) {
      return NextResponse.redirect(new URL(`/f/${key}?erreur=${encodeURIComponent(result.error)}`, env.appUrl), 303);
    }
    const target = safeRedirect(data._redirect, origins ?? [], originHeader) ?? result.redirectUrl ?? `${env.appUrl}/f/${key}/merci`;
    return NextResponse.redirect(target, 303);
  }
  if (!result.ok) return cors(NextResponse.json({ ok: false, error: result.error }, { status: result.status }), origin);
  return cors(NextResponse.json({ ok: true, message: result.message, redirectUrl: result.redirectUrl }), origin);
}
