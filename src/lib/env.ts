/**
 * Accès centralisé à la configuration (variables d'environnement).
 * Les valeurs sont lues à la demande pour ne pas bloquer le build quand une intégration
 * optionnelle n'est pas configurée.
 */

function read(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function bool(name: string, fallback: boolean): boolean {
  const v = read(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  get appUrl(): string {
    return (read("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  get timezone(): string {
    return read("APP_TIMEZONE") ?? "Europe/Paris";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get encryptionKey(): string | undefined {
    return read("ENCRYPTION_KEY");
  },
  get cronSecret(): string | undefined {
    return read("CRON_SECRET");
  },
  /** internal : le planificateur tourne dans le serveur Next ; external : via /api/cron/tick ou `npm run worker` */
  get schedulerMode(): "internal" | "external" {
    return read("SCHEDULER_MODE") === "external" ? "external" : "internal";
  },
  /** live : envoi réel ; log : les emails sont enregistrés mais pas envoyés (développement) */
  get emailDelivery(): "live" | "log" {
    const v = read("EMAIL_DELIVERY");
    if (v === "log" || v === "live") return v;
    return process.env.NODE_ENV === "production" ? "live" : "log";
  },
  google: {
    get clientId() {
      return read("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return read("GOOGLE_CLIENT_SECRET");
    },
    get configured() {
      return Boolean(read("GOOGLE_CLIENT_ID") && read("GOOGLE_CLIENT_SECRET"));
    },
    /** Active la récupération des transcriptions Google Meet (Workspace) */
    get meetTranscripts() {
      return bool("GOOGLE_MEET_TRANSCRIPTS", true);
    },
  },
  smtp: {
    get host() {
      return read("SMTP_HOST");
    },
    get port() {
      return Number(read("SMTP_PORT") ?? 587);
    },
    get secure() {
      return bool("SMTP_SECURE", Number(read("SMTP_PORT") ?? 587) === 465);
    },
    get user() {
      return read("SMTP_USER");
    },
    get password() {
      return read("SMTP_PASSWORD");
    },
    get from() {
      return read("SMTP_FROM");
    },
    get configured() {
      return Boolean(read("SMTP_HOST") && read("SMTP_FROM"));
    },
  },
  ai: {
    get anthropicKey() {
      return read("ANTHROPIC_API_KEY");
    },
    get model() {
      return read("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
    },
    get configured() {
      return Boolean(read("ANTHROPIC_API_KEY") || read("ANTHROPIC_AUTH_TOKEN"));
    },
    get transcriptionProvider(): "openai" | "elevenlabs" | "deepgram" | undefined {
      const v = read("TRANSCRIPTION_PROVIDER");
      if (v === "openai" || v === "elevenlabs" || v === "deepgram") return v;
      if (read("ELEVENLABS_API_KEY")) return "elevenlabs";
      if (read("OPENAI_API_KEY")) return "openai";
      if (read("DEEPGRAM_API_KEY")) return "deepgram";
      return undefined;
    },
    get openaiKey() {
      return read("OPENAI_API_KEY");
    },
    get openaiTranscriptionModel() {
      return read("OPENAI_TRANSCRIPTION_MODEL") ?? "gpt-4o-transcribe";
    },
    get elevenlabsKey() {
      return read("ELEVENLABS_API_KEY");
    },
    get elevenlabsModel() {
      return read("ELEVENLABS_STT_MODEL") ?? "scribe_v2";
    },
    get deepgramKey() {
      return read("DEEPGRAM_API_KEY");
    },
    get deepgramModel() {
      return read("DEEPGRAM_MODEL") ?? "nova-3";
    },
  },
  shopify: {
    get apiVersion() {
      return read("SHOPIFY_API_VERSION") ?? "2026-10";
    },
    get clientId() {
      return read("SHOPIFY_CLIENT_ID");
    },
    get clientSecret() {
      return read("SHOPIFY_CLIENT_SECRET");
    },
  },
};
