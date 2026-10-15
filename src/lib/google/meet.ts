import type { GoogleAccount } from "@/generated/prisma/client";
import { GoogleApiError, googleFetch, hasScope } from "./oauth";

/**
 * Récupération des transcriptions Google Meet (API Meet v2).
 * Nécessite Google Workspace avec la transcription activée pendant la réunion.
 */
const API = "https://meet.googleapis.com/v2";
export const MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";

export function meetingCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i);
  return m ? m[1]!.toLowerCase() : null;
}

type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
type Transcript = { name: string; state?: string };
type Entry = { participant?: string; text?: string; startTime?: string };
type Participant = {
  name: string;
  signedinUser?: { displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

export type MeetTranscriptResult =
  | { status: "ready"; text: string; startedAt: Date | null; durationSec: number | null }
  | { status: "pending" }
  | { status: "unavailable"; reason: string };

export async function fetchMeetTranscript(account: GoogleAccount, videoUrl: string, around: Date): Promise<MeetTranscriptResult> {
  if (!hasScope(account, MEET_SCOPE)) {
    return { status: "unavailable", reason: "Autorisation Google Meet manquante : reconnectez votre compte Google." };
  }
  const code = meetingCodeFromUrl(videoUrl);
  if (!code) return { status: "unavailable", reason: "Ce RDV n'a pas de lien Google Meet." };

  let records: ConferenceRecord[] = [];
  try {
    const params = new URLSearchParams({ filter: `space.meeting_code = "${code}"`, pageSize: "10" });
    const res = await googleFetch<{ conferenceRecords?: ConferenceRecord[] }>(account, `${API}/conferenceRecords?${params}`);
    records = res.conferenceRecords ?? [];
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 403 || error.status === 400)) {
      return { status: "unavailable", reason: `API Google Meet indisponible pour ce compte (${error.message}).` };
    }
    throw error;
  }
  if (records.length === 0) return { status: "pending" };

  // Conférence la plus proche de l'heure du RDV
  records.sort((a, b) => Math.abs(new Date(a.startTime ?? 0).getTime() - around.getTime()) - Math.abs(new Date(b.startTime ?? 0).getTime() - around.getTime()));
  const record = records[0]!;
  if (!record.endTime) return { status: "pending" };

  const tr = await googleFetch<{ transcripts?: Transcript[] }>(account, `${API}/${record.name}/transcripts`);
  const transcripts = tr.transcripts ?? [];
  if (transcripts.length === 0) {
    return { status: "unavailable", reason: "La transcription Google Meet n'a pas été activée pendant cette réunion." };
  }
  if (!transcripts.some((t) => t.state === "FILE_GENERATED" || t.state === "ENDED")) return { status: "pending" };

  const participants = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const p = await googleFetch<{ participants?: Participant[]; nextPageToken?: string }>(account, `${API}/${record.name}/participants?${params}`);
    for (const part of p.participants ?? []) {
      participants.set(part.name, part.signedinUser?.displayName ?? part.anonymousUser?.displayName ?? part.phoneUser?.displayName ?? "Participant");
    }
    pageToken = p.nextPageToken;
  } while (pageToken);

  const lines: string[] = [];
  for (const t of transcripts) {
    let entryToken: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (entryToken) params.set("pageToken", entryToken);
      const e = await googleFetch<{ transcriptEntries?: Entry[]; nextPageToken?: string }>(account, `${API}/${t.name}/entries?${params}`);
      for (const entry of e.transcriptEntries ?? []) {
        if (!entry.text) continue;
        const who = entry.participant ? (participants.get(entry.participant) ?? "Participant") : "Participant";
        lines.push(`${who} : ${entry.text.trim()}`);
      }
      entryToken = e.nextPageToken;
    } while (entryToken);
  }
  if (lines.length === 0) return { status: "pending" };
  const startedAt = record.startTime ? new Date(record.startTime) : null;
  const durationSec = record.startTime && record.endTime ? Math.round((new Date(record.endTime).getTime() - new Date(record.startTime).getTime()) / 1000) : null;
  return { status: "ready", text: lines.join("\n"), startedAt, durationSec };
}
