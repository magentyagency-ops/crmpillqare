import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Tests de logique pure : aucune connexion à la base (le client n'est jamais sollicité)
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
      ENCRYPTION_KEY: "f".repeat(64),
      APP_URL: "https://crm.example.com",
      TZ: "America/New_York",
    },
  },
});
