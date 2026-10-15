import type { NotificationType } from "@/generated/prisma/enums";
import { db, type Tx } from "./db";

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
};

/** Notification in-app (cloche) pour un utilisateur. */
export async function notify(input: NotifyInput, tx: Tx = db) {
  return tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 250),
      body: input.body?.slice(0, 1000) ?? null,
      link: input.link ?? null,
    },
  });
}

/** Notifie tous les administrateurs et managers actifs. */
export async function notifyManagers(input: Omit<NotifyInput, "userId">, tx: Tx = db) {
  const managers = await tx.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true },
  });
  for (const m of managers) await notify({ ...input, userId: m.id }, tx);
}

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}
