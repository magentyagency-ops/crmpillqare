import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le CRM est entièrement dynamique (données par utilisateur) : rendu à la requête.
  poweredByHeader: false,
  // Bibliothèques Node (IMAP, SMTP, Postgres, parsing MIME) chargées telles quelles côté serveur.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer", "pg", "embedded-postgres", "sanitize-html"],
  experimental: {
    // Cache disque de Turbopack désactivé en dev : un cache incohérent provoquait des rechargements en boucle
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      // Pièces jointes / imports CSV / segments audio
      bodySizeLimit: "25mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), display-capture=(self)" },
        ],
      },
      {
        // Pages internes : non intégrables dans une iframe tierce
        source: "/((?!f/|embed/|api/public/).*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
