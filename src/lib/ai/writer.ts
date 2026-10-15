import * as z from "zod/v4";
import { db } from "@/lib/db";
import { stripQuotedReply } from "@/lib/email/text";
import { truncate } from "@/lib/format";
import { buildContactContext } from "./context";
import { llmJson } from "./llm";

/**
 * Rédaction assistée : emails personnalisés, réécritures, réponses suggérées,
 * personnalisation des relances automatiques et analyse d'une relation commerciale.
 */

const EmailSchema = z.object({
  subject: z.string().describe("Objet de l'email, court et précis (max 80 caractères), sans « Re: » sauf en réponse."),
  body: z.string().describe("Corps de l'email en texte brut, sans signature, paragraphes séparés par une ligne vide."),
});
export type AiEmail = z.infer<typeof EmailSchema>;

const RULES = `Règles impératives :
- Écris en français, au vouvoiement sauf indication contraire, avec un ton humain et naturel (pas de jargon marketing, pas de formules creuses comme « J'espère que vous allez bien »).
- Personnalise réellement : appuie-toi sur le contexte (cible, organisation, besoin exprimé, étape du dossier, derniers échanges). Ne répète pas mot pour mot les emails précédents.
- N'invente AUCUN fait : ni chiffre, ni prix, ni date, ni engagement, ni échange qui n'apparaît pas dans le contexte ou la demande. Prix et offres uniquement s'ils figurent dans le contexte.
- Court : 60 à 140 mots en général, un seul objectif clair et un appel à l'action simple.
- Commence par « Bonjour Prénom, » (ou « Bonjour Madame/Monsieur Nom, » si le prénom est inconnu). N'ajoute PAS de signature ni de nom à la fin : elle est ajoutée automatiquement. Termine par une formule courte (« Bien cordialement, »).
- Conserve tels quels les liens fournis (URL) et n'en invente pas d'autres.
- Texte brut uniquement (pas de Markdown, pas d'astérisques).`;

export type DraftOptions = {
  userId: string;
  contactId?: string | null;
  dealId?: string | null;
  /** Ce que le commercial veut dire / obtenir */
  instruction?: string | null;
  /** Brouillon existant à retravailler */
  draft?: { subject: string; body: string } | null;
  /** Retouche demandée sur le brouillon (plus court, plus chaleureux…) */
  rewrite?: "shorter" | "warmer" | "formal" | "fix" | "persuasive" | null;
  /** Email reçu auquel répondre */
  replyToEmailId?: string | null;
};

const REWRITES: Record<NonNullable<DraftOptions["rewrite"]>, string> = {
  shorter: "Raccourcis nettement le brouillon (au moins 40 % de moins) en gardant l'essentiel et l'appel à l'action.",
  warmer: "Rends le brouillon plus chaleureux et plus personnel, sans familiarité excessive.",
  formal: "Rends le brouillon plus formel et institutionnel (adapté à une direction d'établissement ou à une collectivité).",
  fix: "Corrige uniquement l'orthographe, la grammaire et la ponctuation, et fluidifie légèrement les phrases. Ne change ni le fond ni la longueur.",
  persuasive: "Rends le brouillon plus convaincant : bénéfice concret pour ce contact en premier, preuve ou argument adapté à sa cible, appel à l'action plus clair.",
};

/** Rédige, réécrit ou propose une réponse, à partir du contexte du contact. */
export async function draftEmail(opts: DraftOptions): Promise<AiEmail> {
  const ctx = await buildContactContext({ contactId: opts.contactId, dealId: opts.dealId, userId: opts.userId });
  const parts: string[] = [`<contexte>\n${ctx.text}\n${ctx.bookingUrl ? `Lien de prise de RDV du commercial : ${ctx.bookingUrl}` : ""}\n</contexte>`];

  if (opts.replyToEmailId) {
    const email = await db.emailMessage.findUnique({ where: { id: opts.replyToEmailId }, select: { subject: true, textBody: true, snippet: true, fromName: true, fromEmail: true, contactId: true } });
    if (email && !email.contactId && !opts.contactId && !opts.dealId) {
      // Correspondant hors CRM : simple réponse de messagerie, sans démarchage
      return llmJson({
        tier: "fast",
        name: "email",
        schema: EmailSchema,
        system: `Tu aides ${ctx.senderName ?? "l'utilisateur"} à répondre à ses emails. Français soigné, vouvoiement sauf si l'email reçu tutoie, ton naturel et courtois, réponse courte et utile. Réponds précisément aux questions ou demandes ; n'invente aucune information (si elle manque, indique que tu reviens vers la personne). N'ajoute aucun argumentaire commercial, aucune présentation de PillQare et aucun lien de prise de rendez-vous, sauf si l'email reçu le demande explicitement. Pas de signature (ajoutée automatiquement). Corps en texte brut, paragraphes séparés par une ligne vide.`,
        user: `<email_recu de="${email.fromName ?? email.fromEmail}" objet="${email.subject}">\n${truncate(stripQuotedReply(email.textBody ?? email.snippet ?? ""), 4000)}\n</email_recu>\n\n${opts.instruction?.trim() ? `Consigne : ${opts.instruction.trim()}\n\n` : ""}Rédige la réponse. Objet : « Re: ${email.subject.replace(/^(re|tr|fwd?)\s*:\s*/i, "")} ».`,
      });
    }
    if (email) {
      parts.push(`<email_recu de="${email.fromName ?? email.fromEmail}" objet="${email.subject}">\n${truncate(stripQuotedReply(email.textBody ?? email.snippet ?? ""), 3000)}\n</email_recu>`);
      parts.push(`Rédige la réponse à cet email : réponds précisément à chaque question ou demande. Si une information manque (prix, délai non présent dans le contexte), propose d'en parler ou indique que tu reviens vers lui, sans inventer. Objet : « Re: ${email.subject.replace(/^(re|tr|fwd?)\s*:\s*/i, "")} ».`);
    }
  }
  if (opts.draft && (opts.draft.subject.trim() || opts.draft.body.trim())) {
    parts.push(`<brouillon>\nObjet : ${opts.draft.subject}\n\n${opts.draft.body}\n</brouillon>`);
    parts.push(opts.rewrite ? REWRITES[opts.rewrite] : "Améliore ce brouillon en le personnalisant pour ce contact, en gardant son intention.");
  }
  if (opts.instruction?.trim()) parts.push(`Demande du commercial : ${opts.instruction.trim()}`);
  if (!opts.replyToEmailId && !opts.draft?.body.trim() && !opts.instruction?.trim()) {
    parts.push("Rédige l'email le plus utile à envoyer maintenant à ce contact pour faire avancer la relation, d'après l'étape du dossier et les derniers échanges.");
  }

  return llmJson({
    tier: "fast",
    name: "email",
    schema: EmailSchema,
    system: `Tu es l'assistant de rédaction des commerciaux de PillQare (CRM). Tu écris des emails commerciaux B2B et B2C efficaces.\nTon souhaité : ${ctx.tone}.\n${RULES}`,
    user: parts.join("\n\n"),
  });
}

/**
 * Relance automatique : adapte l'email du scénario à ce contact précis (cible, besoin, historique),
 * en conservant son objectif, ses liens et son niveau d'insistance. Utilisé avant chaque envoi.
 */
export async function personalizeSequenceEmail(opts: {
  userId: string;
  contactId: string;
  dealId?: string | null;
  subject: string;
  body: string;
  stepLabel: string;
  threaded: boolean;
}): Promise<AiEmail> {
  const ctx = await buildContactContext({ contactId: opts.contactId, dealId: opts.dealId, userId: opts.userId });
  const res = await llmJson({
    tier: "fast",
    name: "relance",
    schema: EmailSchema,
    system: `Tu personnalises les emails de relance automatique d'un commercial de PillQare, juste avant leur envoi.\nTon souhaité : ${ctx.tone}.\n${RULES}\n- Garde l'objectif, le niveau d'insistance et les liens du modèle ; adapte les arguments et les formulations au contact. Ne mentionne jamais qu'il s'agit d'une relance automatique.`,
    user: `<contexte>\n${ctx.text}\n</contexte>\n\n<modele etape="${opts.stepLabel}">\nObjet : ${opts.subject}\n\n${opts.body}\n</modele>\n\n${opts.threaded ? `Cet email part en réponse dans le fil précédent : garde exactement l'objet « ${opts.subject} ».` : "Propose un objet personnalisé (ou garde celui du modèle s'il convient)."}`,
  });
  return opts.threaded ? { ...res, subject: opts.subject } : res;
}

const InsightsSchema = z.object({
  summary: z.string().describe("Où en est la relation, en 3 à 5 phrases factuelles."),
  interest: z.enum(["faible", "moyen", "fort", "inconnu"]).describe("Niveau d'intérêt estimé d'après les échanges."),
  nextBestAction: z.string().describe("La prochaine action la plus utile pour le commercial, concrète, commençant par un verbe."),
  timing: z.string().describe("Quand la faire (ex. « aujourd'hui », « d'ici vendredi »), justifié en quelques mots."),
  talkingPoints: z.array(z.string()).describe("2 à 4 arguments ou sujets à aborder, adaptés à ce contact."),
  risks: z.array(z.string()).describe("Points de vigilance ou freins identifiés (liste vide si aucun)."),
  missingInfo: z.array(z.string()).describe("Informations utiles qu'il faudrait obtenir (budget, décideur, volume…)."),
});
export type ContactInsights = z.infer<typeof InsightsSchema>;

/** Analyse de la relation : synthèse, intérêt, prochaine meilleure action, arguments. */
export async function analyzeRelationship(opts: { userId: string; contactId?: string | null; dealId?: string | null }): Promise<ContactInsights> {
  const ctx = await buildContactContext(opts);
  return llmJson({
    tier: "smart",
    name: "analyse",
    schema: InsightsSchema,
    system:
      "Tu es un directeur commercial expérimenté qui aide un commercial de PillQare à faire avancer ses dossiers. Analyse le contexte et donne des recommandations concrètes, en français, factuelles : n'invente aucun fait absent du contexte. Si le contexte est pauvre, dis-le et oriente vers les informations à obtenir.",
    user: `<contexte>\n${ctx.text}\n</contexte>\n\nAnalyse cette relation commerciale.`,
  });
}
