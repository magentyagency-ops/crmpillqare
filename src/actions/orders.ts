"use server";

import { db } from "@/lib/db";
import { assertUser } from "@/lib/auth/guards";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { defaultOwner } from "@/lib/assignment";

export async function markOrderStepAction(orderId: string, step: "installation" | "onboarding", done: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const order = await db.order.update({
      where: { id: orderId },
      data: step === "installation" ? { installationDoneAt: done ? new Date() : null } : { onboardingDoneAt: done ? new Date() : null },
    });
    if (done) {
      await db.task.updateMany({
        where: { orderId, status: "OPEN", type: step === "installation" ? "INSTALLATION" : "ONBOARDING" },
        data: { status: "DONE", completedAt: new Date() },
      });
      await logActivity({
        type: "SYSTEM",
        title: `Commande ${order.number} : ${step === "installation" ? "installation" : "prise en main"} validée`,
        contactId: order.contactId,
        orderId,
        userId: user.id,
      });
    }
  }, "Suivi mis à jour");
}

/** Démarre manuellement le suivi après-achat (si la commande n'était pas éligible automatiquement). */
export async function startPostPurchaseAction(orderId: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertUser();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { contact: { select: { ownerId: true } } } });
    if (order.cancelledAt) throw new UserError("Commande annulée.");
    const { autoEnroll } = await import("@/lib/sequences/engine");
    const res = await autoEnroll("ORDER_PAID", { contactId: order.contactId, orderId, ownerId: order.contact.ownerId ?? (await defaultOwner(null)) });
    if (!res) throw new UserError("Aucun scénario « Commande payée » actif : créez-le dans Relances > Scénarios.");
    await db.order.update({ where: { id: orderId }, data: { postPurchaseStartedAt: order.postPurchaseStartedAt ?? new Date() } });
  }, "Suivi après-achat démarré");
}
