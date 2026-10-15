import * as z from "zod/v4";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { canView, isManager, ownerScope } from "@/lib/auth/guards";
import type { ActionResult } from "@/lib/actions";
import { contactDisplayName, STAGE_LABELS } from "@/lib/labels";
import { addDaysTz, formatDate, formatDateTime, startOfDayTz, startOfMonthTz, startOfWeekTz } from "@/lib/dates";
import { formatEUR, toNumber, truncate } from "@/lib/format";
import { contactSearchWhere } from "@/lib/search";

/**
 * Outils du copilote : chaque outil appelle les actions du CRM avec les droits de l'utilisateur connecté.
 * `confirm` : résumé affiché à l'utilisateur, qui doit valider avant l'exécution (envois vers l'extérieur, suppressions).
 */

export type ToolContext = { user: SessionUser };
export type ToolResult = { ok: boolean; summary: string; data?: unknown; link?: string };

type ToolDef<S extends z.ZodType> = {
  /** Consultation sans effet : non affichée dans le fil de la conversation */
  readOnly?: boolean;
  description: string;
  schema: S;
  confirm?: (args: z.infer<S>, ctx: ToolContext) => Promise<string | null> | string | null;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
};

function tool<S extends z.ZodType>(def: ToolDef<S>) {
  return def;
}

const n = <T extends z.ZodType>(t: T) => t.nullable();
const DATE = z.string().describe("Date « AAAA-MM-JJ » ou date et heure « AAAA-MM-JJTHH:mm », heure de Paris.");

function unwrap<T>(res: ActionResult<T>, summary: string, link?: string): ToolResult {
  if (!res.ok) return { ok: false, summary: res.error };
  return { ok: true, summary: res.message ?? summary, data: res.data, link };
}

async function userIdByEmail(email: string | null | undefined, fallback: string) {
  if (!email) return fallback;
  const u = await db.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" }, active: true }, select: { id: true } });
  if (!u) throw new Error(`Aucun utilisateur du CRM avec l'adresse ${email}.`);
  return u.id;
}

async function viewableContact(ctx: ToolContext, contactId: string) {
  const c = await db.contact.findUnique({ where: { id: contactId }, include: { company: { select: { name: true } } } });
  if (!c || !(await canView(ctx.user, [c.ownerId]))) throw new Error("Contact introuvable ou inaccessible.");
  return c;
}

/** Contact par identifiant, ou par adresse email (créé s'il n'existe pas et que la création est demandée). */
async function resolveContact(ctx: ToolContext, args: { contactId?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null }, create: boolean) {
  if (args.contactId) return viewableContact(ctx, args.contactId);
  const email = args.email?.trim().toLowerCase();
  if (!email) throw new Error("Indiquez le contact (identifiant) ou son adresse email.");
  const existing = await db.contact.findUnique({ where: { emailNormalized: email }, select: { id: true } });
  if (existing) return viewableContact(ctx, existing.id);
  if (!create) throw new Error(`Aucun contact avec l'adresse ${email}.`);
  const { createContactAction } = await import("@/actions/contacts");
  const res = await createContactAction({
    kind: args.companyName ? "B2B" : "B2C",
    email,
    firstName: args.firstName ?? null,
    lastName: args.lastName ?? null,
    companyName: args.companyName ?? null,
    source: "MANUAL",
    sourceDetail: "Créé par le copilote",
    createDeal: false,
  });
  if (!res.ok || !res.data) throw new Error(res.ok ? "Création du contact impossible." : res.error);
  return viewableContact(ctx, res.data.id);
}

const contactLabel = (c: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; company?: { name: string } | null }) =>
  `${contactDisplayName(c)}${c.company ? ` (${c.company.name})` : ""}`;

export const TOOLS = {
  // ───────────── Lecture ─────────────
  rechercher: tool({
    readOnly: true,
    description: "Recherche dans tout le CRM (contacts, organisations, dossiers, devis, commandes) par nom, email, téléphone, numéro…",
    schema: z.object({ requete: z.string() }),
    async run({ requete }) {
      const { globalSearchAction } = await import("@/actions/app");
      const results = await globalSearchAction(requete);
      return { ok: true, summary: `${results.length} résultat(s) pour « ${requete} »`, data: results.map((r) => ({ type: r.type, id: r.id, titre: r.title, detail: r.subtitle, lien: r.href })) };
    },
  }),

  voir_contact: tool({
    readOnly: true,
    description: "Fiche complète d'un contact : coordonnées, dossiers, tâches ouvertes, RDV, devis, relances en cours et derniers échanges.",
    schema: z.object({ contactId: z.string() }),
    async run({ contactId }, ctx) {
      await viewableContact(ctx, contactId);
      const c = await db.contact.findUniqueOrThrow({
        where: { id: contactId },
        include: {
          company: { select: { id: true, name: true } },
          segment: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true, email: true } },
          deals: { where: { archivedAt: null }, select: { id: true, title: true, stage: true, amount: true, nextActionLabel: true, nextActionAt: true } },
          tasks: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" }, take: 10, select: { id: true, title: true, type: true, dueAt: true } },
          meetings: { orderBy: { startAt: "desc" }, take: 5, select: { id: true, title: true, startAt: true, status: true } },
          quotes: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, number: true, status: true, totalHT: true } },
          enrollments: { where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, status: true, sequence: { select: { name: true } } } },
          activities: { orderBy: { occurredAt: "desc" }, take: 12, select: { type: true, title: true, body: true, occurredAt: true } },
        },
      });
      return {
        ok: true,
        summary: `Fiche de ${contactLabel(c)}`,
        link: `/contacts/${c.id}`,
        data: {
          id: c.id,
          nom: contactDisplayName(c),
          email: c.email,
          telephone: c.phone,
          fonction: c.jobTitle,
          organisation: c.company,
          type: c.kind,
          statut: c.status,
          cible: c.segment?.name ?? null,
          commercial: c.owner ? `${c.owner.firstName} ${c.owner.lastName} (${c.owner.email})` : null,
          neContacterPlus: c.doNotContact,
          dossiers: c.deals.map((d) => ({ ...d, etape: STAGE_LABELS[d.stage], montant: d.amount ? formatEUR(d.amount) : null, prochaineAction: d.nextActionAt ? `${d.nextActionLabel} — ${formatDateTime(d.nextActionAt)}` : null })),
          tachesOuvertes: c.tasks.map((t) => ({ ...t, echeance: t.dueAt ? formatDateTime(t.dueAt) : null })),
          rdv: c.meetings.map((m) => ({ ...m, date: formatDateTime(m.startAt) })),
          devis: c.quotes.map((q) => ({ ...q, totalHT: formatEUR(q.totalHT) })),
          relancesEnCours: c.enrollments.map((e) => ({ id: e.id, scenario: e.sequence.name, statut: e.status })),
          historique: c.activities.map((a) => `${formatDate(a.occurredAt)} · ${a.title}${a.body ? ` : ${truncate(a.body.replace(/\s+/g, " "), 200)}` : ""}`),
        },
      };
    },
  }),

  lister_dossiers: tool({
    readOnly: true,
    description: "Liste des dossiers commerciaux ouverts, filtrables par étape, commercial, texte, ou dossiers bloqués (sans action / en retard / inactifs).",
    schema: z.object({
      etape: n(z.enum(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"])),
      texte: n(z.string()),
      commercialEmail: n(z.string()).describe("Email du commercial ; null = selon les droits (moi pour un commercial, tous pour la direction)."),
      bloquesUniquement: z.boolean(),
    }),
    async run(a, ctx) {
      const scope = await ownerScope(ctx.user);
      const where: Prisma.DealWhereInput = {
        ...scope,
        archivedAt: null,
        stage: a.etape ?? { notIn: ["WON", "LOST"] },
        ...(a.commercialEmail ? { ownerId: await userIdByEmail(a.commercialEmail, ctx.user.id) } : {}),
        ...(a.texte ? { OR: [{ title: { contains: a.texte, mode: "insensitive" } }, { contact: contactSearchWhere(a.texte) }] } : {}),
      };
      let deals = await db.deal.findMany({
        where,
        orderBy: { nextActionAt: "asc" },
        take: 60,
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }, owner: { select: { firstName: true } } },
      });
      if (a.bloquesUniquement) {
        const { blockedReasons } = await import("@/lib/deals");
        const { getSettings } = await import("@/lib/settings");
        const settings = await getSettings("pipeline");
        deals = deals.filter((d) => blockedReasons(d, settings).length > 0);
      }
      return {
        ok: true,
        summary: `${deals.length} dossier(s)`,
        data: deals.slice(0, 40).map((d) => ({
          id: d.id,
          titre: d.title,
          etape: STAGE_LABELS[d.stage],
          contact: contactDisplayName(d.contact),
          contactId: d.contact.id,
          montant: d.amount ? formatEUR(d.amount) : null,
          commercial: d.owner.firstName,
          prochaineAction: d.nextActionAt ? `${d.nextActionLabel ?? ""} — ${formatDateTime(d.nextActionAt)}` : "aucune",
        })),
      };
    },
  }),

  lister_taches: tool({
    readOnly: true,
    description: "Tâches ouvertes : aujourd'hui, en retard, à venir ou toutes.",
    schema: z.object({ periode: z.enum(["aujourdhui", "en_retard", "a_venir", "toutes"]), commercialEmail: n(z.string()) }),
    async run(a, ctx) {
      const tz = ctx.user.timezone;
      const now = new Date();
      const assigneeId = a.commercialEmail && isManager(ctx.user) ? await userIdByEmail(a.commercialEmail, ctx.user.id) : ctx.user.id;
      const dueAt =
        a.periode === "aujourdhui"
          ? { lt: addDaysTz(startOfDayTz(now, tz), 1, tz) }
          : a.periode === "en_retard"
            ? { lt: now }
            : a.periode === "a_venir"
              ? { gte: now }
              : undefined;
      const tasks = await db.task.findMany({
        where: { assigneeId, status: "OPEN", ...(dueAt ? { dueAt } : {}) },
        orderBy: { dueAt: "asc" },
        take: 40,
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      });
      return {
        ok: true,
        summary: `${tasks.length} tâche(s)`,
        data: tasks.map((t) => ({ id: t.id, titre: t.title, type: t.type, echeance: t.dueAt ? formatDateTime(t.dueAt) : null, contact: t.contact ? contactDisplayName(t.contact) : null, contactId: t.contactId, dealId: t.dealId })),
      };
    },
  }),

  ma_journee: tool({
    readOnly: true,
    description: "Planning du jour d'un commercial : RDV, appels, relances, réponses à traiter, dossiers à débloquer, nouveaux leads.",
    schema: z.object({ commercialEmail: n(z.string()) }),
    async run(a, ctx) {
      const userId = a.commercialEmail && isManager(ctx.user) ? await userIdByEmail(a.commercialEmail, ctx.user.id) : ctx.user.id;
      const { getDailyPlan } = await import("@/lib/planning");
      const p = await getDailyPlan(userId);
      const t = (x: { title: string; dueAt: Date | null }) => `${x.title}${x.dueAt ? ` (${formatDateTime(x.dueAt)})` : ""}`;
      return {
        ok: true,
        summary: "Planning du jour",
        link: "/aujourdhui",
        data: {
          compteurs: p.counts,
          enRetard: p.overdueCount,
          rdv: p.meetings.map((m) => `${formatDateTime(m.startAt)} · ${m.title}`),
          appels: p.calls.map(t),
          relances: p.followUps.map(t),
          autres: p.otherTasks.map(t),
          aValider: p.approvals.length,
          reponsesATraiter: p.replies.map((r) => `${r.subject}`),
          dossiersADebloquer: p.attention.map((d) => d.deal.title),
        },
      };
    },
  }),

  indicateurs: tool({
    readOnly: true,
    description: "Indicateurs commerciaux (appels, RDV, relances, devis, ventes, CA, dossiers bloqués) par commercial et pour l'équipe.",
    schema: z.object({ periode: z.enum(["aujourdhui", "semaine", "mois", "annee"]) }),
    async run(a, ctx) {
      const tz = ctx.user.timezone;
      const now = new Date();
      const from = a.periode === "aujourdhui" ? startOfDayTz(now, tz) : a.periode === "semaine" ? startOfWeekTz(now, tz) : a.periode === "mois" ? startOfMonthTz(now, tz) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const { getSalesMetrics, totals } = await import("@/lib/dashboard");
      const rows = await getSalesMetrics({ from, to: now }, isManager(ctx.user) ? undefined : [ctx.user.id]);
      return { ok: true, summary: `Indicateurs (${a.periode})`, link: "/tableau-de-bord", data: { equipe: totals(rows), parCommercial: rows } };
    },
  }),

  lister_rdv: tool({
    readOnly: true,
    description: "Rendez-vous sur une période.",
    schema: z.object({ du: DATE, au: DATE, tousLesCommerciaux: z.boolean() }),
    async run(a, ctx) {
      const { parseDateTimeLocal } = await import("@/lib/dates");
      const from = parseDateTimeLocal(a.du, ctx.user.timezone) ?? new Date();
      const to = parseDateTimeLocal(a.au.includes("T") ? a.au : `${a.au}T23:59`, ctx.user.timezone) ?? addDaysTz(from, 7);
      const meetings = await db.meeting.findMany({
        where: { startAt: { gte: from, lte: to }, ...(a.tousLesCommerciaux && isManager(ctx.user) ? {} : { organizerId: ctx.user.id }) },
        orderBy: { startAt: "asc" },
        take: 50,
        include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } }, organizer: { select: { firstName: true } } },
      });
      return { ok: true, summary: `${meetings.length} RDV`, data: meetings.map((m) => ({ id: m.id, titre: m.title, debut: formatDateTime(m.startAt), statut: m.status, type: m.type, contact: m.contact ? contactDisplayName(m.contact) : null, organisateur: m.organizer.firstName })) };
    },
  }),

  lister_relances: tool({
    readOnly: true,
    description: "Relances automatiques (étapes de scénarios) : prévues, à valider, envoyées, en échec.",
    schema: z.object({ statut: z.enum(["prevues", "a_valider", "envoyees", "echecs"]), contactId: n(z.string()) }),
    async run(a, ctx) {
      const status = { prevues: "SCHEDULED", a_valider: "PENDING_APPROVAL", envoyees: "SENT", echecs: "FAILED" } as const;
      const scope = await ownerScope(ctx.user);
      const runs = await db.sequenceStepRun.findMany({
        where: { status: status[a.statut], enrollment: { ...scope, ...(a.contactId ? { contactId: a.contactId } : {}) } },
        orderBy: { scheduledAt: a.statut === "prevues" ? "asc" : "desc" },
        take: 40,
        include: { step: { select: { subject: true, taskTitle: true } }, enrollment: { select: { id: true, sequence: { select: { name: true } }, contact: { select: { firstName: true, lastName: true, email: true, phone: true } } } } },
      });
      return {
        ok: true,
        summary: `${runs.length} relance(s)`,
        link: "/relances",
        data: runs.map((r) => ({ id: r.id, scenario: r.enrollment.sequence.name, contact: contactDisplayName(r.enrollment.contact), type: r.type, objet: r.subjectOverride ?? r.step.subject ?? r.step.taskTitle, prevue: formatDateTime(r.scheduledAt), inscriptionId: r.enrollment.id })),
      };
    },
  }),

  referentiels: tool({
    readOnly: true,
    description: "Données de référence : utilisateurs, cibles, motifs de refus, produits et tarifs, scénarios de relance actifs.",
    schema: z.object({}),
    async run() {
      const [users, segments, reasons, products, sequences] = await Promise.all([
        db.user.findMany({ where: { active: true }, select: { firstName: true, lastName: true, email: true, role: true } }),
        db.segment.findMany({ where: { active: true }, select: { id: true, name: true, kind: true } }),
        db.lostReason.findMany({ where: { active: true }, select: { id: true, label: true } }),
        db.product.findMany({ where: { active: true }, select: { id: true, name: true, sku: true, unitPriceHT: true, vatRate: true } }),
        db.sequence.findMany({ where: { active: true, createdByAssistant: false }, select: { id: true, name: true, trigger: true } }),
      ]);
      return { ok: true, summary: "Référentiels", data: { utilisateurs: users, cibles: segments, motifsDeRefus: reasons, produits: products.map((p) => ({ ...p, unitPriceHT: toNumber(p.unitPriceHT) })), scenarios: sequences } };
    },
  }),

  // ───────────── Contacts ─────────────
  creer_contact: tool({
    description: "Crée un contact (et éventuellement son dossier commercial avec une première action).",
    schema: z.object({
      prenom: n(z.string()),
      nom: n(z.string()),
      email: n(z.string()),
      telephone: n(z.string()),
      organisation: n(z.string()),
      fonction: n(z.string()),
      ville: n(z.string()),
      notes: n(z.string()),
      creerDossier: z.boolean(),
      premiereAction: n(z.object({ type: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "TASK"]), echeance: DATE, precision: n(z.string()) })),
    }),
    async run(a) {
      const { createContactAction } = await import("@/actions/contacts");
      const res = await createContactAction({
        kind: a.organisation ? "B2B" : "B2C",
        firstName: a.prenom,
        lastName: a.nom,
        email: a.email,
        phone: a.telephone,
        companyName: a.organisation,
        jobTitle: a.fonction,
        city: a.ville,
        notes: a.notes,
        source: "MANUAL",
        sourceDetail: "Créé par le copilote",
        createDeal: a.creerDossier,
        nextAction: a.creerDossier ? { type: a.premiereAction?.type ?? "CALL", dueAt: a.premiereAction?.echeance ?? "", label: a.premiereAction?.precision ?? null } : null,
      });
      return unwrap(res, "Contact créé", res.ok && res.data ? `/contacts/${res.data.id}` : undefined);
    },
  }),

  modifier_contact: tool({
    description: "Modifie les informations d'un contact (seuls les champs renseignés sont changés).",
    schema: z.object({
      contactId: z.string(),
      prenom: n(z.string()),
      nom: n(z.string()),
      email: n(z.string()),
      telephone: n(z.string()),
      fonction: n(z.string()),
      ville: n(z.string()),
      codePostal: n(z.string()),
      adresse: n(z.string()),
      notes: n(z.string()),
      statut: n(z.enum(["PROSPECT", "CUSTOMER", "PARTNER", "INACTIVE"])),
      cible: n(z.string()).describe("Nom de la cible (voir referentiels)."),
      commercialEmail: n(z.string()),
    }),
    async run(a, ctx) {
      const c = await viewableContact(ctx, a.contactId);
      const segmentId = a.cible ? ((await db.segment.findFirst({ where: { name: { contains: a.cible, mode: "insensitive" } }, select: { id: true } }))?.id ?? c.segmentId) : c.segmentId;
      const { updateContactAction } = await import("@/actions/contacts");
      const res = await updateContactAction(c.id, {
        kind: c.kind,
        status: a.statut ?? c.status,
        civility: c.civility,
        firstName: a.prenom ?? c.firstName,
        lastName: a.nom ?? c.lastName,
        email: a.email ?? c.email,
        phone: a.telephone ?? c.phone,
        jobTitle: a.fonction ?? c.jobTitle,
        companyId: c.companyId,
        segmentId,
        ownerId: a.commercialEmail ? await userIdByEmail(a.commercialEmail, c.ownerId ?? ctx.user.id) : c.ownerId,
        source: c.source,
        sourceDetail: c.sourceDetail,
        address: a.adresse ?? c.address,
        postalCode: a.codePostal ?? c.postalCode,
        city: a.ville ?? c.city,
        notes: a.notes ?? c.notes,
        tags: c.tags,
      });
      return unwrap(res, "Contact mis à jour", `/contacts/${c.id}`);
    },
  }),

  ajouter_note: tool({
    description: "Ajoute une note à l'historique d'un contact ou d'un dossier.",
    schema: z.object({ contactId: n(z.string()), dealId: n(z.string()), texte: z.string() }),
    async run(a) {
      const { addNoteAction } = await import("@/actions/contacts");
      return unwrap(await addNoteAction({ contactId: a.contactId, dealId: a.dealId, body: a.texte }), "Note ajoutée", a.contactId ? `/contacts/${a.contactId}` : a.dealId ? `/pipeline/${a.dealId}` : undefined);
    },
  }),

  enregistrer_appel: tool({
    description: "Enregistre un appel passé ou reçu, avec son résultat et éventuellement la prochaine action.",
    schema: z.object({
      contactId: z.string(),
      sens: z.enum(["OUTBOUND", "INBOUND"]),
      resultat: z.enum(["REACHED", "NO_ANSWER", "VOICEMAIL", "BUSY", "WRONG_NUMBER", "CALLBACK_REQUESTED"]),
      dureeMinutes: n(z.number()),
      notes: n(z.string()),
      prochaineAction: n(z.object({ type: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "TASK"]), echeance: DATE, precision: n(z.string()) })),
    }),
    async run(a) {
      const { logCallAction } = await import("@/actions/contacts");
      const res = await logCallAction({
        contactId: a.contactId,
        direction: a.sens,
        outcome: a.resultat,
        durationMin: a.dureeMinutes ?? undefined,
        notes: a.notes,
        nextAction: a.prochaineAction ? { type: a.prochaineAction.type, dueAt: a.prochaineAction.echeance, label: a.prochaineAction.precision } : null,
      } as never);
      return unwrap(res, "Appel enregistré", `/contacts/${a.contactId}`);
    },
  }),

  archiver_contact: tool({
    description: "Archive un contact (il disparaît des listes, ses relances s'arrêtent).",
    schema: z.object({ contactId: z.string() }),
    async confirm({ contactId }, ctx) {
      const c = await viewableContact(ctx, contactId);
      return `Archiver le contact ${contactLabel(c)} et arrêter ses relances`;
    },
    async run({ contactId }) {
      const { archiveContactAction } = await import("@/actions/contacts");
      return unwrap(await archiveContactAction(contactId, true), "Contact archivé");
    },
  }),

  // ───────────── Dossiers ─────────────
  voir_dossier: tool({
    readOnly: true,
    description: "Détail d'un dossier commercial.",
    schema: z.object({ dealId: z.string() }),
    async run({ dealId }, ctx) {
      const d = await db.deal.findUnique({
        where: { id: dealId },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, ownerId: true } },
          owner: { select: { firstName: true, lastName: true } },
          tasks: { where: { status: "OPEN" }, select: { id: true, title: true, dueAt: true } },
          quotes: { select: { id: true, number: true, status: true, totalHT: true } },
          stageHistory: { orderBy: { createdAt: "desc" }, take: 6, select: { fromStage: true, toStage: true, createdAt: true } },
        },
      });
      if (!d || !(await canView(ctx.user, [d.ownerId, d.contact.ownerId]))) return { ok: false, summary: "Dossier introuvable ou inaccessible." };
      return {
        ok: true,
        summary: `Dossier « ${d.title} »`,
        link: `/pipeline/${d.id}`,
        data: {
          ...d,
          etape: STAGE_LABELS[d.stage],
          montant: d.amount ? formatEUR(d.amount) : null,
          contact: { id: d.contact.id, nom: contactDisplayName(d.contact), email: d.contact.email },
          tasks: d.tasks.map((t) => ({ ...t, dueAt: t.dueAt ? formatDateTime(t.dueAt) : null })),
          quotes: d.quotes.map((q) => ({ ...q, totalHT: formatEUR(q.totalHT) })),
        },
      };
    },
  }),

  creer_dossier: tool({
    description: "Crée un dossier commercial pour un contact, avec sa prochaine action datée (obligatoire).",
    schema: z.object({
      contactId: z.string(),
      titre: n(z.string()),
      montantHT: n(z.number()),
      quantite: n(z.number()),
      etape: z.enum(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP"]),
      commercialEmail: n(z.string()),
      prochaineAction: z.object({ type: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "TASK"]), echeance: DATE, precision: n(z.string()) }),
    }),
    async run(a, ctx) {
      const c = await viewableContact(ctx, a.contactId);
      const { createDealAction } = await import("@/actions/deals");
      const res = await createDealAction({
        title: a.titre ?? (c.company ? `${c.company.name} — ${contactDisplayName(c)}` : contactDisplayName(c)),
        contactId: c.id,
        ownerId: await userIdByEmail(a.commercialEmail, c.ownerId ?? ctx.user.id),
        stage: a.etape,
        amount: a.montantHT,
        quantity: a.quantite,
        nextAction: { type: a.prochaineAction.type, dueAt: a.prochaineAction.echeance, label: a.prochaineAction.precision },
      });
      return unwrap(res, "Dossier créé", res.ok && res.data ? `/pipeline/${res.data.id}` : undefined);
    },
  }),

  changer_etape_dossier: tool({
    description: "Fait passer un dossier à une autre étape (WON = signé, LOST = refusé avec motif obligatoire).",
    schema: z.object({
      dealId: z.string(),
      etape: z.enum(["PROSPECT", "CONTACTED", "MEETING", "QUOTE", "FOLLOW_UP", "WON", "LOST"]),
      motifRefus: n(z.string()).describe("Pour LOST : libellé du motif (voir referentiels)."),
      precisionRefus: n(z.string()),
      montantSigneHT: n(z.number()),
      commentaire: n(z.string()),
      prochaineAction: n(z.object({ type: z.enum(["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "QUOTE", "TASK"]), echeance: DATE, precision: n(z.string()) })),
    }),
    async run(a) {
      let lostReasonId: string | null = null;
      if (a.etape === "LOST") {
        const reasons = await db.lostReason.findMany({ where: { active: true }, select: { id: true, label: true } });
        lostReasonId = reasons.find((r) => a.motifRefus && r.label.toLowerCase().includes(a.motifRefus.toLowerCase()))?.id ?? reasons.find((r) => /autre/i.test(r.label))?.id ?? reasons[0]?.id ?? null;
      }
      const { moveDealStageAction } = await import("@/actions/deals");
      const res = await moveDealStageAction(a.dealId, {
        stage: a.etape,
        lostReasonId,
        lostReasonDetail: a.precisionRefus ?? a.motifRefus,
        note: a.commentaire,
        amount: a.montantSigneHT,
        nextAction: a.prochaineAction ? { type: a.prochaineAction.type, dueAt: a.prochaineAction.echeance, label: a.prochaineAction.precision } : null,
      });
      return unwrap(res, `Dossier passé en ${STAGE_LABELS[a.etape]}`, `/pipeline/${a.dealId}`);
    },
  }),

  modifier_dossier: tool({
    description: "Modifie le titre, le montant, la quantité, les notes ou le commercial d'un dossier.",
    schema: z.object({ dealId: z.string(), titre: n(z.string()), montantHT: n(z.number()), quantite: n(z.number()), notes: n(z.string()), commercialEmail: n(z.string()) }),
    async run(a, ctx) {
      const d = await db.deal.findUnique({ where: { id: a.dealId } });
      if (!d) return { ok: false, summary: "Dossier introuvable." };
      const { updateDealAction } = await import("@/actions/deals");
      const res = await updateDealAction(d.id, {
        title: a.titre ?? d.title,
        ownerId: a.commercialEmail ? await userIdByEmail(a.commercialEmail, d.ownerId) : d.ownerId,
        amount: a.montantHT ?? (d.amount ? toNumber(d.amount) : null),
        quantity: a.quantite ?? d.quantity,
        expectedCloseAt: d.expectedCloseAt ? d.expectedCloseAt.toISOString().slice(0, 10) : null,
        source: d.source,
        notes: a.notes ?? d.notes,
        segmentId: d.segmentId,
      });
      void ctx;
      return unwrap(res, "Dossier mis à jour", `/pipeline/${d.id}`);
    },
  }),

  // ───────────── Tâches ─────────────
  creer_tache: tool({
    description: "Crée une tâche (appel, email, relance, tâche…) dans le planning d'un commercial.",
    schema: z.object({
      titre: z.string(),
      type: z.enum(["CALL", "EMAIL", "FOLLOW_UP", "CALLBACK", "MEETING_PREP", "QUOTE", "INSTALLATION", "ONBOARDING", "SATISFACTION", "TRIAL", "TODO"]),
      echeance: DATE,
      priorite: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
      description: n(z.string()),
      contactId: n(z.string()),
      dealId: n(z.string()),
      pourEmail: n(z.string()).describe("Email du commercial à qui l'assigner ; null = moi."),
    }),
    async run(a, ctx) {
      const { createTaskAction } = await import("@/actions/tasks");
      const res = await createTaskAction({
        title: a.titre,
        type: a.type,
        dueAt: a.echeance,
        priority: a.priorite,
        description: a.description,
        contactId: a.contactId,
        dealId: a.dealId,
        assigneeId: await userIdByEmail(a.pourEmail, ctx.user.id),
      });
      return unwrap(res, "Tâche créée", "/taches");
    },
  }),

  gerer_tache: tool({
    description: "Termine, annule, rouvre ou replanifie une tâche.",
    schema: z.object({ taskId: z.string(), action: z.enum(["terminer", "annuler", "rouvrir", "replanifier"]), nouvelleEcheance: n(DATE), note: n(z.string()) }),
    async run(a) {
      const t = await import("@/actions/tasks");
      const res =
        a.action === "terminer"
          ? await t.completeTaskAction(a.taskId, a.note)
          : a.action === "annuler"
            ? await t.cancelTaskAction(a.taskId)
            : a.action === "rouvrir"
              ? await t.reopenTaskAction(a.taskId)
              : a.nouvelleEcheance
                ? await t.rescheduleTaskAction(a.taskId, a.nouvelleEcheance)
                : ({ ok: false, error: "Nouvelle échéance manquante." } as const);
      return unwrap(res, "Tâche mise à jour", "/taches");
    },
  }),

  // ───────────── Rendez-vous ─────────────
  creer_rdv: tool({
    description: "Planifie un rendez-vous (visio, téléphone ou physique). Si un contact est indiqué, il reçoit une confirmation par email et des rappels.",
    schema: z.object({
      contactId: n(z.string()),
      titre: n(z.string()),
      debut: z.string().describe("« AAAA-MM-JJTHH:mm », heure de Paris."),
      dureeMinutes: z.number(),
      type: z.enum(["VIDEO", "PHONE", "IN_PERSON"]),
      lieu: n(z.string()),
      envoyerConfirmation: z.boolean(),
    }),
    async confirm(a, ctx) {
      if (!a.contactId || !a.envoyerConfirmation) return null;
      const c = await viewableContact(ctx, a.contactId);
      return c.email ? `Planifier un RDV le ${a.debut.replace("T", " à ")} avec ${contactLabel(c)} et lui envoyer la confirmation à ${c.email}` : null;
    },
    async run(a) {
      const { createMeetingAction } = await import("@/actions/meetings");
      const res = await createMeetingAction({ contactId: a.contactId, title: a.titre, start: a.debut, durationMin: a.dureeMinutes, type: a.type, location: a.lieu, sendConfirmation: a.envoyerConfirmation });
      return unwrap(res, "RDV planifié", res.ok && res.data ? `/agenda/${res.data.id}` : "/agenda");
    },
  }),

  annuler_rdv: tool({
    description: "Annule un rendez-vous (le contact est prévenu par email).",
    schema: z.object({ meetingId: z.string(), motif: n(z.string()) }),
    async confirm({ meetingId }) {
      const m = await db.meeting.findUnique({ where: { id: meetingId }, select: { title: true, startAt: true } });
      return m ? `Annuler le RDV « ${m.title} » du ${formatDateTime(m.startAt)} et prévenir le contact` : null;
    },
    async run(a) {
      const { cancelMeetingAction } = await import("@/actions/meetings");
      return unwrap(await cancelMeetingAction(a.meetingId, a.motif), "RDV annulé", `/agenda/${a.meetingId}`);
    },
  }),

  // ───────────── Emails et relances ─────────────
  envoyer_email: tool({
    description: "Envoie un email depuis la boîte de l'utilisateur. Rédige toi-même un email personnalisé (texte brut, sans signature : elle est ajoutée automatiquement).",
    schema: z.object({ a: z.string().describe("Adresse du destinataire."), objet: z.string(), message: z.string(), contactId: n(z.string()), dealId: n(z.string()) }),
    confirm: (a) => `Envoyer l'email « ${a.objet} » à ${a.a}\n\n${truncate(a.message, 1500)}`,
    async run(a) {
      const fd = new FormData();
      fd.set("to", a.a);
      fd.set("subject", a.objet);
      fd.set("body", a.message);
      if (a.contactId) fd.set("contactId", a.contactId);
      if (a.dealId) fd.set("dealId", a.dealId);
      const { sendEmailAction } = await import("@/actions/emails");
      const res = await sendEmailAction(fd);
      const { isDeliveryLogged } = await import("@/lib/email/send");
      if (!res.ok) return { ok: false, summary: res.error };
      const note = isDeliveryLogged([a.a]) ? " (mode test : enregistré dans le CRM, non envoyé réellement)" : "";
      return { ok: true, summary: `Email envoyé à ${a.a}${note}`, link: a.contactId ? `/contacts/${a.contactId}` : "/emails?vue=envoyes" };
    },
  }),

  creer_serie_relances: tool({
    description:
      "Programme une série de relances email automatiques vers un contact (créé s'il n'existe pas), à intervalle régulier (minutes, heures ou jours). " +
      "Les relances s'arrêtent automatiquement si le contact répond ou prend RDV. Rédige toi-même chaque email (texte brut, sans signature ; " +
      "« {{contact.greeting}} » insère la formule d'appel). Un objet vide envoie l'email en réponse dans le même fil.",
    schema: z.object({
      contactId: n(z.string()),
      email: n(z.string()),
      prenom: n(z.string()),
      nom: n(z.string()),
      organisation: n(z.string()),
      nomSerie: z.string().describe("Nom court de la série, ex. « Prospection Pharmacie X »."),
      nombre: z.number().describe("Nombre total d'emails (1 à 30)."),
      intervalle: z.number().describe("Écart entre deux emails."),
      unite: z.enum(["minutes", "heures", "jours"]),
      premierEnvoiDansMinutes: z.number().describe("Délai avant le premier email (0 = tout de suite)."),
      heuresOuvreesUniquement: z.boolean().describe("true : uniquement en semaine 9 h–18 h 30 ; false : à toute heure (nécessaire pour un intervalle en minutes)."),
      personnaliserAvecIA: z.boolean().describe("Réécrire chaque email pour le contact juste avant l'envoi."),
      emails: z.array(z.object({ objet: z.string(), message: z.string() })).describe("Un email par envoi (si moins que « nombre », les derniers sont réutilisés)."),
    }),
    async confirm(a) {
      const who = a.email ?? a.contactId ?? "?";
      const every = `${a.intervalle} ${a.unite === "minutes" ? "minute(s)" : a.unite === "heures" ? "heure(s)" : "jour(s)"}`;
      const first = a.emails[0];
      const preview = first ? `\n\nPremier email — « ${first.objet || a.nomSerie} » :\n${truncate(first.message, 900)}` : "";
      return `Programmer ${a.nombre} email(s) de relance vers ${who}, un toutes les ${every}${a.premierEnvoiDansMinutes ? `, premier dans ${a.premierEnvoiDansMinutes} min` : ", premier tout de suite"}${a.heuresOuvreesUniquement ? " (heures ouvrées uniquement)" : " (à toute heure)"}${a.personnaliserAvecIA ? ", personnalisés par l'IA pour le contact" : ""}. Arrêt automatique si le contact répond.${preview}`;
    },
    async run(a, ctx) {
      const count = Math.max(1, Math.min(30, Math.round(a.nombre)));
      if (!a.emails.length) return { ok: false, summary: "Aucun contenu d'email fourni." };
      const c = await resolveContact(ctx, { contactId: a.contactId, email: a.email, firstName: a.prenom, lastName: a.nom, companyName: a.organisation }, true);
      if (!c.email) return { ok: false, summary: "Ce contact n'a pas d'adresse email." };
      if (c.doNotContact) return { ok: false, summary: "Ce contact s'est désinscrit : aucune relance ne peut lui être envoyée." };
      const toDelay = (value: number) => {
        const v = Math.max(0, Math.round(value));
        if (a.unite === "jours") return { delayDays: v, delayHours: 0, delayMinutes: 0 };
        const minutes = a.unite === "heures" ? v * 60 : v;
        return { delayDays: Math.floor(minutes / 1440), delayHours: Math.floor((minutes % 1440) / 60), delayMinutes: minutes % 60 };
      };
      const firstDelay = { delayDays: 0, delayHours: Math.floor(a.premierEnvoiDansMinutes / 60), delayMinutes: Math.round(a.premierEnvoiDansMinutes) % 60 };
      const steps = Array.from({ length: count }, (_, i) => {
        const e = a.emails[Math.min(i, a.emails.length - 1)]!;
        return {
          position: i + 1,
          type: "EMAIL" as const,
          ...(i === 0 ? firstDelay : toDelay(a.intervalle)),
          sendTime: null,
          subject: i === 0 && !e.objet.trim() ? a.nomSerie : e.objet,
          body: e.message,
          aiPersonalize: a.personnaliserAvecIA,
        };
      });
      const sequence = await db.sequence.create({
        data: {
          name: `${a.nomSerie} — ${c.email}`.slice(0, 180),
          description: `Série créée par le copilote pour ${contactLabel(c)}.`,
          trigger: "MANUAL",
          active: true,
          createdByAssistant: true,
          businessHoursOnly: a.heuresOuvreesUniquement,
          stopOnReply: true,
          stopOnMeetingBooked: true,
          stopOnStageChange: false,
          steps: { create: steps },
        },
      });
      const { enroll } = await import("@/lib/sequences/engine");
      const deal = await db.deal.findFirst({ where: { contactId: c.id, stage: { notIn: ["WON", "LOST"] }, archivedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } });
      const enrollment = await enroll({ sequenceId: sequence.id, contactId: c.id, ownerId: ctx.user.id, dealId: deal?.id ?? null });
      if (!enrollment) return { ok: false, summary: "La série n'a pas pu être programmée." };
      const runs = await db.sequenceStepRun.findMany({ where: { enrollmentId: enrollment.id }, orderBy: { position: "asc" }, select: { scheduledAt: true, status: true } });
      const { isDeliveryLogged } = await import("@/lib/email/send");
      const testMode = isDeliveryLogged([c.email]);
      return {
        ok: true,
        summary: `${runs.length} relance(s) programmée(s) pour ${c.email}${testMode ? " (mode test : les emails seront enregistrés dans le CRM sans être réellement envoyés)" : ""}`,
        link: `/contacts/${c.id}`,
        data: { contactId: c.id, inscriptionId: enrollment.id, envois: runs.map((r) => `${formatDateTime(r.scheduledAt)} (${r.status})`) },
      };
    },
  }),

  programmer_scenario: tool({
    description: "Inscrit un contact dans un scénario de relance existant (voir referentiels).",
    schema: z.object({ contactId: z.string(), scenario: z.string().describe("Nom (ou partie du nom) du scénario.") }),
    async confirm({ contactId, scenario }, ctx) {
      const c = await viewableContact(ctx, contactId);
      return `Démarrer le scénario « ${scenario} » pour ${contactLabel(c)} (emails envoyés automatiquement)`;
    },
    async run(a, ctx) {
      const s = await db.sequence.findFirst({ where: { active: true, name: { contains: a.scenario, mode: "insensitive" } }, select: { id: true, name: true } });
      if (!s) return { ok: false, summary: `Aucun scénario actif « ${a.scenario} ».` };
      const deal = await db.deal.findFirst({ where: { contactId: a.contactId, stage: { notIn: ["WON", "LOST"] }, archivedAt: null }, select: { id: true } });
      const { enrollAction } = await import("@/actions/sequences");
      void ctx;
      return unwrap(await enrollAction({ sequenceId: s.id, contactId: a.contactId, dealId: deal?.id ?? null }), `Scénario « ${s.name} » démarré`, `/contacts/${a.contactId}`);
    },
  }),

  arreter_relances: tool({
    description: "Arrête, met en pause ou reprend les relances automatiques d'un contact (toutes ses inscriptions en cours, ou une seule).",
    schema: z.object({ contactId: n(z.string()), inscriptionId: n(z.string()), action: z.enum(["arreter", "pause", "reprendre"]) }),
    async run(a, ctx) {
      const s = await import("@/actions/sequences");
      const ids = a.inscriptionId
        ? [a.inscriptionId]
        : a.contactId
          ? (await db.sequenceEnrollment.findMany({ where: { contactId: a.contactId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } })).map((e) => e.id)
          : [];
      if (!ids.length) return { ok: false, summary: "Aucune relance en cours." };
      for (const id of ids) {
        const res = a.action === "arreter" ? await s.stopEnrollmentAction(id) : a.action === "pause" ? await s.pauseEnrollmentAction(id) : await s.resumeEnrollmentAction(id);
        if (!res.ok) return { ok: false, summary: res.error };
      }
      void ctx;
      return { ok: true, summary: `${ids.length} série(s) de relances : ${a.action === "arreter" ? "arrêtée(s)" : a.action === "pause" ? "en pause" : "reprise(s)"}`, link: a.contactId ? `/contacts/${a.contactId}` : "/relances" };
    },
  }),

  // ───────────── Devis ─────────────
  creer_devis: tool({
    description: "Crée un devis en brouillon (produits du catalogue ou lignes libres).",
    schema: z.object({
      contactId: z.string(),
      dealId: n(z.string()),
      titre: n(z.string()),
      lignes: z.array(z.object({ produit: z.string().describe("Nom ou référence du produit, ou désignation libre."), quantite: z.number(), prixUnitaireHT: n(z.number()), remisePct: n(z.number()) })),
      remiseGlobalePct: n(z.number()),
    }),
    async run(a, ctx) {
      const products = await db.product.findMany({ where: { active: true } });
      const items = a.lignes.map((l) => {
        const p = products.find((x) => x.sku?.toLowerCase() === l.produit.toLowerCase()) ?? products.find((x) => x.name.toLowerCase().includes(l.produit.toLowerCase()) || l.produit.toLowerCase().includes(x.name.toLowerCase()));
        return {
          productId: p?.id ?? null,
          name: p?.name ?? l.produit,
          description: p?.description ?? null,
          quantity: l.quantite,
          unitPriceHT: l.prixUnitaireHT ?? (p ? toNumber(p.unitPriceHT) : 0),
          discountPct: l.remisePct ?? 0,
          vatRate: p ? toNumber(p.vatRate) : 20,
        };
      });
      const { createQuoteAction } = await import("@/actions/quotes");
      void ctx;
      const res = await createQuoteAction({ contactId: a.contactId, dealId: a.dealId, title: a.titre, items, globalDiscountPct: a.remiseGlobalePct });
      return unwrap(res, "Devis créé en brouillon", res.ok && res.data ? `/devis/${res.data.id}` : undefined);
    },
  }),

  envoyer_devis: tool({
    description: "Envoie un devis au client par email (PDF joint et lien d'acceptation en ligne).",
    schema: z.object({ quoteId: z.string(), message: n(z.string()) }),
    async confirm({ quoteId }) {
      const q = await db.quote.findUnique({ where: { id: quoteId }, include: { contact: { select: { email: true } } } });
      return q ? `Envoyer le devis ${q.number} (${formatEUR(q.totalHT)} HT) à ${q.contact.email ?? "?"}` : null;
    },
    async run(a) {
      const { getQuoteEmailDefaultsAction, sendQuoteAction } = await import("@/actions/quotes");
      const defaults = await getQuoteEmailDefaultsAction(a.quoteId);
      if (!defaults || !("to" in defaults)) return { ok: false, summary: "Devis introuvable." };
      const d = defaults as { to: string; subject: string; body: string };
      return unwrap(await sendQuoteAction(a.quoteId, { to: d.to, subject: d.subject, body: a.message ?? d.body }), "Devis envoyé", `/devis/${a.quoteId}`);
    },
  }),
};

export type ToolName = keyof typeof TOOLS;

/** Définitions transmises au modèle (fonctions, schéma strict). */
export async function toolDefinitions() {
  const { strictSchema } = await import("@/lib/ai/llm");
  return (Object.entries(TOOLS) as [ToolName, ToolDef<z.ZodType>][]).map(([name, t]) => ({
    type: "function" as const,
    function: { name, description: t.description, strict: true, parameters: strictSchema(t.schema) },
  }));
}
