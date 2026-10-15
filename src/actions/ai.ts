"use server";

import { db } from "@/lib/db";
import { assertUser, canView } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { rateLimit } from "@/lib/rate-limit";
import { llmAvailable, LlmError } from "@/lib/ai/llm";
import { analyzeRelationship, draftEmail, type AiEmail, type ContactInsights, type DraftOptions } from "@/lib/ai/writer";

async function guard(contactId?: string | null, dealId?: string | null) {
  const user = await assertUser();
  if (!llmAvailable()) throw new UserError("L'IA n'est pas configurée sur ce CRM.");
  // Garde-fou sur les coûts : 80 demandes par heure et par utilisateur
  if (!(await rateLimit(`ai:${user.id}`, 80, 3600)).allowed) throw new UserError("Limite d'utilisation de l'IA atteinte pour cette heure : réessayez plus tard.");
  const [contact, deal] = await Promise.all([
    contactId ? db.contact.findUnique({ where: { id: contactId }, select: { ownerId: true } }) : null,
    dealId ? db.deal.findUnique({ where: { id: dealId }, select: { ownerId: true } }) : null,
  ]);
  if ((contactId && !contact) || (dealId && !deal)) throw new UserError("Contact ou dossier introuvable.");
  if (!(await canView(user, [contact?.ownerId, deal?.ownerId]))) throw new UserError("Vous n'avez pas accès à ce contact.");
  return user;
}

function friendly(error: unknown): never {
  if (error instanceof LlmError) throw new UserError(error.message);
  throw error;
}

/** Rédaction / réécriture / réponse suggérée par l'IA. */
export async function aiDraftEmailAction(input: Omit<DraftOptions, "userId">): Promise<ActionResult<AiEmail>> {
  return runAction(async () => {
    const user = await guard(input.contactId, input.dealId);
    if (input.replyToEmailId) {
      const email = await db.emailMessage.findUnique({ where: { id: input.replyToEmailId }, select: { contactId: true, userId: true } });
      if (!email || (email.contactId && input.contactId && email.contactId !== input.contactId)) throw new UserError("Email introuvable.");
      // Email hors CRM : seul le propriétaire de la boîte peut y faire répondre l'IA
      if (!email.contactId && email.userId !== user.id) throw new UserError("Email introuvable.");
    }
    try {
      return await draftEmail({ ...input, userId: user.id });
    } catch (error) {
      friendly(error);
    }
  });
}

/** Analyse IA d'un contact / dossier : synthèse, intérêt, prochaine meilleure action. */
export async function aiAnalyzeAction(input: { contactId?: string | null; dealId?: string | null }): Promise<ActionResult<ContactInsights>> {
  return runAction(async () => {
    const user = await guard(input.contactId, input.dealId);
    if (!input.contactId && !input.dealId) throw new UserError("Contact manquant.");
    try {
      return await analyzeRelationship({ userId: user.id, contactId: input.contactId, dealId: input.dealId });
    } catch (error) {
      friendly(error);
    }
  });
}
