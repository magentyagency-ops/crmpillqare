import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL n'est pas défini.");
  const pool = new pg.Pool({
    connectionString,
    // Serverless (Vercel) : peu de connexions par instance, le pooler Supabase mutualise
    max: Number(process.env.DATABASE_POOL_SIZE ?? (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 10_000,
    // Les dates sont stockées en TIMESTAMP (sans fuseau) contenant de l'UTC : la session doit être en UTC
    // pour que NOW() et les conversions SQL restent justes quel que soit le fuseau du serveur PostgreSQL.
    onConnect: async (client) => {
      await client.query("SET TIME ZONE 'UTC'");
    },
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const globalForPrisma = globalThis as unknown as { __pillqarePrisma?: PrismaClient };

/** Client Prisma partagé (singleton, survit au rechargement à chaud en développement). */
export const db: PrismaClient = globalForPrisma.__pillqarePrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__pillqarePrisma = db;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Erreur Prisma de contrainte d'unicité (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
