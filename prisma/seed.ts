/**
 * Initialisation de la base :
 *   npm run db:seed               → données de référence (cibles, produits, modèles, relances, formulaires)
 * Administrateur initial : SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (sinon page /installation).
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { seedReferenceData, uniqueBookingSlug } from "../src/lib/bootstrap";

async function seedReference() {
  await seedReferenceData();
  console.log("✓ Données de référence PillQare");
}

async function uniqueSlug(base: string) {
  return uniqueBookingSlug(base);
}

async function seedAdmin() {
  const count = await db.user.count();
  if (count > 0) return;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("ℹ Aucun administrateur : ouvrez /installation pour créer le premier compte.");
    return;
  }
  await db.user.create({
    data: {
      email,
      firstName: process.env.SEED_ADMIN_FIRSTNAME ?? "Admin",
      lastName: process.env.SEED_ADMIN_LASTNAME ?? "PillQare",
      role: "ADMIN",
      passwordHash: await hashPassword(password),
      bookingSlug: await uniqueSlug(`${process.env.SEED_ADMIN_FIRSTNAME ?? "admin"}`),
    },
  });
  console.log(`✓ Administrateur créé : ${email}`);
}

async function main() {
  await seedReference();
  await seedAdmin();
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
