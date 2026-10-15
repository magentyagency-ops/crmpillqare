import { ImapFlow } from "imapflow";
import type { Mailbox } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decryptOptional } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/normalize";
import { parseRawMessage } from "./parse";
import { ingestMessage } from "./inbound";

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

type FolderState = { uidValidity: string; lastUid: number };
type ImapSyncState = { folders?: Record<string, FolderState> };

const INITIAL_DAYS = 30;
const MAX_PER_RUN = 300;

function client(cfg: ImapConfig) {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    socketTimeout: 90_000,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
}

export function imapConfigFromMailbox(mailbox: Mailbox): ImapConfig {
  if (!mailbox.imapHost || !mailbox.imapPort || !mailbox.username) throw new Error("Configuration IMAP incomplète.");
  return {
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecure,
    user: mailbox.username,
    password: decryptOptional(mailbox.passwordEnc) ?? "",
  };
}

export async function testImap(cfg: ImapConfig): Promise<{ sentFolder: string | null }> {
  const c = client(cfg);
  await c.connect();
  try {
    const folders = await c.list();
    const sent = folders.find((f) => f.specialUse === "\\Sent");
    return { sentFolder: sent?.path ?? null };
  } finally {
    await c.logout().catch(() => undefined);
  }
}

/** Les serveurs Gmail / Microsoft enregistrent eux-mêmes les messages envoyés. */
export function serverSavesSentCopy(smtpHost: string | null | undefined): boolean {
  return /gmail|googlemail|google\.com|outlook|office365|hotmail|live\.com/i.test(smtpHost ?? "");
}

/** Dépose une copie du message envoyé dans le dossier « Envoyés » (serveurs qui ne le font pas). */
export async function appendToSent(mailbox: Mailbox, raw: Buffer): Promise<void> {
  if (serverSavesSentCopy(mailbox.smtpHost)) return;
  const cfg = imapConfigFromMailbox(mailbox);
  const c = client(cfg);
  await c.connect();
  try {
    let path = mailbox.sentFolder;
    if (!path) {
      const folders = await c.list();
      path = folders.find((f) => f.specialUse === "\\Sent")?.path ?? null;
      if (path) await db.mailbox.update({ where: { id: mailbox.id }, data: { sentFolder: path } });
    }
    if (path) await c.append(path, raw, ["\\Seen"]);
  } finally {
    await c.logout().catch(() => undefined);
  }
}

/** Synchronise INBOX + Envoyés : tous les messages sont importés (rattachés au contact quand il existe). */
export async function syncImapMailbox(mailbox: Mailbox): Promise<{ stored: number; scanned: number }> {
  const cfg = imapConfigFromMailbox(mailbox);
  const state: ImapSyncState = (mailbox.syncState as ImapSyncState | null) ?? {};
  state.folders ??= {};
  const c = client(cfg);
  let stored = 0;
  let scanned = 0;
  await c.connect();
  try {
    const list = await c.list();
    const sentPath = mailbox.sentFolder ?? list.find((f) => f.specialUse === "\\Sent")?.path ?? null;
    const folders: { path: string; kind: "INBOX" | "SENT" }[] = [{ path: "INBOX", kind: "INBOX" }];
    if (sentPath) folders.push({ path: sentPath, kind: "SENT" });

    const users = await db.user.findMany({ select: { email: true } });
    const mailboxes = await db.mailbox.findMany({ select: { email: true } });
    const internal = new Set([...users.map((u) => u.email.toLowerCase()), ...mailboxes.map((m) => m.email.toLowerCase())]);

    for (const folder of folders) {
      const lock = await c.getMailboxLock(folder.path);
      try {
        const mb = c.mailbox;
        if (!mb) continue;
        const uidValidity = String(mb.uidValidity);
        const prev = state.folders[folder.path];
        let uids: number[];
        if (!prev || prev.uidValidity !== uidValidity) {
          const found = await c.search({ since: new Date(Date.now() - INITIAL_DAYS * 86_400_000) }, { uid: true });
          uids = Array.isArray(found) ? found : [];
        } else {
          if (mb.uidNext - 1 <= prev.lastUid) {
            continue;
          }
          const found = await c.search({ uid: `${prev.lastUid + 1}:*` }, { uid: true });
          uids = (Array.isArray(found) ? found : []).filter((u) => u > prev.lastUid);
        }
        uids.sort((a, b) => a - b);
        const batch = uids.slice(0, MAX_PER_RUN);
        if (batch.length === 0) {
          state.folders[folder.path] = { uidValidity, lastUid: prev?.uidValidity === uidValidity ? prev.lastUid : Math.max(0, mb.uidNext - 1) };
          continue;
        }

        // 1er passage : enveloppes uniquement
        type Env = { uid: number; addresses: string[]; inReplyTo: string | null };
        const envs: Env[] = [];
        for await (const m of c.fetch(batch.join(","), { uid: true, envelope: true }, { uid: true })) {
          const e = m.envelope;
          const addresses = [...(e?.from ?? []), ...(e?.to ?? []), ...(e?.cc ?? [])]
            .map((a) => normalizeEmail(a.address))
            .filter((x): x is string => Boolean(x) && !internal.has(x!));
          envs.push({ uid: m.uid, addresses, inReplyTo: e?.inReplyTo ?? null });
        }
        scanned += envs.length;
        const relevant = envs;

        for (const e of relevant) {
          const full = await c.fetchOne(String(e.uid), { source: true, internalDate: true }, { uid: true });
          if (!full || !full.source) continue;
          const parsed = await parseRawMessage(full.source, {
            providerId: `${folder.path}:${uidValidity}:${e.uid}`,
            fallbackDate: full.internalDate ? new Date(full.internalDate) : undefined,
          });
          const res = await ingestMessage(mailbox, parsed, { folder: folder.kind, internal });
          if (res === "stored") stored++;
        }
        const maxUid = batch[batch.length - 1]!;
        state.folders[folder.path] = { uidValidity, lastUid: Math.max(maxUid, prev?.uidValidity === uidValidity ? prev.lastUid : 0) };
      } finally {
        lock.release();
      }
    }
  } finally {
    await c.logout().catch(() => undefined);
  }
  await db.mailbox.update({
    where: { id: mailbox.id },
    data: { syncState: state, lastSyncAt: new Date(), status: "ACTIVE", lastError: null },
  });
  return { stored, scanned };
}
