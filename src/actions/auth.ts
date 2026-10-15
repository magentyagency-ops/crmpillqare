"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, revokeAllSessions } from "@/lib/auth/session";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { randomToken, sha256 } from "@/lib/crypto";
import { clientIp, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { seedReferenceData, uniqueBookingSlug } from "@/lib/bootstrap";
import { sendSystemEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { escapeHtml } from "@/lib/email/render";

export type FormState = { error?: string; success?: string } | undefined;

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Email et mot de passe requis." };
  const ip = clientIp(await headers());
  const limiter = await rateLimit(`login:${ip}:${email}`, 8, 15 * 60);
  if (!limiter.allowed) return { error: "Trop de tentatives. Réessayez dans 15 minutes." };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Identifiants incorrects." };
  }
  await resetRateLimit(`login:${ip}:${email}`);
  await createSession(user.id);
  const next = String(form.get("next") ?? "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login") ? next : null;
  redirect(safeNext ?? (user.role === "SALES" ? "/aujourdhui" : "/tableau-de-bord"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

const setupSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis"),
  lastName: z.string().trim().min(1, "Nom requis"),
  email: z.email("Email invalide").transform((v) => v.toLowerCase()),
  password: z.string(),
});

/** Création du premier administrateur (uniquement si aucun utilisateur n'existe). */
export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  if ((await db.user.count()) > 0) return { error: "L'installation est déjà effectuée." };
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: problem };
  await seedReferenceData();
  const user = await db.user.create({
    data: {
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: "ADMIN",
      passwordHash: await hashPassword(parsed.data.password),
      bookingSlug: await uniqueBookingSlug(`${parsed.data.firstName}-${parsed.data.lastName}`),
      signature: `${parsed.data.firstName} ${parsed.data.lastName}\nPillQare`,
    },
  });
  await createSession(user.id);
  redirect("/parametres/integrations?bienvenue=1");
}

export async function requestPasswordResetAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const ip = clientIp(await headers());
  const limiter = await rateLimit(`reset:${ip}`, 5, 60 * 60);
  if (!limiter.allowed) return { error: "Trop de demandes. Réessayez plus tard." };
  const user = await db.user.findUnique({ where: { email } });
  if (user && user.active) {
    const token = randomToken(32);
    await db.userToken.create({ data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
    const link = `${env.appUrl}/reinitialiser/${token}`;
    try {
      await sendSystemEmail({
        to: user.email,
        subject: "Réinitialisation de votre mot de passe — PillQare CRM",
        text: `Bonjour ${user.firstName},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
        html: `<p>Bonjour ${escapeHtml(user.firstName)},</p><p>Pour choisir un nouveau mot de passe, cliquez sur ce lien (valable 1 heure) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
      });
    } catch (error) {
      console.error("[auth] email de réinitialisation non envoyé :", error);
      return { error: "L'email n'a pas pu être envoyé (serveur d'envoi non configuré). Contactez un administrateur." };
    }
  }
  return { success: "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé." };
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { error: "Les deux mots de passe ne correspondent pas." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const row = await db.userToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) {
    return { error: "Ce lien n'est plus valide. Demandez un nouveau lien." };
  }
  await db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } });
  await db.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  await revokeAllSessions(row.userId);
  await createSession(row.userId);
  redirect(row.user.role === "SALES" ? "/aujourdhui" : "/tableau-de-bord");
}
