import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// `prisma generate` (build, CI, Docker) n'a pas besoin d'accéder à la base : une URL fictive suffit.
// Les autres commandes (migrate, studio, seed) exigent DATABASE_URL.
const generateOnly = process.argv.includes("generate");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Supabase : DIRECT_URL (connexion directe ou pooler « session ») pour les migrations ; DATABASE_URL (pooler « transaction ») pour l'application
    url: generateOnly ? (process.env.DATABASE_URL ?? "postgresql://build:build@localhost:5432/build") : process.env.DIRECT_URL?.trim() || env("DATABASE_URL"),
  },
});
