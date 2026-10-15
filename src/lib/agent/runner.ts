import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { SessionUser } from "@/lib/auth/session";
import { formatDate, timeKey } from "@/lib/dates";
import { openaiModel } from "@/lib/ai/llm";
import { TOOLS, toolDefinitions, type ToolName, type ToolResult } from "./tools";

/**
 * Copilote : boucle « modèle → outils → modèle » (OpenAI, appels de fonctions).
 * Les outils sensibles s'arrêtent sur une demande de confirmation, reprise par `resolvePending`.
 */

/** Éléments d'historique de l'API Responses (messages, raisonnements chiffrés, appels et résultats d'outils). */
type ChatMessage =
  | { role: "user"; content: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: string; [key: string]: unknown };
type FunctionCall = { type: "function_call"; call_id: string; name: string; arguments: string };

export type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "action"; ok: boolean; text: string; link?: string }
  | { kind: "confirm"; items: { id: string; text: string }[]; status: "pending" | "approved" | "rejected" };

type Pending = { calls: { id: string; name: ToolName; args: unknown; text: string }[] };

const MAX_STEPS = 12;
const BUSY_MS = 4 * 60_000;

function systemPrompt(user: SessionUser, pagePath: string | null) {
  const now = new Date();
  const tz = user.timezone;
  return `Tu es le copilote du CRM commercial de PillQare, utilisé par ${user.firstName} ${user.lastName} (${user.role === "SALES" ? "commercial" : user.role === "MANAGER" ? "manager" : "administrateur"}, ${user.email}).
Tu pilotes le CRM grâce à tes outils : tu peux rechercher, consulter, créer, modifier, planifier, envoyer et analyser. Agis directement : enchaîne les outils nécessaires sans demander de permission pour les étapes intermédiaires.

Date et heure actuelles : ${formatDate(now, "EEEE d MMMM yyyy", tz)} à ${timeKey(now, tz)} (heure de Paris). Dates attendues par les outils : « AAAA-MM-JJ » ou « AAAA-MM-JJTHH:mm », heure de Paris.
${pagePath ? `L'utilisateur regarde actuellement la page ${pagePath} (un identifiant dans l'adresse désigne le contact, le dossier, le devis ou le RDV affiché : « ce contact », « ce dossier »…).` : ""}

Règles :
- Réponds en français, de façon brève et concrète, en vouvoyant l'utilisateur (sauf s'il te tutoie). Après une action, confirme ce qui a été fait avec un lien Markdown vers l'élément, ex. [Voir la fiche](/contacts/ID).
- N'invente jamais d'identifiant : retrouve-les avec « rechercher », « voir_contact », « lister_… » ou « referentiels ».
- Si une demande est ambiguë (plusieurs contacts possibles, information indispensable manquante), pose UNE question courte au lieu de deviner. Sinon, choisis des valeurs par défaut raisonnables et dis-le.
- Les envois vers l'extérieur et les suppressions (emails, séries de relances, devis, RDV avec confirmation, annulations, archivage) déclenchent une demande de confirmation dans l'interface : appelle simplement l'outil, ne demande pas toi-même « voulez-vous que… ».
- Quand tu rédiges un email : français soigné, vouvoiement, personnalisé avec ce que tu sais du contact, court, sans signature (ajoutée automatiquement), « {{contact.greeting}} » pour la formule d'appel dans les relances.
- Une relance « toutes les X minutes » nécessite heuresOuvreesUniquement = false.
- Pour les questions d'analyse (« où en est… », « quels dossiers… »), consulte les données avant de répondre ; cite des chiffres réels.`;
}

async function callModel(messages: ChatMessage[], system: string) {
  const tools = (await toolDefinitions()).map((t) => ({ type: "function", name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: true }));
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_AGENT_MODEL?.trim() || openaiModel("smart"),
      instructions: system,
      input: messages,
      tools,
      parallel_tool_calls: true,
      reasoning: { effort: "low" },
      // Rien n'est conservé chez OpenAI : le raisonnement chiffré est renvoyé à chaque tour
      store: false,
      include: ["reasoning.encrypted_content"],
    }),
    signal: AbortSignal.timeout(150_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; output?: { type: string; [key: string]: unknown }[] };
  if (!res.ok) throw new Error(res.status === 401 ? "Clé OpenAI invalide." : `Service IA : ${json.error?.message ?? res.statusText}`);
  const output = json.output ?? [];
  const calls = output.filter((o) => o.type === "function_call") as unknown as FunctionCall[];
  const text = output
    .filter((o) => o.type === "message")
    .flatMap((o) => ((o as { content?: { type: string; text?: string }[] }).content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? ""))
    .join("\n")
    .trim();
  return { output, calls, text };
}

function parseArgs(name: ToolName, raw: string) {
  const parsed = TOOLS[name].schema.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) throw new Error(`Paramètres invalides : ${parsed.error.issues[0]?.message ?? "erreur"}`);
  return parsed.data;
}

async function execute(name: ToolName, args: unknown, user: SessionUser): Promise<ToolResult> {
  try {
    // @ts-expect-error — l'outil et ses arguments ont été validés ensemble
    return await TOOLS[name].run(args, { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { ok: false, summary: message };
  }
}

const toolMessage = (id: string, r: ToolResult): ChatMessage => ({
  type: "function_call_output",
  call_id: id,
  output: JSON.stringify({ ok: r.ok, resultat: r.summary, lien: r.link ?? null, donnees: r.data ?? null }).slice(0, 12_000),
});

/** Fait tourner le copilote jusqu'à une réponse finale ou une demande de confirmation. */
async function loop(messages: ChatMessage[], display: DisplayItem[], user: SessionUser, pagePath: string | null): Promise<Pending | null> {
  const system = systemPrompt(user, pagePath);
  for (let step = 0; step < MAX_STEPS; step++) {
    const { output, calls, text } = await callModel(messages, system);
    messages.push(...output);
    if (text && calls.length) display.push({ kind: "assistant", text });
    if (!calls.length) {
      display.push({ kind: "assistant", text: text || "C'est fait." });
      return null;
    }
    const pending: Pending = { calls: [] };
    for (const fc of calls) {
      const call = { id: fc.call_id };
      const name = fc.name as ToolName;
      if (!(name in TOOLS)) {
        messages.push(toolMessage(call.id, { ok: false, summary: `Outil inconnu : ${name}` }));
        continue;
      }
      let args: unknown;
      try {
        args = parseArgs(name, fc.arguments);
      } catch (error) {
        messages.push(toolMessage(call.id, { ok: false, summary: error instanceof Error ? error.message : "Arguments illisibles" }));
        continue;
      }
      const def = TOOLS[name] as { confirm?: (a: unknown, c: { user: SessionUser }) => Promise<string | null> | string | null };
      let confirmText: string | null = null;
      try {
        confirmText = def.confirm ? await def.confirm(args, { user }) : null;
      } catch (error) {
        messages.push(toolMessage(call.id, { ok: false, summary: error instanceof Error ? error.message : String(error) }));
        continue;
      }
      if (confirmText) {
        pending.calls.push({ id: call.id, name, args, text: confirmText });
        continue;
      }
      const result = await execute(name, args, user);
      messages.push(toolMessage(call.id, result));
      // Les consultations ne s'affichent qu'en cas d'erreur ; les actions sont toujours tracées
      if (!(TOOLS[name] as { readOnly?: boolean }).readOnly || !result.ok) display.push({ kind: "action", ok: result.ok, text: result.summary, link: result.link });
    }
    if (pending.calls.length) {
      display.push({ kind: "confirm", items: pending.calls.map((c) => ({ id: c.id, text: c.text })), status: "pending" });
      return pending;
    }
  }
  display.push({ kind: "assistant", text: "J'ai atteint la limite d'actions pour cette demande. Dites-moi si je dois continuer." });
  return null;
}

async function lock(conversationId: string) {
  const res = await db.agentConversation.updateMany({
    where: { id: conversationId, OR: [{ busyUntil: null }, { busyUntil: { lt: new Date() } }] },
    data: { busyUntil: new Date(Date.now() + BUSY_MS) },
  });
  if (!res.count) throw new Error("Le copilote traite déjà une demande dans cette conversation.");
}

async function save(id: string, messages: ChatMessage[], display: DisplayItem[], pending: Pending | null, extra: Prisma.AgentConversationUpdateInput = {}) {
  return db.agentConversation.update({
    where: { id },
    data: { messages: messages as unknown as Prisma.InputJsonValue, display: display as unknown as Prisma.InputJsonValue, pending: pending ? (pending as unknown as Prisma.InputJsonValue) : Prisma.DbNull, busyUntil: null, ...extra },
  });
}

export async function sendMessage(user: SessionUser, conversationId: string | null, text: string, pagePath: string | null) {
  const conv = conversationId
    ? await db.agentConversation.findFirst({ where: { id: conversationId, userId: user.id } })
    : await db.agentConversation.create({ data: { userId: user.id, title: text.slice(0, 80) } });
  if (!conv) throw new Error("Conversation introuvable.");
  if (conv.pending) throw new Error("Confirmez ou annulez d'abord l'action en attente.");
  await lock(conv.id);
  const messages = conv.messages as unknown as ChatMessage[];
  const display = conv.display as unknown as DisplayItem[];
  messages.push({ role: "user", content: text });
  display.push({ kind: "user", text });
  try {
    const pending = await loop(messages, display, user, pagePath);
    return await save(conv.id, messages, display, pending);
  } catch (error) {
    display.push({ kind: "assistant", text: `⚠️ ${error instanceof Error ? error.message : "Erreur inattendue"}` });
    // Message utilisateur conservé ; les appels d'outils inachevés sont retirés pour garder un historique valide
    while (messages.length && (messages[messages.length - 1] as { role?: string }).role !== "user") messages.pop();
    return save(conv.id, messages, display, null);
  }
}

export async function resolvePending(user: SessionUser, conversationId: string, approve: boolean, pagePath: string | null) {
  const conv = await db.agentConversation.findFirst({ where: { id: conversationId, userId: user.id } });
  if (!conv?.pending) throw new Error("Aucune action en attente.");
  await lock(conv.id);
  const messages = conv.messages as unknown as ChatMessage[];
  const display = conv.display as unknown as DisplayItem[];
  const pending = conv.pending as unknown as Pending;
  const card = [...display].reverse().find((d): d is Extract<DisplayItem, { kind: "confirm" }> => d.kind === "confirm" && d.status === "pending");
  if (card) card.status = approve ? "approved" : "rejected";
  try {
    for (const call of pending.calls) {
      if (!approve) {
        messages.push(toolMessage(call.id, { ok: false, summary: "Action annulée par l'utilisateur." }));
        continue;
      }
      const result = await execute(call.name, call.args, user);
      messages.push(toolMessage(call.id, result));
      display.push({ kind: "action", ok: result.ok, text: result.summary, link: result.link });
    }
    const next = await loop(messages, display, user, pagePath);
    return await save(conv.id, messages, display, next);
  } catch (error) {
    display.push({ kind: "assistant", text: `⚠️ ${error instanceof Error ? error.message : "Erreur inattendue"}` });
    return save(conv.id, messages, display, null);
  }
}
