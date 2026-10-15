import { env } from "@/lib/env";

/**
 * Transcription audio (speech-to-text) — fournisseurs au choix : ElevenLabs Scribe, OpenAI, Deepgram.
 * Le fichier audio n'est jamais conservé : il est transcrit puis supprimé de la mémoire.
 */

export type TranscriptionResult = { text: string; speakers: boolean };

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export function transcriptionAvailable(): boolean {
  return env.ai.transcriptionProvider !== undefined;
}

export function transcriptionProviderLabel(): string | null {
  switch (env.ai.transcriptionProvider) {
    case "elevenlabs":
      return "ElevenLabs Scribe";
    case "openai":
      return "OpenAI";
    case "deepgram":
      return "Deepgram";
    default:
      return null;
  }
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  return "webm";
}

type ElevenWord = { text: string; type?: string; speaker_id?: string | null };

async function elevenlabs(audio: Buffer, mime: string, language: string): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("model_id", env.ai.elevenlabsModel);
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extFor(mime)}`);
  form.append("language_code", language);
  form.append("diarize", "true");
  form.append("tag_audio_events", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": env.ai.elevenlabsKey! },
    body: form,
  });
  if (!res.ok) throw new TranscriptionError(`ElevenLabs (${res.status}) : ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string; words?: ElevenWord[] };
  const words = json.words ?? [];
  const speakerIds = new Set(words.map((w) => w.speaker_id).filter(Boolean));
  if (speakerIds.size > 1) {
    // Reconstitue le texte par interlocuteur
    const lines: string[] = [];
    let current: string | null = null;
    let buffer = "";
    const names = new Map<string, string>();
    for (const w of words) {
      const sp: string = w.speaker_id ?? current ?? "speaker_0";
      if (!names.has(sp)) names.set(sp, `Interlocuteur ${names.size + 1}`);
      if (sp !== current && buffer.trim()) {
        lines.push(`${names.get(current!)} : ${buffer.trim()}`);
        buffer = "";
      }
      current = sp;
      buffer += w.type === "spacing" ? w.text : w.type === "word" || !w.type ? w.text : "";
    }
    if (buffer.trim() && current) lines.push(`${names.get(current)} : ${buffer.trim()}`);
    return { text: lines.join("\n"), speakers: true };
  }
  return { text: (json.text ?? "").trim(), speakers: false };
}

async function openai(audio: Buffer, mime: string, language: string): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extFor(mime)}`);
  form.append("model", env.ai.openaiTranscriptionModel);
  form.append("language", language.slice(0, 2));
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.openaiKey}` },
    body: form,
  });
  if (!res.ok) throw new TranscriptionError(`OpenAI (${res.status}) : ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? "").trim(), speakers: false };
}

type DeepgramResponse = {
  results?: {
    channels?: {
      alternatives?: { transcript?: string; paragraphs?: { paragraphs?: { speaker?: number; sentences?: { text: string }[] }[] } }[];
    }[];
  };
};

async function deepgram(audio: Buffer, mime: string, language: string): Promise<TranscriptionResult> {
  const params = new URLSearchParams({
    model: env.ai.deepgramModel,
    language: language.slice(0, 2),
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    paragraphs: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${env.ai.deepgramKey}`, "Content-Type": mime },
    body: new Uint8Array(audio),
  });
  if (!res.ok) throw new TranscriptionError(`Deepgram (${res.status}) : ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as DeepgramResponse;
  const alt = json.results?.channels?.[0]?.alternatives?.[0];
  const paragraphs = alt?.paragraphs?.paragraphs ?? [];
  const speakers = new Set(paragraphs.map((p) => p.speaker));
  if (paragraphs.length && speakers.size > 1) {
    return {
      text: paragraphs.map((p) => `Interlocuteur ${(p.speaker ?? 0) + 1} : ${(p.sentences ?? []).map((s) => s.text).join(" ")}`).join("\n"),
      speakers: true,
    };
  }
  return { text: (alt?.transcript ?? "").trim(), speakers: false };
}

export async function transcribeAudio(audio: Buffer, mime: string, language = "fr"): Promise<TranscriptionResult> {
  if (audio.byteLength < 1000) return { text: "", speakers: false };
  const provider = env.ai.transcriptionProvider;
  const cleanMime = mime.split(";")[0]!.trim() || "audio/webm";
  switch (provider) {
    case "elevenlabs":
      return elevenlabs(audio, cleanMime, language);
    case "openai":
      if (audio.byteLength > 25 * 1024 * 1024) throw new TranscriptionError("Fichier trop volumineux pour OpenAI (25 Mo max).");
      return openai(audio, cleanMime, language);
    case "deepgram":
      return deepgram(audio, cleanMime, language);
    default:
      throw new TranscriptionError(
        "Aucun service de transcription configuré (ELEVENLABS_API_KEY, OPENAI_API_KEY ou DEEPGRAM_API_KEY). La transcription du navigateur reste disponible.",
      );
  }
}
