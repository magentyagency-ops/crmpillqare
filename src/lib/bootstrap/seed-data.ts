/**
 * Données de référence PillQare : cibles, motifs de refus, produits, modèles d'emails,
 * scénarios de relance et formulaires du site. Idempotent (peut être relancé).
 */
import type { ContactKind, DealStage, SequenceStepType, SequenceTrigger, TemplateCategory } from "@/generated/prisma/enums";

export const SEGMENTS: { name: string; kind: ContactKind; color: string; description: string; keywords: string[] }[] = [
  { name: "Pharmacies", kind: "B2B", color: "#0EA5E9", description: "Pharmacies d'officine (revente, préparation des doses, accompagnement des patients).", keywords: ["pharmacie", "pharmacien", "pharmacienne", "officine", "parapharmacie"] },
  { name: "EHPAD & résidences seniors", kind: "B2B", color: "#8B5CF6", description: "EHPAD, résidences autonomie et services seniors.", keywords: ["ehpad", "ehpa", "maison de retraite", "résidence senior", "résidence autonomie", "résidence services", "usld", "marpa", "foyer logement"] },
  { name: "SSIAD / SAAD / aide à domicile", kind: "B2B", color: "#F59E0B", description: "Services de soins et d'aide à domicile.", keywords: ["ssiad", "saad", "spasad", "aide à domicile", "aides à domicile", "service à la personne", "services à la personne", "auxiliaire de vie", "maintien à domicile"] },
  { name: "Infirmiers & professionnels de santé", kind: "B2B", color: "#10B981", description: "IDEL, médecins, centres de santé, HAD.", keywords: ["infirmier", "infirmière", "idel", "idec", "cabinet infirmier", "médecin", "médecin généraliste", "centre de santé", "maison de santé", "msp", "kinésithérapeute"] },
  { name: "Établissements de santé", kind: "B2B", color: "#EF4444", description: "Hôpitaux, cliniques, SSR.", keywords: ["hôpital", "clinique", "polyclinique", "chu", "chr", "centre hospitalier", "ssr", "smr", "had", "hospitalisation à domicile", "ght"] },
  { name: "Mutuelles & assureurs", kind: "B2B", color: "#6366F1", description: "Complémentaires santé, assisteurs, prévoyance.", keywords: ["mutuelle", "assurance", "assureur", "prévoyance", "assisteur", "complémentaire santé", "courtier"] },
  { name: "Collectivités & CCAS", kind: "B2B", color: "#14B8A6", description: "Départements, CCAS, plateformes de répit.", keywords: ["ccas", "cias", "mairie", "ville de", "conseil départemental", "département", "collectivité", "plateforme de répit", "dac", "maia"] },
  { name: "Distributeurs & revendeurs", kind: "B2B", color: "#64748B", description: "Grossistes, revendeurs matériel médical, e-commerce.", keywords: ["revendeur", "grossiste", "matériel médical", "prestataire de santé", "psad", "centrale d'achat", "négoce"] },
  { name: "Particuliers — aidants", kind: "B2C", color: "#EC4899", description: "Proches aidants qui veulent sécuriser la prise de médicaments d'un parent.", keywords: ["aidant", "aidante", "ma mère", "mon père", "mes parents", "ma grand-mère", "mon grand-père", "mon mari", "ma femme", "mon épouse", "mon conjoint", "un proche", "mon proche", "parent âgé"] },
  { name: "Particuliers — patients", kind: "B2C", color: "#F97316", description: "Patients et seniors autonomes.", keywords: ["pour moi", "moi-même", "je suis patient", "je suis patiente"] },
];

export const LOST_REASONS = [
  "Prix trop élevé",
  "Pas de budget",
  "Pas le bon moment",
  "Concurrent choisi",
  "Pas de besoin",
  "Sans réponse / injoignable",
  "Pas décisionnaire",
  "Produit inadapté",
  "Solution déjà en place",
  "Autre",
];

export const PRODUCTS = [
  {
    sku: "PQ-PILULIER",
    name: "Pilulier connecté PillQare",
    description: "Pilulier connecté avec 21 capsules numérotées, guides de préparation et accès à l'application (rappels, suivi des prises, alertes aux aidants). Sans abonnement obligatoire.",
    type: "HARDWARE" as const,
    unitPriceHT: 57.5,
    vatRate: 20,
  },
  {
    sku: "PQ-DUO",
    name: "Pilulier + Distributeur automatique PillQare",
    description: "Pilulier connecté + distributeur automatique avec indicateurs lumineux, application et alertes aux aidants.",
    type: "HARDWARE" as const,
    unitPriceHT: 665.83,
    vatRate: 20,
  },
];

type TemplateSeed = { name: string; category: TemplateCategory; subject: string; body: string };

export const TEMPLATES: TemplateSeed[] = [
  {
    name: "Prospection — pharmacie",
    category: "PROSPECTION",
    subject: "Sécuriser l'observance de vos patients avec PillQare",
    body: `{{contact.greeting}}

Je suis {{user.firstName}}, chez PillQare, une solution française de gestion des médicaments : un pilulier connecté qui rappelle chaque prise au patient et alerte ses proches en cas d'oubli.

Plusieurs pharmacies le proposent déjà à leurs patients polymédiqués : c'est un service différenciant, simple à expliquer, qui renforce le lien avec les familles.

Seriez-vous disponible pour un échange de 20 minutes ? Vous pouvez choisir directement un créneau ici : {{bookingLink}}

Bien cordialement,`,
  },
  {
    name: "Prospection — EHPAD / établissement",
    category: "PROSPECTION",
    subject: "Distribution des médicaments : un gain de temps pour vos équipes",
    body: `{{contact.greeting}}

Je me permets de vous contacter au sujet de la distribution des médicaments dans votre établissement. PillQare propose un pilulier connecté et un distributeur automatique qui sécurisent les prises et tracent chaque distribution, avec des alertes en cas d'oubli.

Nous menons actuellement des pilotes avec des établissements : seriez-vous ouvert(e) à un échange pour voir si un essai aurait du sens chez vous ?

Mon agenda : {{bookingLink}}

Bien cordialement,`,
  },
  {
    name: "Suite à notre échange",
    category: "FOLLOW_UP",
    subject: "Suite à notre échange",
    body: `{{contact.greeting}}

Merci pour notre échange. Comme convenu, je reviens vers vous avec les éléments dont nous avons parlé.

N'hésitez pas à me dire quand vous seriez disponible pour en discuter : {{bookingLink}}

Bien cordialement,`,
  },
  {
    name: "Relance devis",
    category: "QUOTE",
    subject: "Votre devis {{quote.number}}",
    body: `{{contact.greeting}}

Je me permets de revenir vers vous concernant notre proposition n° {{quote.number}}. Avez-vous pu en prendre connaissance ?

Vous pouvez la consulter et l'accepter en ligne ici : {{quote.link}}

Je reste disponible pour l'ajuster si besoin.

Bien cordialement,`,
  },
  {
    name: "Bien démarrer avec PillQare",
    category: "POST_PURCHASE",
    subject: "Bien démarrer avec votre pilulier PillQare",
    body: `{{contact.greeting}}

Merci pour votre commande {{order.number}} ! Voici les étapes pour bien démarrer dès réception :

1. Téléchargez l'application PillQare et créez votre compte.
2. Préparez les capsules numérotées en suivant les fiches guides fournies.
3. Programmez les horaires de prise dans l'application et ajoutez les proches à prévenir.

Je vous appellerai dans quelques jours pour vérifier que tout est bien installé. En attendant, la FAQ est disponible ici : https://pillqare.com/faq

Bien cordialement,`,
  },
  {
    name: "Satisfaction",
    category: "POST_PURCHASE",
    subject: "Votre avis sur PillQare (1 minute)",
    body: `{{contact.greeting}}

Cela fait maintenant quelques semaines que vous utilisez PillQare. Votre avis nous est précieux : pourriez-vous nous dire en un clic ce que vous en pensez ?

{{satisfactionLink}}

Merci beaucoup,`,
  },
];

type StepSeed = {
  type: SequenceStepType;
  delayDays: number;
  sendTime?: string;
  subject?: string;
  body?: string;
  taskTitle?: string;
  taskDescription?: string;
  requiresApproval?: boolean;
  aiPersonalize?: boolean;
};

export type SequenceSeed = {
  name: string;
  description: string;
  trigger: SequenceTrigger;
  triggerStage?: DealStage;
  contactKind?: ContactKind;
  priority?: number;
  steps: StepSeed[];
};

export const SEQUENCES: SequenceSeed[] = [
  {
    name: "Prospection B2B — premier contact",
    description: "Prospects professionnels ajoutés au pipeline : email d'introduction (à valider), appels et relances espacées.",
    trigger: "STAGE_ENTERED",
    triggerStage: "PROSPECT",
    contactKind: "B2B",
    steps: [
      {
        type: "EMAIL",
        delayDays: 0,
        requiresApproval: true,
        subject: "PillQare — sécuriser la prise des médicaments",
        body: `{{contact.greeting}}

Je suis {{user.firstName}}, chez PillQare : nous aidons les professionnels de santé et les établissements à sécuriser la prise des médicaments grâce à un pilulier connecté et un distributeur automatique, avec alertes en cas d'oubli.

Est-ce un sujet chez {{company.name|vous}} ? Je serais ravi(e) d'en parler 20 minutes : {{bookingLink}}

Bien cordialement,`,
      },
      { type: "CALL", delayDays: 2, taskTitle: "Appeler {{contact.fullName}} ({{company.name}}) — suite email de présentation" },
      {
        type: "EMAIL",
        delayDays: 3,
        sendTime: "09:30",
        subject: "",
        body: `{{contact.greeting}}

Je me permets de revenir vers vous : avez-vous eu l'occasion de lire mon message ?

Si le sujet vous intéresse, voici mon agenda : {{bookingLink}}

Bonne journée,`,
      },
      { type: "CALL", delayDays: 5, taskTitle: "2e appel de prospection : {{contact.fullName}}" },
      {
        type: "EMAIL",
        delayDays: 5,
        sendTime: "10:00",
        subject: "",
        body: `{{contact.greeting}}

Je ne veux pas vous importuner : ce sera mon dernier message. Si la gestion des médicaments devient une priorité, je reste joignable au {{user.phone}} ou via {{bookingLink}}.

Bien cordialement,`,
      },
    ],
  },
  {
    name: "Lead entrant — demande via le site (particuliers)",
    description: "Particuliers ayant rempli le formulaire du site : la tâche de rappel est créée immédiatement, ces relances prennent le relais si le contact reste injoignable.",
    trigger: "WEB_FORM",
    contactKind: "B2C",
    steps: [
      {
        type: "EMAIL",
        delayDays: 1,
        sendTime: "10:00",
        subject: "Votre demande d'information PillQare",
        body: `{{contact.greeting}}

J'ai essayé de vous joindre suite à votre demande. Pour gagner du temps, vous pouvez choisir le moment qui vous convient pour que je vous rappelle : {{bookingLink}}

Vous pouvez aussi découvrir le pilulier PillQare ici : https://pillqare.com

À très bientôt,`,
      },
      { type: "CALL", delayDays: 2, taskTitle: "Rappeler {{contact.fullName}} (demande site, 2e tentative)" },
      {
        type: "EMAIL",
        delayDays: 4,
        subject: "",
        body: `{{contact.greeting}}

Je reviens vers vous une dernière fois : avez-vous encore des questions sur PillQare ? Je reste à votre écoute au {{user.phone}}.

Bien cordialement,`,
      },
    ],
  },
  {
    name: "Lead entrant — demande via le site (professionnels)",
    description: "Professionnels ayant contacté PillQare via le site.",
    trigger: "WEB_FORM",
    contactKind: "B2B",
    steps: [
      {
        type: "EMAIL",
        delayDays: 1,
        sendTime: "09:30",
        subject: "Votre demande — PillQare",
        body: `{{contact.greeting}}

Merci pour votre intérêt pour PillQare. Je n'ai pas réussi à vous joindre : vous pouvez réserver directement un échange de 20 minutes ici : {{bookingLink}}

Bien cordialement,`,
      },
      { type: "CALL", delayDays: 2, taskTitle: "Rappeler {{contact.fullName}} ({{company.name}}) — 2e tentative" },
      {
        type: "EMAIL",
        delayDays: 5,
        subject: "",
        body: `{{contact.greeting}}

Je me permets une dernière relance au sujet de votre demande. Je reste disponible au {{user.phone}} ou via {{bookingLink}}.

Bien cordialement,`,
      },
    ],
  },
  {
    name: "Après le premier contact",
    description: "Le contact a été joint : proposer un rendez-vous.",
    trigger: "STAGE_ENTERED",
    triggerStage: "CONTACTED",
    steps: [
      {
        type: "EMAIL",
        delayDays: 2,
        sendTime: "09:30",
        subject: "Suite à notre échange",
        body: `{{contact.greeting}}

Merci pour notre échange. Pour aller plus loin, je vous propose un rendez-vous de présentation (visio ou téléphone, 30 minutes) : {{bookingLink}}

Bien cordialement,`,
      },
      { type: "CALL", delayDays: 4, taskTitle: "Caler un RDV avec {{contact.fullName}}" },
    ],
  },
  {
    name: "Suivi de devis",
    description: "Devis envoyé : relances jusqu'à la décision (redémarrées à chaque nouvel envoi).",
    trigger: "QUOTE_SENT",
    steps: [
      {
        type: "EMAIL",
        delayDays: 3,
        sendTime: "09:30",
        subject: "Votre proposition PillQare",
        body: `{{contact.greeting}}

Avez-vous pu prendre connaissance de notre proposition ? Je peux vous apporter toutes les précisions utiles ou l'ajuster à votre besoin.

Vous pouvez la consulter et l'accepter en ligne depuis le lien reçu avec le devis.

Bien cordialement,`,
      },
      { type: "CALL", delayDays: 4, taskTitle: "Appeler {{contact.fullName}} : retour sur le devis" },
      {
        type: "EMAIL",
        delayDays: 7,
        subject: "",
        body: `{{contact.greeting}}

Je reviens vers vous au sujet de notre proposition. Où en est votre réflexion ? Un court échange pourrait vous aider à décider : {{bookingLink}}

Bien cordialement,`,
      },
    ],
  },
  {
    name: "Relance / réflexion",
    description: "Le prospect réfléchit : rester présent sans être insistant.",
    trigger: "STAGE_ENTERED",
    triggerStage: "FOLLOW_UP",
    steps: [
      { type: "CALL", delayDays: 7, taskTitle: "Point d'avancement avec {{contact.fullName}}" },
      {
        type: "EMAIL",
        delayDays: 7,
        sendTime: "10:00",
        subject: "Des nouvelles de votre projet ?",
        body: `{{contact.greeting}}

Je me permets de prendre des nouvelles de votre réflexion. Avez-vous besoin d'éléments complémentaires (retours d'expérience, essai, conditions) ?

Bien cordialement,`,
      },
      {
        type: "EMAIL",
        delayDays: 16,
        subject: "",
        body: `{{contact.greeting}}

Sans retour de votre part, je vais mettre ce dossier en pause. N'hésitez pas à me recontacter quand le moment sera plus opportun : {{bookingLink}}

Bien cordialement,`,
      },
    ],
  },
  {
    name: "Après-achat : installation, prise en main, satisfaction",
    description: "Déclenché par une commande Shopify payée.",
    trigger: "ORDER_PAID",
    steps: [
      {
        type: "EMAIL",
        delayDays: 0,
        subject: "Bien démarrer avec votre pilulier PillQare",
        body: `{{contact.greeting}}

Merci pour votre commande {{order.number}} ! Dès réception, voici comment démarrer :

1. Téléchargez l'application PillQare et créez votre compte.
2. Préparez les capsules numérotées en suivant les fiches guides fournies.
3. Programmez les horaires de prise et ajoutez les proches à prévenir.

Je vous appellerai dans quelques jours pour vérifier que l'installation s'est bien passée. La FAQ : https://pillqare.com/faq

Bien cordialement,`,
      },
      { type: "CALL", delayDays: 4, taskTitle: "Appel installation : {{contact.fullName}} (commande {{order.number}})", taskDescription: "Vérifier la réception, l'installation de l'application et la préparation des capsules." },
      { type: "CALL", delayDays: 7, taskTitle: "Appel prise en main : {{contact.fullName}} (commande {{order.number}})", taskDescription: "Vérifier les rappels, les alertes aux aidants et répondre aux questions d'usage." },
      {
        type: "EMAIL",
        delayDays: 19,
        sendTime: "10:00",
        subject: "Votre avis sur PillQare (1 minute)",
        body: `{{contact.greeting}}

Cela fait quelques semaines que vous utilisez PillQare : votre avis nous aide beaucoup. Pouvez-vous nous dire en un clic ce que vous en pensez ?

{{satisfactionLink}}

Merci beaucoup,`,
      },
    ],
  },
  {
    name: "Suivi d'essai / pilote",
    description: "Points réguliers pendant un essai ou un pilote.",
    trigger: "TRIAL_STARTED",
    steps: [
      { type: "CALL", delayDays: 3, taskTitle: "Point de démarrage de l'essai avec {{contact.fullName}}", taskDescription: "Vérifier l'installation du matériel et la prise en main par les équipes." },
      {
        type: "EMAIL",
        delayDays: 11,
        sendTime: "09:30",
        subject: "Point d'étape sur l'essai PillQare",
        body: `{{contact.greeting}}

Nous arrivons à mi-parcours de l'essai. Quels sont vos premiers retours ? Je vous propose un point rapide : {{bookingLink}}

Bien cordialement,`,
      },
      { type: "TASK", delayDays: 14, taskTitle: "Préparer le bilan de l'essai avec {{contact.fullName}}", taskDescription: "Recueillir les retours, mesurer les critères de succès et préparer la proposition commerciale." },
    ],
  },
];

export const FORMS = [
  {
    key: "site-contact",
    name: "Formulaire de contact du site",
    description: "Formulaire principal de pillqare.com (particuliers et professionnels).",
    contactKind: "B2C" as ContactKind,
    callbackDelayMinutes: 120,
  },
  {
    key: "site-pro",
    name: "Demande professionnelle (établissements, pharmacies)",
    description: "Formulaire dédié aux professionnels.",
    contactKind: "B2B" as ContactKind,
    callbackDelayMinutes: 60,
  },
];
