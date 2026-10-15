import { ZodError } from "zod";
import { AuthError } from "./auth/guards";
import { isUniqueViolation } from "./db";

/** Résultat standard des Server Actions (affiché en toast côté client). */
export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: "UNAUTHENTICATED" | "FORBIDDEN" };

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function ok<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Exécute une action et convertit les erreurs en message lisible. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (error) {
    // Les redirections Next.js doivent être propagées
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw error;
    }
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      const first = error.issues[0];
      return { ok: false, error: first ? `${first.path.length ? `${first.path.join(".")} : ` : ""}${first.message}` : "Données invalides", fieldErrors };
    }
    if (error instanceof AuthError) {
      return { ok: false, error: error.message, code: error.code };
    }
    if (error instanceof UserError) {
      return { ok: false, error: error.message };
    }
    if (isUniqueViolation(error)) {
      return { ok: false, error: "Un enregistrement identique existe déjà (doublon détecté)." };
    }
    console.error("[action]", error);
    return { ok: false, error: error instanceof Error && !process.env.NODE_ENV?.startsWith("prod") ? error.message : "Une erreur inattendue est survenue." };
  }
}

/** Convertit un FormData en objet simple (les champs multiples deviennent des tableaux). */
export function formToObject(form: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}
