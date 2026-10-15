import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { requireUser, isAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { aiAvailable } from "@/lib/ai/report";
import { llmProviderLabel } from "@/lib/ai/llm";
import { transcriptionProviderLabel } from "@/lib/ai/transcription";
import { hasScope, GOOGLE_SCOPES } from "@/lib/google/oauth";
import { getGoogleCredentials } from "@/lib/google/config";
import { formatRelative } from "@/lib/dates";
import { SectionCard } from "@/components/common/ui-bits";
import { GoogleSection, ImapForm, MailboxList, ShopifySection, UrlToast } from "./integrations-client";

export const metadata = { title: "Intégrations" };

function Status({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? CircleAlert : XCircle;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${ok ? "text-emerald-600" : warn ? "text-amber-600" : "text-rose-600"}`} />
      <span>{children}</span>
    </li>
  );
}

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [google, mailboxes, shopify] = await Promise.all([
    db.googleAccount.findUnique({ where: { userId: user.id } }),
    db.mailbox.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    isAdmin(user) ? db.shopifyConnection.findFirst() : null,
  ]);
  const googleCreds = await getGoogleCredentials();
  const missingScopes = google ? GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !hasScope(google, s)) : [];
  const provider = transcriptionProviderLabel();

  return (
    <div className="space-y-6">
      <UrlToast />
      <SectionCard title="Google Workspace — Gmail, Agenda et Meet" description="Envoi et réception des emails depuis votre adresse, synchronisation de l'agenda, liens Google Meet et transcriptions pour les comptes rendus.">
        <GoogleSection
          configured={Boolean(googleCreds)}
          source={googleCreds?.source ?? null}
          isAdmin={isAdmin(user)}
          account={
            google
              ? {
                  email: google.email,
                  status: google.status,
                  lastError: google.lastError,
                  calendarLastSync: google.calendarLastSyncAt ? formatRelative(google.calendarLastSyncAt) : null,
                  missingScopes: missingScopes.length,
                }
              : null
          }
          redirectUri={`${env.appUrl}/api/integrations/google/callback`}
        />
      </SectionCard>

      <SectionCard title="Mes adresses email" description="Les emails échangés avec vos contacts sont importés automatiquement (toutes les 2 minutes) et rattachés à leur fiche.">
        <MailboxList
          mailboxes={mailboxes.map((m) => ({
            id: m.id,
            email: m.email,
            provider: m.provider,
            status: m.status,
            isDefault: m.isDefault,
            lastSync: m.lastSyncAt ? formatRelative(m.lastSyncAt) : null,
            lastError: m.lastError,
          }))}
        />
        <div className="mt-5 border-t pt-5">
          <div className="mb-3 text-sm font-semibold">Ajouter une adresse hors Google (OVH, Ionos, Microsoft 365, Infomaniak…)</div>
          <ImapForm defaultEmail={user.email} />
        </div>
      </SectionCard>

      {isAdmin(user) && (
        <SectionCard title="Boutique Shopify" description="Clients et commandes remontés sans doublon, nouveaux clients attribués, suivi après-achat (installation, prise en main, satisfaction).">
          <ShopifySection
            connection={
              shopify
                ? {
                    shopDomain: shopify.shopDomain,
                    authMode: shopify.authMode,
                    status: shopify.status,
                    lastError: shopify.lastError,
                    lastSync: shopify.lastSyncAt ? formatRelative(shopify.lastSyncAt) : null,
                    lastResult: shopify.lastSyncResult as { customers: number; orders: number; products: number; errors: string[] } | null,
                    webhooks: Boolean(shopify.webhooksRegisteredAt),
                    apiVersion: shopify.apiVersion,
                  }
                : null
            }
            webhookUrl={`${env.appUrl}/api/webhooks/shopify`}
            oauthAvailable={Boolean(env.shopify.clientId && env.shopify.clientSecret)}
            defaultApiVersion={env.shopify.apiVersion}
          />
        </SectionCard>
      )}

      <SectionCard title="Services du serveur" description="Configurés par l'administrateur technique (variables d'environnement).">
        <ul className="space-y-2">
          <Status ok={env.appUrl.startsWith("https://")} warn={!env.appUrl.startsWith("https://")}>
            Adresse publique du CRM : <strong>{env.appUrl}</strong>
            {!env.appUrl.startsWith("https://") && " — les webhooks Shopify et les liens envoyés aux clients nécessitent une adresse HTTPS publique en production."}
          </Status>
          <Status ok={env.emailDelivery === "live"} warn>
            Envoi des emails : {env.emailDelivery === "live" ? "réel" : "mode test (EMAIL_DELIVERY=log) — les emails sont enregistrés mais pas envoyés"}
          </Status>
          <Status ok={env.smtp.configured} warn>
            Serveur d&apos;envoi système (invitations, mots de passe, planning) : {env.smtp.configured ? env.smtp.host : "non configuré — la boîte Google d'un administrateur est utilisée à défaut"}
          </Status>
          <Status ok={aiAvailable()}>IA (rédaction, personnalisation, comptes rendus) : {aiAvailable() ? llmProviderLabel() : "OPENAI_API_KEY ou ANTHROPIC_API_KEY manquant"}</Status>
          <Status ok={Boolean(provider)} warn>
            Transcription audio : {provider ?? "reconnaissance vocale du navigateur uniquement (ajoutez ELEVENLABS_API_KEY, OPENAI_API_KEY ou DEEPGRAM_API_KEY)"}
          </Status>
          <Status ok={Boolean(googleCreds)}>Connexion Google : {googleCreds ? "activée" : "à activer (section Google ci-dessus)"}</Status>
          <Status ok>Planificateur : {env.schedulerMode === "internal" ? "intégré au serveur" : "externe (worker ou /api/cron/tick)"}</Status>
        </ul>
      </SectionCard>
    </div>
  );
}
