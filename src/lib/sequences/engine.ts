import type { ContactKind, DealStage, EnrollmentStopReason, SequenceTrigger } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { contactDisplayName, STOP_REASON_LABELS } from "@/lib/labels";
import { composeEmail, renderTemplate } from "@/lib/email/render";
import { buildTemplateVars, unsubscribeUrl } from "@/lib/email/vars";
import { addBusinessDaysTz, clampToBusinessWindow } from "@/lib/dates";
import { computeSchedule, nextStepDate } from "./schedule";

type TriggerContext = {
  stage?: DealStage | null;
  contactKind?: ContactKind | null;
  segmentId?: string | null;
};

/** Séquence la plus prioritaire correspondant au déclencheur et au profil du contact. */
export async function findMatchingSequence(trigger: SequenceTrigger, ctx: TriggerContext) {
  const sequences = await db.sequence.findMany({
    where: {
      active: true,
      createdByAssistant: false,
      trigger,
      ...(trigger === "STAGE_ENTERED" ? { triggerStage: ctx.stage ?? undefined } : {}),
      OR: [{ contactKind: null }, ...(ctx.contactKind ? [{ contactKind: ctx.contactKind }] : [])],
      steps: { some: { archivedAt: null } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  // Une séquence ciblée (par cible) passe avant une séquence générique
  const specific = sequences.filter((s) => s.segmentIds.length > 0 && ctx.segmentId && s.segmentIds.includes(ctx.segmentId));
  if (specific.length) return specific[0]!;
  return sequences.find((s) => s.segmentIds.length === 0) ?? null;
}

export type EnrollInput = {
  sequenceId: string;
  contactId: string;
  ownerId: string;
  dealId?: string | null;
  orderId?: string | null;
  quoteId?: string | null;
  trialId?: string | null;
  startAt?: Date;
};

/** Inscrit un contact (et son dossier) dans une séquence : toutes les relances sont planifiées. */
export async function enroll(input: EnrollInput) {
  const sequence = await db.sequence.findUniqueOrThrow({
    where: { id: input.sequenceId },
    include: { steps: { where: { archivedAt: null }, orderBy: { position: "asc" } } },
  });
  if (!sequence.active || sequence.steps.length === 0) return null;

  const duplicate = await db.sequenceEnrollment.findFirst({
    where: {
      sequenceId: sequence.id,
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(input.dealId ? { dealId: input.dealId } : input.orderId ? { orderId: input.orderId } : { contactId: input.contactId }),
    },
  });
  if (duplicate) return duplicate;

  const contact = await db.contact.findUniqueOrThrow({
    where: { id: input.contactId },
    select: { id: true, doNotContact: true, email: true, firstName: true, lastName: true, phone: true },
  });
  const settings = await getSettings("followups");
  const owner = await db.user.findUnique({ where: { id: input.ownerId }, select: { timezone: true } });
  const start = input.startAt ?? new Date();
  const dates = computeSchedule(sequence.steps, start, {
    windowStart: settings.windowStart,
    windowEnd: settings.windowEnd,
    skipWeekends: settings.skipWeekends,
    tz: owner?.timezone,
    businessHours: sequence.businessHoursOnly,
  });
  const cannotEmail = contact.doNotContact || !contact.email;

  const enrollment = await db.sequenceEnrollment.create({
    data: {
      sequenceId: sequence.id,
      contactId: contact.id,
      dealId: input.dealId ?? null,
      orderId: input.orderId ?? null,
      quoteId: input.quoteId ?? null,
      trialId: input.trialId ?? null,
      ownerId: input.ownerId,
      startedAt: start,
      runs: {
        create: sequence.steps.map((step, i) => ({
          stepId: step.id,
          position: step.position,
          type: step.type,
          scheduledAt: dates[i]!,
          status: step.type === "EMAIL" && cannotEmail ? "SKIPPED" : "SCHEDULED",
          error: step.type === "EMAIL" && cannotEmail ? (contact.doNotContact ? "Contact désinscrit" : "Pas d'adresse email") : null,
        })),
      },
    },
  });

  await logActivity({
    type: "SEQUENCE_EVENT",
    title: `Relances automatiques « ${sequence.name} » démarrées`,
    body: `${sequence.steps.length} étape(s) planifiée(s).`,
    contactId: contact.id,
    dealId: input.dealId ?? null,
  });
  if (input.dealId) {
    const { refreshDealNextAction } = await import("@/lib/deals");
    await refreshDealNextAction(input.dealId);
  }
  return enrollment;
}

/** Inscription automatique selon un déclencheur et le profil du contact. */
export async function autoEnroll(trigger: SequenceTrigger, input: Omit<EnrollInput, "sequenceId"> & TriggerContext) {
  let ctx: TriggerContext = { stage: input.stage, contactKind: input.contactKind, segmentId: input.segmentId };
  if (!ctx.contactKind || ctx.segmentId === undefined) {
    const c = await db.contact.findUnique({ where: { id: input.contactId }, select: { kind: true, segmentId: true } });
    ctx = { ...ctx, contactKind: ctx.contactKind ?? c?.kind ?? null, segmentId: ctx.segmentId ?? c?.segmentId ?? null };
  }
  const sequence = await findMatchingSequence(trigger, ctx);
  if (!sequence) return null;
  return enroll({ ...input, sequenceId: sequence.id });
}

/** Arrête une inscription : les relances futures sont annulées (ainsi que les tâches de relance ouvertes). */
export async function stopEnrollment(enrollmentId: string, reason: EnrollmentStopReason) {
  const enrollment = await db.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { sequence: { select: { name: true } } },
  });
  if (!enrollment || !["ACTIVE", "PAUSED"].includes(enrollment.status)) return;
  const now = new Date();
  await db.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { status: "STOPPED", stopReason: reason, stoppedAt: now },
  });
  await db.sequenceStepRun.updateMany({
    where: { enrollmentId, status: { in: ["SCHEDULED", "PENDING_APPROVAL", "PROCESSING"] } },
    data: { status: "CANCELLED", error: STOP_REASON_LABELS[reason] },
  });
  const openTaskRuns = await db.sequenceStepRun.findMany({
    where: { enrollmentId, status: "TASK_OPEN" },
    select: { id: true, task: { select: { id: true, status: true } } },
  });
  for (const run of openTaskRuns) {
    await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "CANCELLED", error: STOP_REASON_LABELS[reason] } });
    if (run.task?.status === "OPEN") {
      await db.task.update({ where: { id: run.task.id }, data: { status: "CANCELLED" } });
    }
  }
  await logActivity({
    type: "SEQUENCE_EVENT",
    title: `Relances « ${enrollment.sequence.name} » arrêtées`,
    body: STOP_REASON_LABELS[reason],
    contactId: enrollment.contactId,
    dealId: enrollment.dealId,
  });
  if (enrollment.dealId) {
    const { refreshDealNextAction } = await import("@/lib/deals");
    await refreshDealNextAction(enrollment.dealId);
  }
}

export async function stopContactEnrollments(contactId: string, reason: EnrollmentStopReason, filter: Prisma.SequenceEnrollmentWhereInput = {}) {
  const list = await db.sequenceEnrollment.findMany({
    where: { contactId, status: { in: ["ACTIVE", "PAUSED"] }, ...filter },
    select: { id: true },
  });
  for (const e of list) await stopEnrollment(e.id, reason);
  return list.length;
}

/**
 * Le dossier change d'étape : on arrête les relances liées à l'ancienne étape et on démarre
 * celles prévues pour la nouvelle étape (selon le profil B2B/B2C et la cible).
 */
export async function onDealStageChanged(dealId: string, from: DealStage | null, to: DealStage, opts: { stopOnly?: boolean } = {}) {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, contactId: true, ownerId: true, kind: true, segmentId: true },
  });
  if (!deal) return;
  const closed = to === "WON" || to === "LOST";
  if (from !== null) {
    const active = await db.sequenceEnrollment.findMany({
      where: { dealId, status: { in: ["ACTIVE", "PAUSED"] } },
      include: { sequence: { select: { stopOnStageChange: true, trigger: true } } },
    });
    for (const e of active) {
      if (closed) await stopEnrollment(e.id, "DEAL_CLOSED");
      else if (e.sequence.stopOnStageChange) await stopEnrollment(e.id, "STAGE_CHANGED");
    }
  }
  if (opts.stopOnly || closed) return;
  await autoEnroll("STAGE_ENTERED", {
    contactId: deal.contactId,
    dealId: deal.id,
    ownerId: deal.ownerId,
    stage: to,
    contactKind: deal.kind,
    segmentId: deal.segmentId,
  });
}

/** Le prospect a répondu : arrêt immédiat des relances concernées. */
export async function onContactReplied(contactId: string, at: Date) {
  // Marque la dernière relance envoyée comme « répondue »
  const lastSent = await db.sequenceStepRun.findFirst({
    where: { status: "SENT", repliedAt: null, executedAt: { lte: at }, enrollment: { contactId } },
    orderBy: { executedAt: "desc" },
  });
  if (lastSent) await db.sequenceStepRun.update({ where: { id: lastSent.id }, data: { repliedAt: at } });

  const active = await db.sequenceEnrollment.findMany({
    where: { contactId, status: { in: ["ACTIVE", "PAUSED"] }, startedAt: { lte: at }, sequence: { stopOnReply: true } },
    select: { id: true },
  });
  for (const e of active) await stopEnrollment(e.id, "REPLIED");
}

/** Un RDV a été pris : les relances de prospection n'ont plus lieu d'être. */
export async function onMeetingBooked(contactId: string) {
  return stopContactEnrollments(contactId, "MEETING_BOOKED", { sequence: { stopOnMeetingBooked: true } });
}

// ───────────── Exécution des étapes ─────────────

/** Exécute les relances arrivées à échéance (appelé chaque minute par le planificateur). */
export async function processDueSteps(limit = 40): Promise<number> {
  const due = await db.sequenceStepRun.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() }, enrollment: { status: "ACTIVE" } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  for (const { id } of due) {
    // Réservation atomique (évite le double envoi si plusieurs instances)
    const claimed = await db.sequenceStepRun.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "PROCESSING" } });
    if (claimed.count === 0) continue;
    try {
      await executeStepRun(id);
      processed++;
    } catch (error) {
      console.error("[sequences] étape", id, error);
    }
  }
  return processed;
}

/** Exécute une étape : envoi d'email (ou mise en validation) ou création de tâche d'appel. */
export async function executeStepRun(runId: string, opts: { approved?: boolean } = {}) {
  const run = await db.sequenceStepRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      step: true,
      enrollment: {
        include: {
          sequence: true,
          contact: { select: { id: true, email: true, doNotContact: true, archivedAt: true, firstName: true, lastName: true, phone: true, unsubscribeToken: true, ownerId: true } },
          deal: { select: { id: true, stage: true, title: true } },
        },
      },
    },
  });
  const { enrollment, step } = run;
  const contact = enrollment.contact;
  const now = new Date();

  const skip = async (reason: string) => {
    await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "SKIPPED", executedAt: now, error: reason } });
    await afterStep(run.enrollmentId, run.position, now);
  };

  if (enrollment.status !== "ACTIVE") {
    await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "CANCELLED", error: "Inscription inactive" } });
    return;
  }
  if (contact.archivedAt) return skip("Contact archivé");
  if (enrollment.deal && (enrollment.deal.stage === "WON" || enrollment.deal.stage === "LOST")) {
    await stopEnrollment(enrollment.id, "DEAL_CLOSED");
    return;
  }

  // Envoi automatique hors plage (nuit, week-end — ex. après une interruption du serveur) : reporté au prochain créneau
  if (step.type === "EMAIL" && !opts.approved && !step.requiresApproval && enrollment.sequence.businessHoursOnly) {
    const window = await getSettings("followups");
    const owner = await db.user.findUnique({ where: { id: enrollment.ownerId }, select: { timezone: true } });
    const next = clampToBusinessWindow(now, { start: window.windowStart, end: window.windowEnd, skipWeekends: window.skipWeekends, tz: owner?.timezone });
    if (next.getTime() - now.getTime() > 60_000) {
      await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "SCHEDULED", scheduledAt: next } });
      return;
    }
  }

  const vars = await buildTemplateVars({
    contactId: contact.id,
    dealId: enrollment.dealId,
    userId: enrollment.ownerId,
    orderId: enrollment.orderId,
    quoteId: enrollment.quoteId,
  });

  if (step.type === "EMAIL") {
    if (!contact.email) return skip("Pas d'adresse email");
    if (contact.doNotContact) return skip("Contact désinscrit");
    // Personnalisation IA : faite avant la validation pour que le commercial relise la version qui partira
    const personalized = await personalizeRun(run, step, enrollment, contact, vars);
    if (step.requiresApproval && !opts.approved) {
      await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "PENDING_APPROVAL" } });
      await notify({
        userId: enrollment.ownerId,
        type: "APPROVAL_NEEDED",
        title: `Relance à valider pour ${contactDisplayName(contact)}`,
        body: renderTemplate(personalized?.subject ?? run.subjectOverride ?? step.subject ?? "Relance", vars),
        link: `/relances?tab=validate`,
      });
      return;
    }
    const owner = await db.user.findUniqueOrThrow({ where: { id: enrollment.ownerId }, select: { signature: true } });
    const followSettings = await getSettings("followups");

    // Sans objet : la relance est envoyée en réponse dans le fil du premier email de la séquence
    let replyToId: string | null = null;
    let subjectTemplate = personalized?.subject ?? run.subjectOverride ?? step.subject ?? "";
    if (!subjectTemplate.trim()) {
      const firstEmail = await db.emailMessage.findFirst({
        where: { stepRun: { enrollmentId: enrollment.id }, status: "SENT" },
        orderBy: { sentAt: "asc" },
        select: { id: true, subject: true },
      });
      replyToId = firstEmail?.id ?? null;
      subjectTemplate = firstEmail ? (firstEmail.subject.startsWith("Re:") ? firstEmail.subject : `Re: ${firstEmail.subject}`) : "Suite à mon précédent message";
    }
    const composed = composeEmail({
      subject: subjectTemplate,
      body: personalized?.body ?? run.bodyOverride ?? step.body ?? "",
      vars,
      signature: owner.signature,
      unsubscribeUrl: followSettings.unsubscribeFooter ? unsubscribeUrl(contact.unsubscribeToken) : null,
    });
    try {
      const { sendEmail } = await import("@/lib/email/send");
      await sendEmail({
        senderId: enrollment.ownerId,
        to: [contact.email],
        subject: composed.subject,
        text: composed.text,
        html: composed.html,
        contactId: contact.id,
        dealId: enrollment.dealId,
        replyToId,
        stepRunId: run.id,
        isAutomated: true,
      });
      await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "SENT", executedAt: new Date(), error: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = run.attempts + 1;
      if (attempts < 3) {
        await db.sequenceStepRun.update({
          where: { id: run.id },
          data: { status: "SCHEDULED", attempts, error: message, scheduledAt: new Date(Date.now() + 15 * 60_000 * attempts) },
        });
      } else {
        await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "FAILED", attempts, error: message, executedAt: new Date() } });
        await notify({
          userId: enrollment.ownerId,
          type: "SYSTEM",
          title: `Échec d'envoi d'une relance à ${contactDisplayName(contact)}`,
          body: message,
          link: `/relances?tab=failed`,
        });
      }
      return;
    }
  } else {
    const { createTask } = await import("@/lib/tasks");
    const title = renderTemplate(
      step.taskTitle || (step.type === "CALL" ? "Appeler {{contact.fullName}} (relance)" : "Relance : {{contact.fullName}}"),
      vars,
    );
    await createTask({
      title,
      description: step.taskDescription ? renderTemplate(step.taskDescription, vars) : `Étape ${run.position} de la séquence « ${enrollment.sequence.name} ».`,
      type: step.type === "CALL" ? "CALL" : enrollment.orderId ? inferPostPurchaseType(title) : "FOLLOW_UP",
      source: "SEQUENCE",
      priority: "NORMAL",
      dueAt: run.scheduledAt,
      hasTime: false,
      assigneeId: enrollment.ownerId,
      contactId: contact.id,
      dealId: enrollment.dealId,
      orderId: enrollment.orderId,
      trialId: enrollment.trialId,
      stepRunId: run.id,
    });
    await db.sequenceStepRun.update({ where: { id: run.id }, data: { status: "TASK_OPEN", executedAt: new Date() } });
  }
  await afterStep(run.enrollmentId, run.position, new Date());
}

/**
 * Réécrit l'email de l'étape pour ce contact (une seule fois par relance). Les contenus déjà modifiés
 * par le commercial ou déjà personnalisés sont conservés. En cas d'échec de l'IA, le modèle est envoyé tel quel.
 */
async function personalizeRun(
  run: { id: string; position: number; aiPersonalized: boolean; subjectOverride: string | null; bodyOverride: string | null },
  step: { aiPersonalize: boolean; subject: string | null; body: string | null },
  enrollment: { ownerId: string; dealId: string | null; sequence: { name: string } },
  contact: { id: string },
  vars: Record<string, unknown>,
): Promise<{ subject: string | null; body: string } | null> {
  if (!step.aiPersonalize || run.aiPersonalized || run.bodyOverride) return null;
  const { llmAvailable } = await import("@/lib/ai/llm");
  if (!llmAvailable()) return null;
  const threaded = !(run.subjectOverride ?? step.subject ?? "").trim();
  try {
    const { personalizeSequenceEmail } = await import("@/lib/ai/writer");
    const res = await personalizeSequenceEmail({
      userId: enrollment.ownerId,
      contactId: contact.id,
      dealId: enrollment.dealId,
      subject: renderTemplate(run.subjectOverride ?? step.subject ?? "", vars),
      body: renderTemplate(step.body ?? "", vars),
      stepLabel: `${enrollment.sequence.name}, étape ${run.position}`,
      threaded,
    });
    const subject = threaded ? null : res.subject;
    await db.sequenceStepRun.update({ where: { id: run.id }, data: { aiPersonalized: true, subjectOverride: subject, bodyOverride: res.body } });
    return { subject, body: res.body };
  } catch (error) {
    console.error("[sequences] personnalisation IA impossible, envoi du modèle :", error instanceof Error ? error.message : error);
    return null;
  }
}

function inferPostPurchaseType(title: string) {
  const t = title.toLowerCase();
  if (t.includes("install")) return "INSTALLATION" as const;
  if (t.includes("prise en main") || t.includes("onboarding")) return "ONBOARDING" as const;
  if (t.includes("satisf")) return "SATISFACTION" as const;
  return "FOLLOW_UP" as const;
}

/** Après une étape : replanifie les suivantes si l'exécution a été retardée et clôt la séquence à la fin. */
async function afterStep(enrollmentId: string, position: number, executedAt: Date) {
  const enrollment = await db.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { runs: { include: { step: true }, orderBy: { position: "asc" } }, owner: { select: { timezone: true } }, sequence: { select: { businessHoursOnly: true } } },
  });
  if (!enrollment) return;
  const remaining = enrollment.runs.filter((r) => r.position > position && r.status === "SCHEDULED");
  if (remaining.length) {
    const settings = await getSettings("followups");
    const opts = { windowStart: settings.windowStart, windowEnd: settings.windowEnd, skipWeekends: settings.skipWeekends, tz: enrollment.owner.timezone, businessHours: enrollment.sequence.businessHoursOnly };
    let prev = executedAt;
    for (const r of remaining) {
      const planned = nextStepDate(prev, r.step, opts);
      // On ne décale que si l'étape précédente a été exécutée en retard
      if (planned.getTime() > r.scheduledAt.getTime() + 3600_000) {
        await db.sequenceStepRun.update({ where: { id: r.id }, data: { scheduledAt: planned } });
        prev = planned;
      } else {
        prev = r.scheduledAt;
      }
    }
  }
  const pending = enrollment.runs.some((r) => ["SCHEDULED", "PROCESSING", "PENDING_APPROVAL"].includes(r.status) && r.position !== position);
  if (!pending && enrollment.status === "ACTIVE") {
    await db.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  if (enrollment.dealId) {
    const { refreshDealNextAction } = await import("@/lib/deals");
    await refreshDealNextAction(enrollment.dealId);
  }
}

// ───────────── Actions manuelles sur les relances ─────────────

export async function approveStepRun(runId: string, edits: { subject?: string | null; body?: string | null } = {}) {
  const run = await db.sequenceStepRun.findUniqueOrThrow({ where: { id: runId } });
  if (!["PENDING_APPROVAL", "SCHEDULED"].includes(run.status)) throw new Error("Cette relance ne peut plus être validée.");
  const claimed = await db.sequenceStepRun.updateMany({
    where: { id: runId, status: run.status },
    data: {
      status: "PROCESSING",
      ...(edits.subject !== undefined ? { subjectOverride: edits.subject } : {}),
      ...(edits.body !== undefined ? { bodyOverride: edits.body } : {}),
    },
  });
  if (claimed.count === 0) throw new Error("Relance déjà traitée.");
  await executeStepRun(runId, { approved: true });
  return db.sequenceStepRun.findUniqueOrThrow({ where: { id: runId } });
}

export async function updateStepRunContent(runId: string, edits: { subject?: string | null; body?: string | null; scheduledAt?: Date | null }) {
  const run = await db.sequenceStepRun.findUniqueOrThrow({ where: { id: runId } });
  if (!["PENDING_APPROVAL", "SCHEDULED"].includes(run.status)) throw new Error("Cette relance ne peut plus être modifiée.");
  return db.sequenceStepRun.update({
    where: { id: runId },
    data: {
      ...(edits.subject !== undefined ? { subjectOverride: edits.subject } : {}),
      ...(edits.body !== undefined ? { bodyOverride: edits.body } : {}),
      ...(edits.scheduledAt ? { scheduledAt: edits.scheduledAt } : {}),
    },
  });
}

export async function skipStepRun(runId: string) {
  const run = await db.sequenceStepRun.findUniqueOrThrow({ where: { id: runId } });
  if (!["PENDING_APPROVAL", "SCHEDULED", "FAILED"].includes(run.status)) throw new Error("Cette relance ne peut plus être ignorée.");
  await db.sequenceStepRun.update({ where: { id: runId }, data: { status: "SKIPPED", executedAt: new Date(), error: "Ignorée manuellement" } });
  await afterStep(run.enrollmentId, run.position, new Date());
}

/** Exécute immédiatement une relance planifiée (« Envoyer maintenant »). */
export async function runStepNow(runId: string) {
  const claimed = await db.sequenceStepRun.updateMany({ where: { id: runId, status: { in: ["SCHEDULED", "FAILED"] } }, data: { status: "PROCESSING", attempts: 0 } });
  if (claimed.count === 0) throw new Error("Relance déjà traitée.");
  await executeStepRun(runId, { approved: true });
}

export async function pauseEnrollment(enrollmentId: string) {
  await db.sequenceEnrollment.updateMany({ where: { id: enrollmentId, status: "ACTIVE" }, data: { status: "PAUSED" } });
}

export async function resumeEnrollment(enrollmentId: string) {
  const e = await db.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { owner: { select: { timezone: true } }, sequence: { select: { businessHoursOnly: true } } } });
  if (e.status !== "PAUSED") return;
  const settings = await getSettings("followups");
  const soon = new Date(Date.now() + (e.sequence.businessHoursOnly ? 5 * 60_000 : 60_000));
  const nextSlot = !e.sequence.businessHoursOnly ? soon : clampToBusinessWindow(soon, {
    start: settings.windowStart,
    end: settings.windowEnd,
    skipWeekends: settings.skipWeekends,
    tz: e.owner.timezone,
  });
  await db.sequenceStepRun.updateMany({
    where: { enrollmentId, status: "SCHEDULED", scheduledAt: { lt: nextSlot } },
    data: { scheduledAt: nextSlot },
  });
  await db.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: "ACTIVE" } });
}

/**
 * Le commercial vient d'écrire lui-même au contact : la prochaine relance automatique par email
 * prévue sous 48 h est décalée de 2 jours ouvrés (ainsi que les étapes suivantes), pour éviter deux emails coup sur coup.
 */
export async function onManualEmailSent(contactId: string) {
  const soon = new Date(Date.now() + 48 * 3600_000);
  const next = await db.sequenceStepRun.findMany({
    where: { status: "SCHEDULED", type: "EMAIL", scheduledAt: { lte: soon }, enrollment: { contactId, status: "ACTIVE" } },
    orderBy: { scheduledAt: "asc" },
    select: { enrollmentId: true, scheduledAt: true },
  });
  const settings = await getSettings("followups");
  const done = new Set<string>();
  for (const run of next) {
    if (done.has(run.enrollmentId)) continue;
    done.add(run.enrollmentId);
    const enrollment = await db.sequenceEnrollment.findUnique({ where: { id: run.enrollmentId }, select: { owner: { select: { timezone: true } } } });
    const tz = enrollment?.owner.timezone;
    const later = await db.sequenceStepRun.findMany({ where: { enrollmentId: run.enrollmentId, status: "SCHEDULED", scheduledAt: { gte: run.scheduledAt } }, select: { id: true, scheduledAt: true } });
    for (const r of later) {
      const shifted = clampToBusinessWindow(addBusinessDaysTz(r.scheduledAt, 2, tz), { start: settings.windowStart, end: settings.windowEnd, skipWeekends: settings.skipWeekends, tz });
      await db.sequenceStepRun.update({ where: { id: r.id }, data: { scheduledAt: shifted } });
    }
  }
}

/** Le dossier passe en « Contacté » après un email du commercial seulement s'il y a un échange réel (le contact a déjà écrit). */
export async function isRealExchange(contactId: string | null | undefined): Promise<boolean> {
  if (!contactId) return false;
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { lastInboundAt: true } });
  return Boolean(c?.lastInboundAt);
}
