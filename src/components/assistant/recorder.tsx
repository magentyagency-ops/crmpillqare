"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MonitorSpeaker, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { addTextSegmentAction, finalizeSessionAction } from "@/actions/assistant";

const SEGMENT_MS = 20_000;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

type Segment = { index: number; text: string; status: "uploading" | "DONE" | "FAILED" | "PENDING"; error?: string | null };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Recorder({ sessionId, kind, serverTranscription }: { sessionId: string; kind: "CALL" | "VIDEO" | "IN_PERSON"; serverTranscription: boolean }) {
  const router = useRouter();
  const engine: "server" | "browser" = serverTranscription ? "server" : "browser";
  const [phase, setPhase] = useState<"idle" | "recording" | "paused" | "stopping">("idle");
  const [captureTab, setCaptureTab] = useState(kind === "VIDEO" && engine === "server");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [notes, setNotes] = useState("");

  const streams = useRef<MediaStream[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const mixed = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafId = useRef<number | null>(null);
  const segIndex = useRef(0);
  const startedAt = useRef(0);
  const accumulated = useRef(0);
  const segmentStart = useRef(0);
  const uploads = useRef<Promise<unknown>[]>([]);
  const speech = useRef<SpeechRecognitionLike | null>(null);
  const active = useRef(false);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const mime = useRef(pickMime());

  const upsertSegment = (s: Segment) =>
    setSegments((list) => {
      const others = list.filter((x) => x.index !== s.index);
      return [...others, s].sort((a, b) => a.index - b.index);
    });

  const upload = useCallback(
    (blob: Blob, index: number, offsetMs: number, durationMs: number) => {
      if (blob.size < 2000) return;
      upsertSegment({ index, text: "", status: "uploading" });
      const p = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const fd = new FormData();
            fd.append("audio", blob, `segment-${index}.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
            fd.append("index", String(index));
            fd.append("offsetMs", String(offsetMs));
            fd.append("durationMs", String(durationMs));
            const res = await fetch(`/api/assistant/${sessionId}/segment`, { method: "POST", body: fd });
            const json = (await res.json()) as { text?: string; status?: Segment["status"]; error?: string | null };
            if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
            upsertSegment({ index, text: json.text ?? "", status: json.status ?? "DONE", error: json.error });
            return;
          } catch (error) {
            if (attempt === 2) upsertSegment({ index, text: "", status: "FAILED", error: error instanceof Error ? error.message : String(error) });
            else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      })();
      uploads.current.push(p);
    },
    [sessionId],
  );

  const startSegment = useCallback(() => {
    if (!mixed.current || !active.current) return;
    const rec = new MediaRecorder(mixed.current, mime.current ? { mimeType: mime.current, audioBitsPerSecond: 48_000 } : undefined);
    const chunks: Blob[] = [];
    const index = segIndex.current++;
    const offset = accumulated.current + (Date.now() - startedAt.current);
    segmentStart.current = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => upload(new Blob(chunks, { type: rec.mimeType || mime.current || "audio/webm" }), index, offset, Date.now() - segmentStart.current);
    rec.start();
    recorder.current = rec;
  }, [upload]);

  const startSpeech = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) {
            const index = segIndex.current++;
            upsertSegment({ index, text, status: "DONE" });
            uploads.current.push(addTextSegmentAction(sessionId, index, text, accumulated.current + (Date.now() - startedAt.current)));
          }
        } else interimText += ` ${text}`;
      }
      setInterim(interimText.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast.error("Reconnaissance vocale refusée par le navigateur.");
    };
    rec.onend = () => {
      if (active.current) {
        try {
          rec.start();
        } catch {
          // déjà relancée
        }
      }
    };
    rec.start();
    speech.current = rec;
    return true;
  }, [sessionId]);

  const meter = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      rafId.current = requestAnimationFrame(loop);
    };
    loop();
  }, []);

  /** Démarre la capture : segments audio tournants (transcription serveur) ou reconnaissance vocale du navigateur. */
  const startCapture = () => {
    if (engine !== "server") {
      startSpeech();
      return;
    }
    startSegment();
    rotateTimer.current = setInterval(() => {
      if (!active.current) return;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      startSegment();
    }, SEGMENT_MS);
  };

  const begin = async () => {
    try {
      if (engine === "browser" && !speechRecognitionCtor()) {
        toast.error("Ce navigateur ne propose pas la reconnaissance vocale. Utilisez Chrome/Edge, ou configurez un service de transcription.");
        return;
      }
      if (engine === "server" && typeof MediaRecorder === "undefined") {
        toast.error("Ce navigateur ne permet pas l'enregistrement audio.");
        return;
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streams.current = [mic];
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const micSource = ctx.createMediaStreamSource(mic);
      micSource.connect(dest);
      micSource.connect(analyser);
      if (captureTab && engine === "server") {
        try {
          const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          streams.current.push(display);
          const tabAudio = display.getAudioTracks();
          if (tabAudio.length === 0) {
            toast.warning("Le son de l'onglet n'a pas été partagé : seule votre voix sera enregistrée. Cochez « Partager l'audio de l'onglet ».");
          } else {
            const tabSource = ctx.createMediaStreamSource(new MediaStream(tabAudio));
            tabSource.connect(dest);
            tabSource.connect(analyser);
          }
          display.getVideoTracks().forEach((t) => (t.enabled = false));
        } catch {
          toast.warning("Partage de l'onglet annulé : seule votre voix sera enregistrée.");
        }
      }
      mixed.current = dest.stream;
      meter(analyser);
      active.current = true;
      startedAt.current = Date.now();
      startCapture();
      tickTimer.current = setInterval(() => setElapsed(accumulated.current + (Date.now() - startedAt.current)), 500);
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        // non supporté
      }
      setPhase("recording");
    } catch (error) {
      toast.error(error instanceof Error && error.name === "NotAllowedError" ? "Accès au micro refusé : autorisez le micro pour ce site." : "Impossible de démarrer l'enregistrement.");
    }
  };

  const haltCapture = () => {
    if (rotateTimer.current) clearInterval(rotateTimer.current);
    rotateTimer.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    recorder.current = null;
    if (speech.current) {
      speech.current.onend = null;
      speech.current.stop();
      speech.current = null;
    }
  };

  const pause = () => {
    active.current = false;
    haltCapture();
    accumulated.current += Date.now() - startedAt.current;
    if (tickTimer.current) clearInterval(tickTimer.current);
    setPhase("paused");
  };

  const resume = () => {
    active.current = true;
    startedAt.current = Date.now();
    startCapture();
    tickTimer.current = setInterval(() => setElapsed(accumulated.current + (Date.now() - startedAt.current)), 500);
    setPhase("recording");
  };

  const releaseAll = () => {
    active.current = false;
    haltCapture();
    if (tickTimer.current) clearInterval(tickTimer.current);
    if (rafId.current) cancelAnimationFrame(rafId.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    audioCtx.current?.close().catch(() => undefined);
    wakeLock.current?.release().catch(() => undefined);
  };

  const stop = async () => {
    const wasRecording = phase === "recording";
    if (wasRecording) accumulated.current += Date.now() - startedAt.current;
    setPhase("stopping");
    releaseAll();
    // Attend la fin des envois (le dernier segment est envoyé à l'arrêt de l'enregistreur)
    await new Promise((r) => setTimeout(r, 400));
    await Promise.allSettled(uploads.current);
    const res = await finalizeSessionAction(sessionId, { durationSec: Math.round(accumulated.current / 1000), extraNotes: notes || null });
    if (!res.ok) {
      toast.error(res.error);
      setPhase("paused");
      return;
    }
    router.push(`/assistant/${sessionId}`);
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (active.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      releaseAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcript = segments.filter((s) => s.text).map((s) => s.text);
  const failed = segments.filter((s) => s.status === "FAILED").length;
  const uploading = segments.filter((s) => s.status === "uploading").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 rounded-xl bg-card p-6 surface">
        <div className="text-4xl font-bold tabular-nums text-brand-navy">{formatElapsed(elapsed)}</div>
        <div className="h-2 w-64 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-[width] duration-75", phase === "recording" ? "bg-emerald-500" : "bg-slate-300")} style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">
          {engine === "server" ? "Transcription par segments de 20 secondes" : "Reconnaissance vocale du navigateur (votre micro uniquement)"}
          {uploading > 0 && ` · ${uploading} segment(s) en cours de transcription`}
          {failed > 0 && <span className="text-rose-600"> · {failed} segment(s) non transcrit(s)</span>}
        </div>
        {phase === "idle" && (
          <>
            {kind === "VIDEO" && engine === "server" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={captureTab} onCheckedChange={(c) => setCaptureTab(Boolean(c))} />
                <MonitorSpeaker className="size-4" /> Capturer aussi le son de la visio (onglet Google Meet, Teams…)
              </label>
            )}
            <Button size="lg" onClick={begin} className="rounded-full px-8">
              <Mic /> Démarrer l&apos;enregistrement
            </Button>
          </>
        )}
        {(phase === "recording" || phase === "paused") && (
          <div className="flex gap-2">
            {phase === "recording" ? (
              <Button variant="outline" onClick={pause}>
                <Pause /> Pause
              </Button>
            ) : (
              <Button variant="outline" onClick={resume}>
                <Play /> Reprendre
              </Button>
            )}
            <Button variant="destructive" onClick={stop}>
              <Square /> Terminer et générer le compte rendu
            </Button>
          </div>
        )}
        {phase === "stopping" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Finalisation de la transcription…
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-card p-4 surface">
          <div className="mb-2 text-sm font-semibold text-brand-navy">Transcription en direct</div>
          <div className="max-h-[50vh] min-h-48 space-y-2 overflow-y-auto text-sm leading-relaxed whitespace-pre-line">
            {transcript.length === 0 && !interim && <p className="text-muted-foreground">La transcription apparaîtra ici au fil de l&apos;échange.</p>}
            {transcript.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {interim && <p className="text-muted-foreground italic">{interim}</p>}
          </div>
        </div>
        <div className="rounded-xl bg-card p-4 surface">
          <div className="mb-2 text-sm font-semibold text-brand-navy">Vos notes (facultatif)</div>
          <Textarea rows={10} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Chiffres, noms, points à ne pas oublier… Ils seront pris en compte dans le compte rendu." />
        </div>
      </div>
    </div>
  );
}
