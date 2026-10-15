"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Mail, RefreshCw, Star, Trash2, Unplug, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmButton, FormField, SelectField } from "@/components/common/fields";
import { useAction } from "@/hooks/use-action";
import {
  connectImapMailboxAction,
  connectShopifyAction,
  disconnectGoogleAction,
  disconnectShopifyAction,
  removeMailboxAction,
  setDefaultMailboxAction,
  shopifyRegisterWebhooksAction,
  shopifySyncNowAction,
  syncGoogleNowAction,
  saveGoogleConfigAction,
  clearGoogleConfigAction,
} from "@/actions/settings";
import { syncMyMailboxesAction } from "@/actions/emails";

/** Affiche le résultat des retours OAuth (?google=ok / ?shopify=error&message=…). */
export function UrlToast() {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const g = params.get("google");
    const s = params.get("shopify");
    const msg = params.get("message");
    if (g === "ok") toast.success("Compte Google connecté : synchronisation des emails et de l'agenda en cours.");
    if (g === "error") toast.error(`Connexion Google impossible : ${msg ?? "erreur"}`);
    if (s === "ok") toast.success("Boutique Shopify connectée : import en cours.");
    if (s === "error") toast.error(`Shopify : ${msg ?? "erreur"}`);
    if (params.get("bienvenue")) toast.success("Bienvenue ! Connectez votre messagerie et votre agenda pour démarrer.");
    if (g || s) router.replace("/parametres/integrations", { scroll: false });
  }, [params, router]);
  return null;
}

const GOOGLE_STEPS = (redirectUri: string) => [
  {
    title: "Créer un projet Google Cloud",
    text: "Connectez-vous avec le compte administrateur Google Workspace de PillQare, nommez le projet « CRM PillQare » et validez.",
    links: [{ label: "Créer le projet", href: "https://console.cloud.google.com/projectcreate" }],
  },
  {
    title: "Activer Gmail, Agenda et Meet",
    text: "Ouvrez chaque lien (le projet créé doit être sélectionné en haut) et cliquez sur « Activer ».",
    links: [
      { label: "API Gmail", href: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" },
      { label: "API Agenda", href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
      { label: "API Meet", href: "https://console.cloud.google.com/apis/library/meet.googleapis.com" },
    ],
  },
  {
    title: "Configurer l'écran de connexion",
    text: "Nom de l'application « CRM PillQare », votre email, puis audience « Interne » (réservé aux comptes PillQare : aucune validation Google requise).",
    links: [{ label: "Écran de connexion", href: "https://console.cloud.google.com/auth/branding" }],
  },
  {
    title: "Créer l'identifiant du CRM",
    text: "Type « Application Web ». Dans « URI de redirection autorisés », ajoutez l'adresse ci-dessous, puis créez : Google affiche un ID client et un code secret.",
    links: [{ label: "Créer l'identifiant", href: "https://console.cloud.google.com/auth/clients/create" }],
    copy: redirectUri,
  },
];

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">{value}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copié" : "Copier"}
      </Button>
    </div>
  );
}

/** Assistant d'activation de la connexion Google (une seule fois, par l'administrateur). */
function GoogleSetup({ redirectUri, onCancel }: { redirectUri: string; onCancel?: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const save = useAction(() => saveGoogleConfigAction({ clientId, clientSecret }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        À faire <strong>une seule fois</strong> (environ 10 minutes). Ensuite, chaque commercial se connecte simplement avec son compte Google : Gmail, agenda et Meet sont branchés automatiquement.
      </p>
      <ol className="space-y-3">
        {GOOGLE_STEPS(redirectUri).map((st, i) => (
          <li key={st.title} className="flex gap-3 rounded-lg border p-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{st.title}</div>
              <p className="text-xs text-muted-foreground">{st.text}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {st.links.map((l) => (
                  <Button key={l.href} size="xs" variant="outline" asChild>
                    <a href={l.href} target="_blank" rel="noreferrer">
                      {l.label} <ExternalLink />
                    </a>
                  </Button>
                ))}
              </div>
              {st.copy && <CopyField value={st.copy} />}
            </div>
          </li>
        ))}
        <li className="flex gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">5</span>
          <form
            className="min-w-0 flex-1 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.run();
            }}
          >
            <div className="text-sm font-semibold">Coller les identifiants affichés par Google</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="ID client">
                <Input className="h-9" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456-abc.apps.googleusercontent.com" autoComplete="off" />
              </FormField>
              <FormField label="Code secret du client">
                <Input className="h-9" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" autoComplete="off" />
              </FormField>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.pending || !clientId.trim() || !clientSecret.trim()}>
                {save.pending && <Spinner />} Vérifier et activer
              </Button>
              {onCancel && (
                <Button type="button" variant="ghost" onClick={onCancel}>
                  Annuler
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Les identifiants sont vérifiés auprès de Google puis enregistrés chiffrés.</p>
          </form>
        </li>
      </ol>
    </div>
  );
}

export function GoogleSection({
  configured,
  source,
  isAdmin,
  account,
  redirectUri,
}: {
  configured: boolean;
  source: "crm" | "env" | null;
  isAdmin: boolean;
  account: { email: string; status: string; lastError: string | null; calendarLastSync: string | null; missingScopes: number } | null;
  redirectUri: string;
}) {
  const disconnect = useAction(disconnectGoogleAction);
  const clear = useAction(clearGoogleConfigAction);
  const [editing, setEditing] = useState(false);
  const sync = useAction(syncGoogleNowAction, { success: false, onSuccess: (r) => r && toast.success(`Agenda synchronisé : ${r.created} RDV importé(s), ${r.updated} mis à jour`) });
  if (!configured || editing) {
    if (!isAdmin) {
      return <p className="text-sm text-amber-800">La connexion Google n&apos;est pas encore activée : un administrateur du CRM doit la configurer (une seule fois).</p>;
    }
    return <GoogleSetup redirectUri={redirectUri} onCancel={editing ? () => setEditing(false) : undefined} />;
  }
  const adminTools =
    isAdmin && source === "crm" ? (
      <div className="flex flex-wrap gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="flex-1">Application Google configurée dans le CRM.</span>
        <button type="button" className="hover:text-foreground hover:underline" onClick={() => setEditing(true)}>
          Modifier les identifiants
        </button>
        <ConfirmButton title="Désactiver la connexion Google ?" description="Plus personne ne pourra se connecter avec Google ni synchroniser Gmail et l'agenda." destructive size="xs" variant="ghost" onConfirm={() => clear.run()}>
          Désactiver
        </ConfirmButton>
      </div>
    ) : null;
  if (!account) {
    return (
      <div className="space-y-3">
        <Button asChild>
          <a href="/api/integrations/google/connect">
            <Mail /> Connecter mon compte Google
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">Un clic : Gmail, agenda et Meet sont branchés. Vous pourrez ensuite vous connecter au CRM avec Google.</p>
        {adminTools}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {account.status === "ACTIVE" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Unplug className="size-4 text-rose-600" />}
        <strong>{account.email}</strong>
        <span className="text-muted-foreground">
          {account.status === "ACTIVE" ? "connecté" : "déconnecté — reconnectez le compte"} · agenda synchronisé {account.calendarLastSync ?? "jamais"}
        </span>
      </div>
      {account.lastError && <p className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{account.lastError}</p>}
      {account.missingScopes > 0 && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">Certaines autorisations manquent (Gmail, Agenda ou Meet) : reconnectez votre compte en acceptant toutes les autorisations.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={sync.pending} onClick={() => sync.run()}>
          <RefreshCw className={sync.pending ? "animate-spin" : ""} /> Synchroniser l&apos;agenda
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href="/api/integrations/google/connect">Reconnecter</a>
        </Button>
        <ConfirmButton title="Déconnecter Google ?" description="L'envoi d'emails depuis Gmail et la synchronisation de l'agenda seront arrêtés. L'historique est conservé." destructive onConfirm={() => disconnect.run()}>
          <Unplug /> Déconnecter
        </ConfirmButton>
      </div>
      {adminTools}
    </div>
  );
}

export function MailboxList({ mailboxes }: { mailboxes: { id: string; email: string; provider: "GOOGLE" | "IMAP"; status: string; isDefault: boolean; lastSync: string | null; lastError: string | null }[] }) {
  const remove = useAction(removeMailboxAction);
  const setDefault = useAction(setDefaultMailboxAction);
  const sync = useAction(syncMyMailboxesAction, { success: false, onSuccess: (r) => toast.success(`Synchronisation terminée : ${r?.stored ?? 0} nouvel(s) email(s) rattaché(s)`) });
  if (mailboxes.length === 0) return <p className="text-sm text-muted-foreground">Aucune adresse connectée. Connectez Google ci-dessus ou ajoutez une adresse IMAP/SMTP.</p>;
  return (
    <div className="space-y-2">
      {mailboxes.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <span className={`size-2 rounded-full ${m.status === "ACTIVE" ? "bg-emerald-500" : m.status === "ERROR" ? "bg-rose-500" : "bg-slate-400"}`} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {m.email} {m.isDefault && <span className="ml-1 rounded bg-primary/10 px-1.5 text-[10px] text-primary">envoi par défaut</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {m.provider === "GOOGLE" ? "Gmail (API Google)" : "IMAP / SMTP"} · synchronisé {m.lastSync ?? "jamais"}
            </div>
            {m.lastError && m.status !== "ACTIVE" && <div className="text-xs text-rose-600">{m.lastError}</div>}
          </div>
          {!m.isDefault && (
            <Button size="xs" variant="ghost" onClick={() => setDefault.run(m.id)}>
              <Star /> Par défaut
            </Button>
          )}
          <ConfirmButton title={`Déconnecter ${m.email} ?`} size="xs" variant="ghost" onConfirm={() => remove.run(m.id)}>
            <Trash2 />
          </ConfirmButton>
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={sync.pending} onClick={() => sync.run()}>
        <RefreshCw className={sync.pending ? "animate-spin" : ""} /> Synchroniser maintenant
      </Button>
    </div>
  );
}

const PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; smtpSecure: boolean }> = {
  ovh: { imapHost: "ssl0.ovh.net", imapPort: 993, smtpHost: "ssl0.ovh.net", smtpPort: 465, smtpSecure: true },
  ionos: { imapHost: "imap.ionos.fr", imapPort: 993, smtpHost: "smtp.ionos.fr", smtpPort: 465, smtpSecure: true },
  infomaniak: { imapHost: "mail.infomaniak.com", imapPort: 993, smtpHost: "mail.infomaniak.com", smtpPort: 465, smtpSecure: true },
  gandi: { imapHost: "mail.gandi.net", imapPort: 993, smtpHost: "mail.gandi.net", smtpPort: 465, smtpSecure: true },
  o2switch: { imapHost: "mail.votre-domaine.fr", imapPort: 993, smtpHost: "mail.votre-domaine.fr", smtpPort: 465, smtpSecure: true },
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true },
};

export function ImapForm({ defaultEmail }: { defaultEmail: string }) {
  const [v, setV] = useState({ email: defaultEmail, displayName: "", username: defaultEmail, password: "", imapHost: "", imapPort: "993", imapSecure: true, smtpHost: "", smtpPort: "465", smtpSecure: true });
  const save = useAction(() => connectImapMailboxAction({ ...v, imapPort: Number(v.imapPort), smtpPort: Number(v.smtpPort) }), { onSuccess: () => setV((p) => ({ ...p, password: "" })) });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.run();
      }}
    >
      <FormField
        label="Fournisseur (préréglage)"
        hint="Microsoft 365 / Outlook.com n'acceptent plus la connexion par mot de passe (IMAP/SMTP) : pour une adresse Google Workspace, utilisez plutôt « Connecter Google »."
      >
        <SelectField
          value=""
          onChange={(k) => {
            const p = PRESETS[k];
            if (p) setV({ ...v, imapHost: p.imapHost, imapPort: String(p.imapPort), smtpHost: p.smtpHost, smtpPort: String(p.smtpPort), smtpSecure: p.smtpSecure, imapSecure: true });
          }}
          placeholder="Choisir pour pré-remplir les serveurs…"
          options={[
            { value: "ovh", label: "OVHcloud (MX Plan)" },
            { value: "ionos", label: "IONOS" },
            { value: "infomaniak", label: "Infomaniak" },
            { value: "gandi", label: "Gandi" },
            { value: "o2switch", label: "o2switch / cPanel" },
            { value: "gmail", label: "Gmail (mot de passe d'application)" },
          ]}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Adresse email" required>
          <Input className="h-9" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </FormField>
        <FormField label="Nom affiché">
          <Input className="h-9" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} placeholder="Julie Martin — PillQare" />
        </FormField>
        <FormField label="Identifiant" required>
          <Input className="h-9" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} autoComplete="off" />
        </FormField>
        <FormField label="Mot de passe (ou mot de passe d'application)" required>
          <Input className="h-9" type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" />
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_90px_auto_1fr_90px_auto] md:items-end">
        <FormField label="Serveur IMAP (réception)" required>
          <Input className="h-9" value={v.imapHost} onChange={(e) => setV({ ...v, imapHost: e.target.value })} />
        </FormField>
        <FormField label="Port">
          <Input className="h-9" value={v.imapPort} onChange={(e) => setV({ ...v, imapPort: e.target.value })} />
        </FormField>
        <label className="flex h-9 items-center gap-1.5 text-xs">
          <Checkbox checked={v.imapSecure} onCheckedChange={(c) => setV({ ...v, imapSecure: Boolean(c) })} /> SSL
        </label>
        <FormField label="Serveur SMTP (envoi)" required>
          <Input className="h-9" value={v.smtpHost} onChange={(e) => setV({ ...v, smtpHost: e.target.value })} />
        </FormField>
        <FormField label="Port">
          <Input className="h-9" value={v.smtpPort} onChange={(e) => setV({ ...v, smtpPort: e.target.value })} />
        </FormField>
        <label className="flex h-9 items-center gap-1.5 text-xs">
          <Checkbox checked={v.smtpSecure} onCheckedChange={(c) => setV({ ...v, smtpSecure: Boolean(c) })} /> SSL
        </label>
      </div>
      <p className="text-xs text-muted-foreground">La connexion est testée (réception et envoi) avant l&apos;enregistrement. Le mot de passe est chiffré.</p>
      <Button type="submit" disabled={save.pending || !v.password || !v.imapHost || !v.smtpHost}>
        {save.pending && <Spinner />} Tester et connecter
      </Button>
    </form>
  );
}

export function ShopifySection({
  connection,
  webhookUrl,
  oauthAvailable,
  defaultApiVersion,
}: {
  connection: {
    shopDomain: string;
    authMode: string;
    status: string;
    lastError: string | null;
    lastSync: string | null;
    lastResult: { customers: number; orders: number; products: number; errors: string[] } | null;
    webhooks: boolean;
    apiVersion: string;
  } | null;
  webhookUrl: string;
  oauthAvailable: boolean;
  defaultApiVersion: string;
}) {
  const [mode, setMode] = useState<"CLIENT_CREDENTIALS" | "ACCESS_TOKEN">("CLIENT_CREDENTIALS");
  const [v, setV] = useState({ shopDomain: connection?.shopDomain ?? "", clientId: "", clientSecret: "", accessToken: "", webhookSecret: "", apiVersion: connection?.apiVersion ?? defaultApiVersion });
  const [oauthShop, setOauthShop] = useState("");
  const connect = useAction(() => connectShopifyAction({ ...v, authMode: mode }), { success: false, onSuccess: (r) => r && toast.success(`Boutique « ${r.shop} » connectée`, { description: r.webhooks }) });
  const sync = useAction((full: boolean) => shopifySyncNowAction(full));
  const hooks = useAction(shopifyRegisterWebhooksAction, { success: false, onSuccess: (r) => r && toast.success(r.message) });
  const disconnect = useAction(disconnectShopifyAction);

  return (
    <div className="space-y-5">
      {connection && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-2 rounded-full ${connection.status === "ACTIVE" ? "bg-emerald-500" : "bg-rose-500"}`} />
            <strong>{connection.shopDomain}</strong>
            <span className="text-muted-foreground">
              {connection.authMode === "CLIENT_CREDENTIALS" ? "app Dev Dashboard (jeton renouvelé automatiquement)" : connection.authMode === "OAUTH" ? "app installée via OAuth" : "jeton Admin API"} · API {connection.apiVersion}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Dernière synchronisation {connection.lastSync ?? "jamais"}
            {connection.lastResult && ` · ${connection.lastResult.orders} commande(s), ${connection.lastResult.customers} client(s), ${connection.lastResult.products} produit(s)`}
            {" · "}webhooks {connection.webhooks ? "actifs ✓" : "non enregistrés"}
          </div>
          {connection.lastError && <div className="text-xs text-rose-600">{connection.lastError}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={sync.pending} onClick={() => sync.run(false)}>
              <RefreshCw className={sync.pending ? "animate-spin" : ""} /> Synchroniser
            </Button>
            <Button size="sm" variant="outline" disabled={sync.pending} onClick={() => sync.run(true)}>
              Import complet
            </Button>
            <Button size="sm" variant="outline" disabled={hooks.pending} onClick={() => hooks.run()}>
              <Webhook /> Réenregistrer les webhooks
            </Button>
            <ConfirmButton title="Déconnecter la boutique ?" description="Les clients et commandes déjà importés sont conservés." destructive onConfirm={() => disconnect.run()}>
              <Unplug /> Déconnecter
            </ConfirmButton>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="text-sm font-semibold">{connection ? "Modifier la connexion" : "Connecter la boutique"}</div>
        <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(m) => m && setMode(m as typeof mode)} className="w-full">
          <ToggleGroupItem value="CLIENT_CREDENTIALS" className="flex-1 text-xs">
            App du Dev Dashboard (recommandé)
          </ToggleGroupItem>
          <ToggleGroupItem value="ACCESS_TOKEN" className="flex-1 text-xs">
            Jeton Admin API (ancienne app personnalisée)
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "CLIENT_CREDENTIALS" ? (
          <p className="text-xs text-muted-foreground">
            Créez l&apos;app dans le Dev Dashboard Shopify de la même organisation que la boutique, avec les autorisations read_customers, read_orders, read_all_orders et
            read_products, publiez une version, installez-la sur la boutique puis collez le Client ID et le Client secret.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Pour les applications personnalisées créées avant 2026 dans l&apos;admin Shopify (jeton shpat_…).</p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Domaine de la boutique" required>
            <Input className="h-9" value={v.shopDomain} onChange={(e) => setV({ ...v, shopDomain: e.target.value })} placeholder="ma-boutique.myshopify.com" />
          </FormField>
          <FormField label="Version de l'API">
            <Input className="h-9" value={v.apiVersion} onChange={(e) => setV({ ...v, apiVersion: e.target.value })} />
          </FormField>
          {mode === "CLIENT_CREDENTIALS" ? (
            <>
              <FormField label="Client ID" required>
                <Input className="h-9" value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} />
              </FormField>
              <FormField label="Client secret" required>
                <Input className="h-9" type="password" value={v.clientSecret} onChange={(e) => setV({ ...v, clientSecret: e.target.value })} autoComplete="off" />
              </FormField>
            </>
          ) : (
            <>
              <FormField label="Jeton d'accès Admin API" required>
                <Input className="h-9" type="password" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value })} autoComplete="off" />
              </FormField>
              <FormField label="Clé secrète de l'API (signature des webhooks)">
                <Input className="h-9" type="password" value={v.clientSecret} onChange={(e) => setV({ ...v, clientSecret: e.target.value })} autoComplete="off" />
              </FormField>
            </>
          )}
          <FormField label="Clé de signature des webhooks créés dans l'admin (facultatif)" hint="Paramètres > Notifications > Webhooks, si vous y créez des webhooks manuellement.">
            <Input className="h-9" type="password" value={v.webhookSecret} onChange={(e) => setV({ ...v, webhookSecret: e.target.value })} autoComplete="off" />
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">
          URL des webhooks : <code className="rounded bg-muted px-1">{webhookUrl}</code> (enregistrés automatiquement).
        </p>
        <Button disabled={connect.pending || !v.shopDomain} onClick={() => connect.run()}>
          {connect.pending && <Spinner />} Vérifier et connecter
        </Button>
      </div>

      {oauthAvailable && (
        <div className="space-y-2 border-t pt-4">
          <div className="text-sm font-semibold">Installation OAuth (app d&apos;une autre organisation Shopify)</div>
          <div className="flex gap-2">
            <Input className="h-9" value={oauthShop} onChange={(e) => setOauthShop(e.target.value)} placeholder="ma-boutique.myshopify.com" />
            <Button variant="outline" asChild disabled={!oauthShop}>
              <a href={`/api/integrations/shopify/install?shop=${encodeURIComponent(oauthShop)}`}>Installer</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
