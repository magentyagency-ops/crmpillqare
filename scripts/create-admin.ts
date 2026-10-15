/**
 * Crée un compte administrateur et affiche son lien d'activation (valable 7 jours) :
 * la personne choisit elle-même son mot de passe, puis invite son équipe depuis Paramètres → Équipe.
 * Usage : npx tsx scripts/create-admin.ts email@domaine.fr Prénom Nom
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { env } from "../src/lib/env";
import { randomToken, sha256 } from "../src/lib/crypto";
import { uniqueBookingSlug } from "../src/lib/bootstrap";

const [emailArg, firstName, ...last] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const lastName = last.join(" ");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName) {
  console.error("Usage : npx tsx scripts/create-admin.ts email@domaine.fr Prénom Nom");
  process.exit(1);
}

const existing = await db.user.findUnique({ where: { email } });
const user =
  existing ??
  (await db.user.create({
    data: {
      email,
      firstName,
      lastName,
      role: "ADMIN",
      color: "#12295A",
      bookingSlug: await uniqueBookingSlug(`${firstName}-${lastName}`),
      signature: `${firstName} ${lastName} — PillQare`,
    },
  }));
if (existing && existing.role !== "ADMIN") await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN", active: true } });

const token = randomToken(32);
await db.userToken.create({ data: { userId: user.id, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
console.log(`✓ Administrateur ${existing ? "existant" : "créé"} : ${firstName} ${lastName} <${email}>`);
console.log(`  Lien d'activation (7 jours) : ${env.appUrl}/reinitialiser/${token}`);
await db.$disconnect();
