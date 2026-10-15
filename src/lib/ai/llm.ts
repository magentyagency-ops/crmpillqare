import * as z from "zod/v4";
import { env } from "@/lib/env";

/**
 * Appels au modèle de langage pour les fonctions de rédaction et d'analyse du CRM.
 * Fournisseur : OpenAI si OPENAI_API_KEY est défini, sinon Anthropic (Claude).
 * Les réponses sont structurées (schéma JSON strict) puis validées.
 */

export type LlmTier = "fast" | "smart";

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export function llmAvailable(): boolean {
  return Boolean(env.ai.openaiKey || env.ai.configured);
}

export function llmProviderLabel(): string | null {
  if (env.ai.openaiKey) return `OpenAI (${openaiModel("fast")} / ${openaiModel("smart")})`;
  if (env.ai.configured) return `Anthropic (${env.ai.model})`;
  return null;
}

export function openaiModel(tier: LlmTier) {
  return tier === "smart" ? (process.env.OPENAI_SMART_MODEL?.trim() || "gpt-5.5") : (process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini");
}

/** Schéma JSON compatible avec le mode strict d'OpenAI (sans $schema ni bornes numériques). */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema" || k === "minimum" || k === "maximum" || k === "exclusiveMinimum" || k === "exclusiveMaximum" || k === "default") continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(json) as Record<string, unknown>;
}

async function callOpenAI(opts: { tier: LlmTier; system: string; user: string; schema: z.ZodType; name: string; timeoutMs: number }): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${env.ai.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: openaiModel(opts.tier),
          reasoning_effort: opts.tier === "smart" ? "medium" : "low",
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: strictSchema(opts.schema) } },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
      };
      if (res.status === 429 || res.status >= 500) {
        lastError = json.error?.message ?? `HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new LlmError(res.status === 401 ? "Clé OpenAI invalide ou révoquée." : `OpenAI : ${json.error?.message ?? res.statusText}`);
      const choice = json.choices?.[0];
      if (choice?.message?.refusal) throw new LlmError("L'IA a refusé de traiter cette demande.");
      if (choice?.finish_reason === "length") throw new LlmError("Réponse de l'IA tronquée : réessayez avec un texte plus court.");
      return JSON.parse(choice?.message?.content ?? "null");
    } catch (error) {
      if (error instanceof LlmError) throw error;
      lastError = error instanceof Error ? (error.name === "AbortError" ? "délai dépassé" : error.message) : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new LlmError(`Service IA indisponible (${lastError}). Réessayez dans un instant.`);
}

async function callAnthropic(opts: { system: string; user: string; schema: z.ZodType }): Promise<unknown> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const message = await client.beta.messages.create({
    model: env.ai.model,
    max_tokens: 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: "low", format: betaZodOutputFormat(opts.schema as never) },
  } as never);
  const m = message as unknown as { stop_reason?: string; parsed_output?: unknown };
  if (m.stop_reason === "refusal") throw new LlmError("L'IA a refusé de traiter cette demande.");
  return m.parsed_output;
}

/** Génère une réponse structurée validée par `schema`. */
export async function llmJson<T>(opts: { tier?: LlmTier; system: string; user: string; schema: z.ZodType<T>; name: string; timeoutMs?: number }): Promise<T> {
  if (!llmAvailable()) throw new LlmError("Aucun service IA configuré (OPENAI_API_KEY ou ANTHROPIC_API_KEY).");
  const tier = opts.tier ?? "fast";
  const raw = env.ai.openaiKey
    ? await callOpenAI({ tier, system: opts.system, user: opts.user, schema: opts.schema, name: opts.name, timeoutMs: opts.timeoutMs ?? (tier === "smart" ? 180_000 : 60_000) })
    : await callAnthropic(opts);
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) throw new LlmError("Réponse de l'IA illisible : réessayez.");
  return parsed.data;
}
