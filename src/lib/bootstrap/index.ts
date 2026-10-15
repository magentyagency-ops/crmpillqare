import { db } from "@/lib/db";
import { slugify } from "@/lib/normalize";
import { FORMS, LOST_REASONS, PRODUCTS, SEGMENTS, SEQUENCES, TEMPLATES } from "./seed-data";

/** Installe les données de référence PillQare (idempotent). */
export async function seedReferenceData() {
  for (const [i, s] of SEGMENTS.entries()) {
    const segment = await db.segment.upsert({
      where: { name: s.name },
      create: { ...s, position: i },
      update: {},
    });
    // Mots-clés de détection : complétés une fois pour les cibles existantes sans mots-clés
    if (segment.keywords.length === 0 && s.keywords.length > 0) {
      await db.segment.update({ where: { id: segment.id }, data: { keywords: s.keywords } });
    }
  }
  for (const [i, label] of LOST_REASONS.entries()) {
    await db.lostReason.upsert({ where: { label }, create: { label, position: i }, update: {} });
  }
  for (const p of PRODUCTS) {
    await db.product.upsert({ where: { sku: p.sku }, create: p, update: {} });
  }
  if ((await db.emailTemplate.count()) === 0) {
    for (const t of TEMPLATES) await db.emailTemplate.create({ data: t });
  }
  if ((await db.sequence.count()) === 0) {
    for (const s of SEQUENCES) {
      await db.sequence.create({
        data: {
          name: s.name,
          description: s.description,
          trigger: s.trigger,
          triggerStage: s.triggerStage ?? null,
          contactKind: s.contactKind ?? null,
          priority: s.priority ?? 0,
          steps: {
            create: s.steps.map((st, i) => ({
              position: i + 1,
              type: st.type,
              delayDays: st.delayDays,
              sendTime: st.sendTime ?? null,
              subject: st.subject ?? null,
              body: st.body ?? null,
              taskTitle: st.taskTitle ?? null,
              taskDescription: st.taskDescription ?? null,
              requiresApproval: st.requiresApproval ?? false,
              // Emails des scénarios fournis : personnalisés par l'IA par défaut
              aiPersonalize: st.aiPersonalize ?? st.type === "EMAIL",
            })),
          },
        },
      });
    }
  }
  for (const f of FORMS) {
    await db.webForm.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        name: f.name,
        description: f.description,
        contactKind: f.contactKind,
        callbackDelayMinutes: f.callbackDelayMinutes,
        allowedOrigins: ["https://pillqare.com", "https://www.pillqare.com", "https://commande.pillqare.com"],
      },
      update: {},
    });
  }
}

/** Lien de prise de RDV unique à partir du nom. */
export async function uniqueBookingSlug(base: string, excludeUserId?: string): Promise<string> {
  const root = slugify(base) || "commercial";
  const reserved = new Set(["gerer", "equipe", "api", "admin"]);
  let slug = reserved.has(root) ? `${root}-1` : root;
  for (let i = 2; ; i++) {
    const existing = await db.user.findUnique({ where: { bookingSlug: slug }, select: { id: true } });
    if (!existing || existing.id === excludeUserId) return slug;
    slug = `${root}-${i}`;
  }
}
