import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { AI_KIND_LABELS, contactDisplayName, STAGE_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/dates";
import { llmAvailable, llmJson, LlmError } from "./llm";

/**
 * Compte rendu de RDV / appel généré par Claude à partir de la transcription :
 * résumé, besoins, objections, prochaines actions, email de suivi (à valider par le commercial).
 */

const STAGES = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"] as const;
const ACTION_TYPES = ["CALL", "EMAIL", "MEETING", "QUOTE", "TRIAL", "TASK"] as const;

export const MeetingReportSchema = z.object({
  summary: z.string().describe("Résumé factuel de l'échange en 4 à 8 phrases, en français."),
  keyPoints: z.array(z.string()).describe("Points clés abordés (phrases courtes)."),
  needs: z.array(z.string()).describe("Besoins exprimés ou identifiés chez le prospect / client."),
  objections: z
    .array(
      z.object({
        objection: z.string().describe("Objection ou frein exprimé."),
        response: z.string().describe("Réponse apportée par le commercial pendant l'échange (vide si aucune)."),
        resolved: z.boolean().describe("true si l'objection semble levée à la fin de l'échange."),
      }),
    )
    .describe("Objections et freins."),
  nextActions: z
    .array(
      z.object({
        title: z.string().describe("Action concrète, commençant par un verbe."),
        owner: z.enum(["commercial", "client"]).describe("Qui doit réaliser l'action."),
        type: z.enum(ACTION_TYPES),
        dueInDays: z.number().int().nullable().describe("Échéance en jours ouvrés à partir d'aujourd'hui si elle est mentionnée ou évidente, sinon null."),
      }),
    )
    .describe("Prochaines actions convenues ou nécessaires."),
  decisionMakers: z.array(z.string()).describe("Décideurs / personnes impliquées dans la décision mentionnés."),
  budget: z.string().nullable().describe("Budget évoqué, sinon null."),
  timeline: z.string().nullable().describe("Calendrier / délai de décision évoqué, sinon null."),
  quantities: z.string().nullable().describe("Volumes évoqués (nombre de piluliers, de patients, de résidents…), sinon null."),
  competitors: z.array(z.string()).describe("Concurrents ou solutions actuelles mentionnés."),
  risks: z.array(z.string()).describe("Risques ou points de vigilance pour la suite."),
  interestLevel: z.number().int().describe("Niveau d'intérêt du prospect de 1 (faible) à 5 (très fort)."),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  suggestedStage: z.enum(STAGES).nullable().describe("Étape du pipeline suggérée après cet échange, ou null si inchangée."),
  followUpEmail: z
    .object({
      subject: z.string().describe("Objet de l'email de suivi."),
      body: z.string().describe("Corps de l'email de suivi en texte brut, sans signature."),
    })
    .describe("Email de suivi à envoyer au contact après l'échange."),
});

export type MeetingReport = z.infer<typeof MeetingReportSchema>;

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  return client;
}

/** IA disponible : OpenAI (prioritaire) ou Claude. */
export function aiAvailable(): boolean {
  return llmAvailable();
}

const SYSTEM_PROMPT = `Tu es l'assistant commercial du CRM de PillQare. Tu rédiges le compte rendu d'un échange commercial (appel, visio ou rendez-vous physique) à partir de sa transcription, pour le commercial qui l'a mené.

Règles :
- Écris en français, de façon claire et professionnelle.
- Sois fidèle à la transcription : n'invente aucun fait, chiffre, prix, engagement ou date. Si une information n'apparaît pas, laisse le champ vide (liste vide ou null).
- La transcription peut contenir des erreurs de reconnaissance vocale : interprète-les avec bon sens sans extrapoler.
- Les prochaines actions doivent être concrètes et actionnables ; distingue celles du commercial et celles du client.
- L'étape suggérée suit le pipeline : PROSPECT (prospect), CONTACTED (contacté), MEETING (RDV réalisé / à planifier), QUOTE (devis à faire ou envoyé), FOLLOW_UP (relance / réflexion), WON (signé), LOST (refusé). Ne propose WON ou LOST que si c'est explicite.
- L'email de suivi s'adresse au contact : il remercie pour l'échange, récapitule brièvement les points importants et les prochaines étapes convenues, sans promesse non évoquée. Commence par une formule d'appel adaptée (« Bonjour Prénom, »), n'ajoute pas de signature (elle est ajoutée automatiquement). Texte brut, paragraphes courts.`;

function clampInterest(n: number) {
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** Génère (ou régénère) le compte rendu IA d'une session. */
export async function generateReport(sessionId: string): Promise<MeetingReport> {
  if (!aiAvailable()) throw new Error("L'IA n'est pas configurée (OPENAI_API_KEY ou ANTHROPIC_API_KEY manquant).");
  const session = await db.aiSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      user: { select: { firstName: true, lastName: true } },
      contact: {
        include: {
          company: { select: { name: true } },
          segment: { select: { name: true } },
        },
      },
      deal: { select: { title: true, stage: true } },
      meeting: { select: { title: true, startAt: true, type: true } },
    },
  });
  const transcript = (session.transcript ?? "").trim();
  if (transcript.length < 40) throw new Error("La transcription est trop courte pour générer un compte rendu.");

  await db.aiSession.update({
    where: { id: sessionId },
    data: { status: "ANALYZING", error: null },
  });
  try {
    const settings = await getSettings("ai");
    const history = session.contactId
      ? await db.activity.findMany({
          where: {
            contactId: session.contactId,
            type: {
              in: ["CALL", "MEETING_REPORT", "NOTE", "EMAIL_RECEIVED", "QUOTE_SENT", "STAGE_CHANGED"],
            },
          },
          orderBy: { occurredAt: "desc" },
          take: 6,
          select: { title: true, occurredAt: true },
        })
      : [];
    const context = [
      `Date du jour : ${formatDate(new Date(), "EEEE d MMMM yyyy")} (pour convertir « lundi », « la semaine prochaine »… en nombre de jours ouvrés).`,
      `Entreprise et offre : ${settings.productContext}`,
      `Ton souhaité pour l'email de suivi : ${settings.followUpTone}.`,
      `Type d'échange : ${AI_KIND_LABELS[session.kind]}${session.meeting ? ` — « ${session.meeting.title} » le ${formatDateTime(session.meeting.startAt)}` : ""}.`,
      `Commercial : ${session.user.firstName} ${session.user.lastName}.`,
      session.contact
        ? `Contact : ${contactDisplayName(session.contact)}${session.contact.jobTitle ? `, ${session.contact.jobTitle}` : ""}${session.contact.company ? `, ${session.contact.company.name}` : ""}${session.contact.segment ? ` (cible : ${session.contact.segment.name})` : ""} — ${session.contact.kind === "B2B" ? "professionnel" : "particulier"}.`
        : "Contact : non renseigné.",
      session.deal ? `Dossier : « ${session.deal.title} », étape actuelle : ${STAGE_LABELS[session.deal.stage]}.` : null,
      history.length ? `Historique récent :\n${history.map((h) => `- ${h.occurredAt.toISOString().slice(0, 10)} : ${h.title}`).join("\n")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const userContent = `<contexte>\n${context}\n</contexte>\n\n<transcription>\n${transcript}\n</transcription>\n\nRédige le compte rendu structuré de cet échange.`;
    let parsed: MeetingReport | null | undefined;
    let modelUsed = env.ai.model;
    if (env.ai.openaiKey) {
      parsed = await llmJson({
        tier: "smart",
        name: "compte_rendu",
        schema: MeetingReportSchema,
        system: SYSTEM_PROMPT,
        user: userContent,
        timeoutMs: 300_000,
      });
      modelUsed = process.env.OPENAI_SMART_MODEL?.trim() || "gpt-5.5";
    } else {
      const stream = anthropic().beta.messages.stream({
        model: env.ai.model,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: {
          effort: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "high",
          format: betaZodOutputFormat(MeetingReportSchema),
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new Error("L'IA n'a pas pu traiter cette transcription. Rédigez le compte rendu manuellement.");
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("Compte rendu tronqué (transcription trop longue). Réessayez ou découpez l'échange.");
      }
      parsed = message.parsed_output as MeetingReport | null | undefined;
      modelUsed = message.model;
    }
    if (!parsed) throw new Error("Réponse de l'IA illisible. Réessayez.");
    const report: MeetingReport = {
      ...parsed,
      interestLevel: clampInterest(parsed.interestLevel),
    };

    await db.aiSession.update({
      where: { id: sessionId },
      data: {
        status: "READY",
        report,
        summary: report.summary,
        followUpSubject: report.followUpEmail.subject,
        followUpBody: report.followUpEmail.body,
        followUpTo: session.contact?.email ?? null,
        model: modelUsed,
        error: null,
      },
    });
    await notify({
      userId: session.userId,
      type: "REPORT_READY",
      title: `Compte rendu prêt à valider${session.contact ? ` : ${contactDisplayName(session.contact)}` : ""}`,
      body: report.summary.slice(0, 200),
      link: `/assistant/${sessionId}`,
    });
    return report;
  } catch (error) {
    const message =
      error instanceof LlmError
        ? error.message
        : error instanceof Anthropic.AuthenticationError
          ? "Clé API Anthropic invalide."
          : error instanceof Anthropic.RateLimitError
            ? "Limite de requêtes IA atteinte, réessayez dans quelques minutes."
            : error instanceof Anthropic.APIError
              ? `Erreur du service IA (${error.status ?? "réseau"}) : ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
    await db.aiSession.update({
      where: { id: sessionId },
      data: { status: "FAILED", error: message },
    });
    throw new Error(message);
  }
}
