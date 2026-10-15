# Mise en ligne du CRM PillQare — Vercel + Supabase

Architecture : application Next.js sur **Vercel** (région Paris `cdg1`), base PostgreSQL sur **Supabase** (région Paris `eu-west-3`),
tâches de fond (relances, rappels, synchronisations) déclenchées chaque minute par **Supabase Cron**.

## 1. Supabase

1. Créer un projet (région **West EU (Paris)**), noter le mot de passe de la base.
2. *Connect* → récupérer deux chaînes de connexion :
   - **Transaction pooler** (port 6543) → `DATABASE_URL` (utilisée par l'application)
   - **Session pooler** (port 5432) → `DIRECT_URL` (migrations uniquement)
3. Depuis le poste de développement, créer les tables et les données de référence :

```bash
DATABASE_URL="<session pooler>" DIRECT_URL="<session pooler>" npx prisma migrate deploy
DATABASE_URL="<session pooler>" npx tsx prisma/seed.ts
DATABASE_URL="<session pooler>" APP_URL="https://<domaine>" ENCRYPTION_KEY="<clé>" npx tsx scripts/create-admin.ts safir@pillqare.fr Safir Nom
```

Le dernier script affiche le **lien d'activation** de l'administrateur (valable 7 jours) : il choisit son mot de passe,
puis invite son équipe depuis *Paramètres → Équipe*.

## 2. Vercel

Importer le projet, puis dans *Settings → Environment Variables* (Production) :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | Transaction pooler Supabase (port 6543) |
| `APP_URL` | `https://<domaine>` (sans `/` final) |
| `ENCRYPTION_KEY` | 64 caractères hexadécimaux (`openssl rand -hex 32`) — **ne plus jamais la changer** |
| `CRON_SECRET` | secret aléatoire (`openssl rand -hex 24`) |
| `SCHEDULER_MODE` | `external` |
| `EMAIL_DELIVERY` | `live` |
| `EMBEDDED_POSTGRES` | `false` |
| `APP_TIMEZONE` | `Europe/Paris` |
| `OPENAI_API_KEY` | clé OpenAI de PillQare (IA, Copilote, transcription) |
| `SMTP_*` | facultatif : invitations et mots de passe oubliés avant connexion d'une boîte Gmail |

Déployer, puis associer le domaine (*Settings → Domains*).

## 3. Planificateur (Supabase Cron)

Dans Supabase → *SQL Editor*, exécuter `supabase/cron.sql` après y avoir remplacé `VOTRE-DOMAINE` et `VOTRE_CRON_SECRET`.
Vérification : *Integrations → Cron* doit afficher un passage par minute avec un statut 200.

## 4. Google (Gmail, Agenda, Meet)

Dans la console Google Cloud, ajouter l'URI de redirection autorisée :
`https://<domaine>/api/integrations/google/callback`
puis renseigner l'identifiant et le secret dans *Paramètres → Intégrations* (ou variables `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
Pour un usage hors de l'organisation Google Workspace de PillQare, l'application OAuth doit être publiée (vérification Google).

## Limites connues sur Vercel

- Requêtes limitées à **4,5 Mo** : pièces jointes d'email et import d'enregistrements audio au-delà de cette taille refusés
  (l'enregistrement en direct de l'assistant IA, envoyé par segments, n'est pas concerné).
- Durée maximale d'une requête : 300 s (suffisant pour l'IA et la transcription).
