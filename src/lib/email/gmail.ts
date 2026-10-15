import type { GoogleAccount, Mailbox } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { GoogleApiError, googleFetch } from "@/lib/google/oauth";
import { normalizeMessageId } from "./mime";
import { parseRawMessage } from "./parse";
import { ingestMessage } from "./inbound";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailHeader = { name: string; value: string };
type GmailMessageMeta = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

export async function gmailSend(account: GoogleAccount, raw: Buffer, threadId?: string | null) {
  const res = await googleFetch<{ id: string; threadId: string }>(account, `${API}/messages/send`, {
    method: "POST",
    json: { raw: raw.toString("base64url"), ...(threadId ? { threadId } : {}) },
  });
  // Gmail peut réécrire le Message-ID : on relit la valeur réelle pour garantir le suivi des réponses
  let messageId: string | null = null;
  try {
    const meta = await googleFetch<GmailMessageMeta>(
      account,
      `${API}/messages/${res.id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Message-Id`,
    );
    const h = meta.payload?.headers?.find((x) => x.name.toLowerCase() === "message-id");
    messageId = normalizeMessageId(h?.value);
  } catch {
    // non bloquant
  }
  return { id: res.id, threadId: res.threadId, messageId };
}

async function listMessageIds(account: GoogleAccount, q: string, max = 500): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await googleFetch<{ messages?: { id: string }[]; nextPageToken?: string }>(account, `${API}/messages?${params}`);
    for (const m of res.messages ?? []) ids.push(m.id);
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

async function historyMessageIds(account: GoogleAccount, startHistoryId: string): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await googleFetch<{
      history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
      historyId: string;
      nextPageToken?: string;
    }>(account, `${API}/history?${params}`);
    for (const h of res.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const labels = added.message.labelIds ?? [];
        if (labels.includes("DRAFT") || labels.includes("SPAM") || labels.includes("CHAT")) continue;
        ids.add(added.message.id);
      }
    }
    historyId = res.historyId ?? historyId;
    pageToken = res.nextPageToken;
  } while (pageToken && ids.size < 2000);
  return { ids: [...ids], historyId };
}

/** Synchronisation Gmail : import initial (30 jours) puis incrémental via l'historique Gmail. */
export async function syncGmailMailbox(mailbox: Mailbox & { googleAccount: GoogleAccount | null }) {
  const account = mailbox.googleAccount;
  if (!account) throw new Error("Boîte Gmail sans compte Google associé.");
  const state = (mailbox.syncState as { historyId?: string } | null) ?? {};

  let ids: string[];
  let newHistoryId: string;
  const profile = await googleFetch<{ historyId: string; emailAddress: string }>(account, `${API}/profile`);
  if (!state.historyId) {
    ids = (await listMessageIds(account, "newer_than:30d -in:chats -in:spam -in:trash -in:drafts")).reverse();
    newHistoryId = profile.historyId;
  } else {
    try {
      const h = await historyMessageIds(account, state.historyId);
      ids = h.ids;
      newHistoryId = h.historyId;
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        // Historique expiré : resynchronisation partielle
        ids = (await listMessageIds(account, "newer_than:7d -in:chats -in:spam -in:trash -in:drafts")).reverse();
        newHistoryId = profile.historyId;
      } else {
        throw error;
      }
    }
  }

  // Ignore les messages déjà importés
  if (ids.length) {
    const known = await db.emailMessage.findMany({
      where: { mailboxId: mailbox.id, providerId: { in: ids } },
      select: { providerId: true },
    });
    const knownSet = new Set(known.map((k) => k.providerId));
    ids = ids.filter((id) => !knownSet.has(id));
  }

  const users = await db.user.findMany({ select: { email: true } });
  const allMailboxes = await db.mailbox.findMany({ select: { email: true } });
  const internal = new Set([...users.map((u) => u.email.toLowerCase()), ...allMailboxes.map((m) => m.email.toLowerCase())]);

  // Tous les emails reçus et envoyés sont importés (boîte de réception complète) ; le rattachement au contact se fait à l'ingestion.
  let stored = 0;
  // Ordre chronologique (recherche Gmail inversée, historique déjà chronologique) pour un suivi correct des fils
  for (const id of ids) {
    const full = await googleFetch<{ raw: string; threadId: string; labelIds?: string[]; internalDate?: string }>(
      account,
      `${API}/messages/${id}?format=raw`,
    );
    const parsed = await parseRawMessage(Buffer.from(full.raw, "base64url"), {
      providerId: id,
      providerThreadId: full.threadId,
      fallbackDate: full.internalDate ? new Date(Number(full.internalDate)) : undefined,
    });
    const folder = (full.labelIds ?? []).includes("SENT") ? "SENT" : "INBOX";
    const res = await ingestMessage(mailbox, parsed, { folder, internal });
    if (res === "stored") stored++;
  }

  await db.mailbox.update({
    where: { id: mailbox.id },
    data: { syncState: { historyId: newHistoryId }, lastSyncAt: new Date(), status: "ACTIVE", lastError: null },
  });
  return { stored, scanned: ids.length };
}
