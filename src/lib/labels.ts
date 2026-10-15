/**
 * Libellés français et couleurs des énumérations — utilisable côté serveur et côté client.
 */
import type {
  ActivityType,
  AiSessionKind,
  AiSessionStatus,
  CallOutcome,
  ContactKind,
  ContactSource,
  ContactStatus,
  DealStage,
  MeetingStatus,
  MeetingType,
  NextActionType,
  ProductType,
  QuoteStatus,
  Role,
  SequenceStepType,
  SequenceTrigger,
  StepRunStatus,
  TaskPriority,
  TaskType,
  TemplateCategory,
  TrialResult,
  TrialStatus,
  EnrollmentStopReason,
  AssignmentStrategy,
} from "@/generated/prisma/enums";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Manager",
  SALES: "Commercial",
};

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  B2B: "B2B — Professionnel",
  B2C: "B2C — Particulier",
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  PROSPECT: "Prospect",
  CUSTOMER: "Client",
  PARTNER: "Partenaire",
  INACTIVE: "Inactif",
};

export const CONTACT_STATUS_COLORS: Record<ContactStatus, string> = {
  PROSPECT: "bg-sky-100 text-sky-800",
  CUSTOMER: "bg-emerald-100 text-emerald-800",
  PARTNER: "bg-violet-100 text-violet-800",
  INACTIVE: "bg-slate-100 text-slate-600",
};

export const SOURCE_LABELS: Record<ContactSource, string> = {
  MANUAL: "Saisie manuelle",
  WEBSITE_FORM: "Formulaire du site",
  BOOKING: "Prise de RDV en ligne",
  SHOPIFY: "Boutique Shopify",
  EMAIL: "Email entrant",
  IMPORT: "Import",
  REFERRAL: "Recommandation",
  EVENT: "Salon / événement",
  PHONE: "Appel entrant",
  LINKEDIN: "LinkedIn",
  OTHER: "Autre",
};

export const STAGE_ORDER: DealStage[] = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"];
export const OPEN_STAGES: DealStage[] = ["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"];

export const STAGE_LABELS: Record<DealStage, string> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacté",
  MEETING: "RDV",
  QUOTE: "Devis",
  FOLLOW_UP: "Relance / réflexion",
  WON: "Signé",
  LOST: "Refusé",
};

export const STAGE_COLORS: Record<DealStage, { dot: string; badge: string; column: string }> = {
  PROSPECT: { dot: "bg-slate-400", badge: "bg-slate-50 text-slate-700 ring-1 ring-slate-600/15 ring-inset", column: "border-t-slate-400" },
  CONTACTED: { dot: "bg-sky-500", badge: "bg-sky-50 text-sky-700 ring-1 ring-sky-600/15 ring-inset", column: "border-t-sky-500" },
  MEETING: { dot: "bg-indigo-500", badge: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/15 ring-inset", column: "border-t-indigo-500" },
  QUOTE: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/15 ring-inset", column: "border-t-amber-500" },
  FOLLOW_UP: { dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 ring-1 ring-orange-600/15 ring-inset", column: "border-t-orange-500" },
  WON: { dot: "bg-emerald-600", badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 ring-inset", column: "border-t-emerald-600" },
  LOST: { dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/15 ring-inset", column: "border-t-rose-500" },
};

/** Probabilité de signature par défaut selon l'étape (prévisionnel) */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  PROSPECT: 5,
  CONTACTED: 10,
  MEETING: 25,
  QUOTE: 50,
  FOLLOW_UP: 60,
  WON: 100,
  LOST: 0,
};

export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  CALL: "Appeler",
  EMAIL: "Envoyer un email",
  MEETING: "Rendez-vous",
  FOLLOW_UP: "Relancer",
  QUOTE: "Faire / envoyer le devis",
  DEMO: "Démonstration",
  TASK: "Tâche",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CALL: "Appel",
  EMAIL_SENT: "Email envoyé",
  EMAIL_RECEIVED: "Email reçu",
  MEETING: "Rendez-vous",
  MEETING_BOOKED: "RDV réservé",
  MEETING_CANCELLED: "RDV annulé",
  MEETING_REPORT: "Compte rendu",
  NOTE: "Note",
  TASK_COMPLETED: "Tâche terminée",
  DEAL_CREATED: "Dossier créé",
  STAGE_CHANGED: "Changement d'étape",
  OWNER_CHANGED: "Changement de commercial",
  QUOTE_CREATED: "Devis créé",
  QUOTE_SENT: "Devis envoyé",
  QUOTE_VIEWED: "Devis consulté",
  QUOTE_ACCEPTED: "Devis accepté",
  QUOTE_REFUSED: "Devis refusé",
  ORDER_PLACED: "Commande",
  FORM_SUBMITTED: "Formulaire",
  TRIAL_EVENT: "Essai / pilote",
  SEQUENCE_EVENT: "Relance automatique",
  SATISFACTION: "Satisfaction",
  SYSTEM: "Système",
};

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  REACHED: "Joint",
  NO_ANSWER: "Pas de réponse",
  VOICEMAIL: "Messagerie",
  BUSY: "Occupé",
  WRONG_NUMBER: "Mauvais numéro",
  CALLBACK_REQUESTED: "Rappel demandé",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CALL: "Appel",
  EMAIL: "Email",
  FOLLOW_UP: "Relance",
  CALLBACK: "Rappel (lead entrant)",
  MEETING_PREP: "Préparer un RDV",
  MEETING_REPORT: "Compte rendu de RDV",
  QUOTE: "Devis",
  INSTALLATION: "Installation",
  ONBOARDING: "Prise en main",
  SATISFACTION: "Satisfaction",
  TRIAL: "Essai / pilote",
  TODO: "À faire",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-slate-100 text-slate-600",
  NORMAL: "bg-blue-50 text-blue-700",
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-rose-100 text-rose-700",
};

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  VIDEO: "Visio",
  PHONE: "Téléphone",
  IN_PERSON: "Physique",
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  SCHEDULED: "Planifié",
  COMPLETED: "Réalisé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absent",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
  EXPIRED: "Expiré",
};

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  REFUSED: "bg-rose-100 text-rose-700",
  EXPIRED: "bg-amber-100 text-amber-800",
};

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  PLANNED: "Planifié",
  EQUIPMENT_SENT: "Matériel envoyé",
  IN_PROGRESS: "En cours",
  EVALUATION: "Évaluation",
  CONVERTED: "Converti",
  ENDED: "Terminé",
  CANCELLED: "Annulé",
};

export const TRIAL_STATUS_COLORS: Record<TrialStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  EQUIPMENT_SENT: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800",
  EVALUATION: "bg-amber-100 text-amber-800",
  CONVERTED: "bg-emerald-100 text-emerald-800",
  ENDED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export const TRIAL_RESULT_LABELS: Record<TrialResult, string> = {
  POSITIVE: "Positif",
  NEUTRAL: "Mitigé",
  NEGATIVE: "Négatif",
};

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  HARDWARE: "Matériel",
  SUBSCRIPTION: "Abonnement",
  SERVICE: "Service",
  CONSUMABLE: "Consommable",
};

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  PROSPECTION: "Prospection",
  FOLLOW_UP: "Relance",
  MEETING: "Rendez-vous",
  QUOTE: "Devis",
  TRIAL: "Essai / pilote",
  POST_PURCHASE: "Après-achat",
  OTHER: "Autre",
};

export const SEQUENCE_TRIGGER_LABELS: Record<SequenceTrigger, string> = {
  STAGE_ENTERED: "Entrée dans une étape du pipeline",
  WEB_FORM: "Demande via formulaire du site",
  ORDER_PAID: "Commande Shopify payée",
  QUOTE_SENT: "Devis envoyé",
  TRIAL_STARTED: "Début d'un essai / pilote",
  MANUAL: "Inscription manuelle",
};

export const STEP_TYPE_LABELS: Record<SequenceStepType, string> = {
  EMAIL: "Email",
  CALL: "Appel",
  TASK: "Tâche",
};

export const STEP_RUN_STATUS_LABELS: Record<StepRunStatus, string> = {
  SCHEDULED: "Prévue",
  PROCESSING: "En cours d'envoi",
  PENDING_APPROVAL: "À valider",
  SENT: "Envoyée",
  TASK_OPEN: "Tâche à faire",
  DONE: "Faite",
  SKIPPED: "Ignorée",
  CANCELLED: "Annulée",
  FAILED: "Échec",
};

export const STOP_REASON_LABELS: Record<EnrollmentStopReason, string> = {
  REPLIED: "Le contact a répondu",
  STAGE_CHANGED: "Le dossier a changé d'étape",
  MEETING_BOOKED: "Un RDV a été pris",
  DEAL_CLOSED: "Dossier signé ou refusé",
  MANUAL: "Arrêt manuel",
  UNSUBSCRIBED: "Désinscription",
  ERROR: "Erreur",
  QUOTE_RESENT: "Nouveau devis envoyé",
};

export const AI_KIND_LABELS: Record<AiSessionKind, string> = {
  CALL: "Appel téléphonique",
  VIDEO: "Visio",
  IN_PERSON: "RDV physique",
};

export const AI_STATUS_LABELS: Record<AiSessionStatus, string> = {
  RECORDING: "Enregistrement",
  TRANSCRIBING: "Transcription",
  ANALYZING: "Analyse IA",
  READY: "CR à valider",
  VALIDATED: "Validé",
  FAILED: "Échec",
};

export const ASSIGNMENT_LABELS: Record<AssignmentStrategy, string> = {
  ROUND_ROBIN: "Tour de rôle entre les commerciaux",
  SEGMENT: "Selon la cible (commerciaux affectés à la cible)",
  FIXED: "Toujours le même commercial",
};

export function fullName(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!p) return "";
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

export function contactDisplayName(c: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
} | null | undefined): string {
  if (!c) return "Contact inconnu";
  return fullName(c) || c.email || c.phone || "Contact sans nom";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export type BlockedReason = "NO_NEXT_ACTION" | "OVERDUE_ACTION" | "STALE" | "STAGE_TOO_LONG";

export const BLOCKED_REASON_LABELS: Record<BlockedReason, string> = {
  NO_NEXT_ACTION: "Aucune prochaine action",
  OVERDUE_ACTION: "Action en retard",
  STALE: "Aucune activité récente",
  STAGE_TOO_LONG: "Trop longtemps dans l'étape",
};
