"use server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { rateLimit } from "@/lib/rate-limit";
import type { DisplayItem } from "@/lib/agent/runner";

export type AgentView = { id: string; title: string; display: DisplayItem[]; pending: boolean };

function view(c: { id: string; title: string; display: unknown; pending: unknown }): AgentView {
  return { id: c.id, title: c.title, display: (c.display as DisplayItem[]) ?? [], pending: Boolean(c.pending) };
}

async function guard() {
  const user = await assertUser();
  if (!env.ai.openaiKey) throw new UserError("Le copilote nécessite une clé OpenAI (OPENAI_API_KEY).");
  if (!(await rateLimit(`agent:${user.id}`, 60, 3600)).allowed) throw new UserError("Limite d'utilisation du copilote atteinte pour cette heure.");
  return user;
}

/** Envoie un message au copilote (nouvelle conversation si `conversationId` est vide). */
export async function agentSendAction(conversationId: string | null, text: string, pagePath: string | null): Promise<ActionResult<AgentView>> {
  return runAction(async () => {
    const user = await guard();
    const message = text.trim();
    if (!message) throw new UserError("Message vide.");
    if (message.length > 4000) throw new UserError("Message trop long (4 000 caractères maximum).");
    const { sendMessage } = await import("@/lib/agent/runner");
    try {
      return view(await sendMessage(user, conversationId, message, pagePath));
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Erreur du copilote");
    }
  });
}

/** Confirme ou annule les actions en attente. */
export async function agentConfirmAction(conversationId: string, approve: boolean, pagePath: string | null): Promise<ActionResult<AgentView>> {
  return runAction(async () => {
    const user = await guard();
    const { resolvePending } = await import("@/lib/agent/runner");
    try {
      return view(await resolvePending(user, conversationId, approve, pagePath));
    } catch (error) {
      throw new UserError(error instanceof Error ? error.message : "Erreur du copilote");
    }
  });
}

export async function agentListAction(): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  const user = await assertUser();
  return db.agentConversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true, updatedAt: true } });
}

export async function agentGetAction(id: string): Promise<AgentView | null> {
  const user = await assertUser();
  const c = await db.agentConversation.findFirst({ where: { id, userId: user.id } });
  return c ? view(c) : null;
}

export async function agentDeleteAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    await db.agentConversation.deleteMany({ where: { id, userId: user.id } });
  });
}
