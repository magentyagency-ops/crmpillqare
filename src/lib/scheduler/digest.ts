import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { addDaysTz, dayKey, formatLongDate, formatTime, isWeekendTz, startOfDayTz, timeKey, weekdayTz } from "@/lib/dates";
import { contactDisplayName, MEETING_TYPE_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import { getDailyPlan } from "@/lib/planning";
import { getSettings } from "@/lib/settings";
import { enqueueJob } from "@/lib/jobs";
import { escapeHtml } from "@/lib/email/render";
import { formatEUR } from "@/lib/format";
import { getSalesMetrics, totals } from "@/lib/dashboard";
import { sendInternalEmail } from "@/lib/email/send";

function section(title: string, items: string[]): { html: string; text: string } {
  if (items.length === 0) return { html: "", text: "" };
  return {
    html: `<h3 style="margin:20px 0 8px;font-size:15px;color:#12295A">${escapeHtml(title)}</h3><ul style="margin:0;padding-left:18px">${items
      .map((i) => `<li style="margin:4px 0">${i}</li>`)
      .join("")}</ul>`,
    text: `\n${title}\n${items.map((i) => `- ${i.replace(/<[^>]+>/g, "")}`).join("\n")}\n`,
  };
}

/** Email « Votre journée » envoyé chaque matin ouvré à chaque commercial. */
export async function buildDigest(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, timezone: true, email: true } });
  const plan = await getDailyPlan(userId);
  const link = (path: string, label: string) => `<a href="${env.appUrl}${path}" style="color:#12295A">${escapeHtml(label)}</a>`;
  const parts = [
    section(
      `📅 Rendez-vous (${plan.meetings.length})`,
      plan.meetings.map(
        (m) => `<strong>${formatTime(m.startAt, plan.tz)}</strong> — ${link(`/agenda/${m.id}`, m.title)} (${MEETING_TYPE_LABELS[m.type]})${m.contact ? ` · ${escapeHtml(contactDisplayName(m.contact))}` : ""}`,
      ),
    ),
    section(
      `📞 Appels à passer (${plan.calls.length})`,
      plan.calls.map(
        (t) =>
          `${link(`/taches?task=${t.id}`, t.title)}${t.contact?.phone ? ` · ${escapeHtml(t.contact.phone)}` : ""}${t.dueAt && t.dueAt < plan.dayStart ? ' <span style="color:#dc2626">(en retard)</span>' : ""}`,
      ),
    ),
    section(
      `🔁 Relances (${plan.followUps.length + plan.approvals.length})`,
      [
        ...plan.approvals.map((a) => `${link("/relances?tab=validate", `À valider : ${a.step.subject ?? "email"}`)} · ${escapeHtml(contactDisplayName(a.enrollment.contact))}`),
        ...plan.followUps.map((t) => link(`/taches?task=${t.id}`, t.title)),
        ...(plan.autoEmailsToday ? [`${plan.autoEmailsToday} relance(s) automatique(s) partiront aujourd'hui`] : []),
      ],
    ),
    section(
      `✉️ Réponses à traiter (${plan.replies.length})`,
      plan.replies.map((r) => `${link(`/contacts/${r.contactId}?tab=emails`, r.subject)} · ${escapeHtml(contactDisplayName(r.contact))}`),
    ),
    section(`📝 Comptes rendus à valider (${plan.reports.length})`, plan.reports.map((r) => link(`/assistant/${r.id}`, r.title))),
    section(
      `✅ Autres tâches (${plan.otherTasks.length})`,
      plan.otherTasks.map((t) => `${link(`/taches?task=${t.id}`, t.title)} (${TASK_TYPE_LABELS[t.type]})`),
    ),
    section(
      `⚠️ Dossiers à débloquer (${plan.attention.length})`,
      plan.attention.slice(0, 15).map((a) => link(`/pipeline/${a.deal.id}`, a.deal.title)),
    ),
    section(`🆕 Nouveaux leads à contacter (${plan.newLeads.length})`, plan.newLeads.map((d) => link(`/pipeline/${d.id}`, d.title))),
  ];
  const nothing = parts.every((p) => !p.html);
  const subject = `Votre journée du ${formatLongDate(new Date(), plan.tz)} — ${plan.counts.meetings} RDV, ${plan.counts.calls} appels, ${plan.counts.followUps} relances`;
  const intro = nothing
    ? "Rien de prévu pour aujourd'hui : c'est le moment de prospecter !"
    : plan.overdueCount
      ? `Vous avez ${plan.overdueCount} élément(s) en retard : commencez par eux.`
      : "Voici votre programme du jour.";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;max-width:640px">
<p>Bonjour ${escapeHtml(user.firstName)},</p><p>${escapeHtml(intro)}</p>${parts.map((p) => p.html).join("")}
<p style="margin-top:24px">${link("/aujourdhui", "Ouvrir mon planning dans le CRM")}</p></div>`;
  const text = `Bonjour ${user.firstName},\n\n${intro}\n${parts.map((p) => p.text).join("")}\n${env.appUrl}/aujourdhui`;
  return { subject, html, text, to: user.email };
}

/** Envoi du planning quotidien (jours ouvrés, à l'heure configurée, une seule fois par jour). */
export async function sendDailyDigests(): Promise<number> {
  const settings = await getSettings("digest");
  if (!settings.enabled) return 0;
  const users = await db.user.findMany({ where: { active: true, dailyDigest: true }, select: { id: true, timezone: true, role: true } });
  let sent = 0;
  const now = new Date();
  for (const u of users) {
    if (isWeekendTz(now, u.timezone)) continue;
    if (timeKey(now, u.timezone) < settings.hour) continue;
    const key = `digest:${u.id}:${dayKey(now, u.timezone)}`;
    const job = await enqueueJob("digest.send", { userId: u.id }, { dedupeKey: key, maxAttempts: 3 });
    if (job) sent++;
  }
  // Synthèse hebdomadaire aux managers le lundi
  if (settings.managerWeekly) {
    for (const u of users.filter((x) => x.role !== "SALES")) {
      if (weekdayTz(now, u.timezone) !== 1) continue; // lundi
      if (timeKey(now, u.timezone) < settings.hour) continue;
      await enqueueJob("digest.weekly", { userId: u.id }, { dedupeKey: `weekly:${u.id}:${dayKey(now, u.timezone)}`, maxAttempts: 3 });
    }
  }
  return sent;
}

export async function sendDigestNow(userId: string) {
  const d = await buildDigest(userId);
  await sendInternalEmail(userId, { subject: d.subject, text: d.text, html: d.html });
}

/** Synthèse hebdomadaire pour les managers : activité de l'équipe la semaine passée. */
export async function sendWeeklySummary(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, timezone: true } });
  const to = startOfDayTz(new Date(), user.timezone);
  const from = addDaysTz(to, -7, user.timezone);
  const rows = await getSalesMetrics({ from, to });
  const t = totals(rows);
  const head = ["Commercial", "Appels", "RDV", "Relances", "Devis", "Signés", "CA", "Bloqués"];
  const tr = (cells: string[], bold = false) =>
    `<tr>${cells.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;${bold ? "font-weight:600" : ""}">${c}</td>`).join("")}</tr>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1f2937">
<p>Bonjour ${escapeHtml(user.firstName)},</p><p>Voici l'activité commerciale des 7 derniers jours.</p>
<table style="border-collapse:collapse;font-size:13px"><thead>${tr(head, true)}</thead><tbody>
${rows.map((r) => tr([escapeHtml(r.name), String(r.calls), String(r.meetingsHeld), String(r.followUpsDone), String(r.quotesSent), String(r.dealsWon), formatEUR(r.revenue, { compact: true }), String(r.blockedDeals)])).join("")}
${tr(["Total", String(t.calls), String(t.meetingsHeld), String(t.followUpsDone), String(t.quotesSent), String(t.dealsWon), formatEUR(t.revenue, { compact: true }), String(t.blockedDeals)], true)}
</tbody></table><p><a href="${env.appUrl}/tableau-de-bord" style="color:#12295A">Voir le tableau de bord</a></p></div>`;
  const text = `Activité des 7 derniers jours\n${rows.map((r) => `${r.name} : ${r.calls} appels, ${r.meetingsHeld} RDV, ${r.followUpsDone} relances, ${r.quotesSent} devis, ${r.dealsWon} signés, ${formatEUR(r.revenue)} , ${r.blockedDeals} bloqués`).join("\n")}`;
  await sendInternalEmail(userId, { subject: "Synthèse commerciale hebdomadaire — PillQare", html, text });
}
