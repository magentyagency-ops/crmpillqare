/**
 * Préparation de la configuration : crée `.env` à partir de `.env.example` (s'il n'existe pas)
 * et génère les secrets manquants (ENCRYPTION_KEY, CRON_SECRET). Sans effet sur les valeurs déjà renseignées.
 * Usage : npm run setup [-- --production https://crm.mon-domaine.fr]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

const args = process.argv.slice(2);
const prodIndex = args.indexOf("--production");
const productionUrl = prodIndex >= 0 ? args[prodIndex + 1] : undefined;
if (prodIndex >= 0 && !productionUrl?.startsWith("https://")) {
  console.error("Usage : npm run setup -- --production https://crm.mon-domaine.fr");
  process.exit(1);
}

let content: string;
if (fs.existsSync(envPath)) {
  content = fs.readFileSync(envPath, "utf8");
  console.log("• .env existant conservé (seules les valeurs manquantes sont complétées).");
} else {
  content = fs.readFileSync(examplePath, "utf8");
  console.log("• .env créé à partir de .env.example.");
}

function setValue(key: string, value: string, opts: { onlyIfEmpty?: boolean } = {}) {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(re);
  const current = match?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  if (opts.onlyIfEmpty && current) return false;
  if (match) content = content.replace(re, `${key}="${value}"`);
  else content += `\n${key}="${value}"\n`;
  return true;
}

if (setValue("ENCRYPTION_KEY", crypto.randomBytes(32).toString("hex"), { onlyIfEmpty: true })) console.log("• ENCRYPTION_KEY générée.");
if (setValue("CRON_SECRET", crypto.randomBytes(24).toString("base64url"), { onlyIfEmpty: true })) console.log("• CRON_SECRET généré.");

if (productionUrl) {
  setValue("APP_URL", productionUrl.replace(/\/+$/, ""));
  setValue("EMBEDDED_POSTGRES", "false");
  setValue("EMAIL_DELIVERY", "live");
  setValue("SEED_DEMO", "false");
  console.log(`• Configuration de production : APP_URL=${productionUrl}, envoi réel des emails, base externe.`);
  console.log("  → Renseignez DATABASE_URL avec votre base PostgreSQL de production.");
}

fs.writeFileSync(envPath, content);
console.log("\nÉtapes suivantes :");
console.log(productionUrl ? "  1. Vérifiez DATABASE_URL puis : npm run build && npm run db:deploy && npm start" : "  1. npm run dev   (base embarquée, migrations et données de référence automatiques)");
console.log("  2. Ouvrez l'application : la page /installation crée le compte administrateur.");
console.log("  3. Paramètres → Intégrations : Google, boîtes email, Shopify. Voir README.md.");
