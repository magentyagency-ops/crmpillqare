# CRM PillQare

CRM commercial de PillQare : prospects et clients B2B/B2C, pipeline de vente, emails, relances automatiques, agenda et prise de rendez-vous, formulaire du site, Shopify, devis, essais/pilotes, assistant IA de compte rendu et tableaux de bord.

Stack : Next.js 16 (App Router, TypeScript), PostgreSQL + Prisma 7, Tailwind CSS. Interface et emails en français, fuseau Europe/Paris.

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Démarrage en local](#2-démarrage-en-local)
3. [Mise en production](#3-mise-en-production)
4. [Configuration des intégrations](#4-configuration-des-intégrations)
5. [Fonctionnement des tâches de fond](#5-fonctionnement-des-tâches-de-fond)
6. [Sauvegardes, sécurité, RGPD](#6-sauvegardes-sécurité-rgpd)
7. [Tests et maintenance](#7-tests-et-maintenance)

---

## 1. Fonctionnalités

| Besoin | Où dans le CRM |
| --- | --- |
| **Tous les contacts au même endroit** — B2B/B2C, classés par cible, coordonnées, historique des appels, emails et RDV | *Contacts*, *Organisations*. Cible détectée automatiquement (organisation, champ « Vous êtes », message) grâce aux mots-clés de *Paramètres → Cibles et motifs de refus*. Détection des doublons, fusion, import/export CSV. La fiche regroupe tout l'historique. |
| **Suivi commercial** — prospect → contacté → RDV → devis → relance/réflexion → signé ou refusé avec motif ; un commercial responsable et une prochaine action datée | *Pipeline* (kanban, liste, dossiers bloqués). Chaque dossier a un responsable et une prochaine action calculée (tâche, RDV ou relance la plus proche). Un refus exige un motif. Les dossiers sans action, en retard ou inactifs sont signalés. |
| **Emails dans le CRM** — connecter les adresses professionnelles, envoyer, recevoir, retrouver les échanges | *Paramètres → Email, agenda, Shopify* : Gmail / Google Workspace (connexion Google) ou toute boîte IMAP/SMTP. Les emails envoyés et reçus sont synchronisés et rattachés à la fiche. Réponses à traiter dans *Emails*. |
| **Relances automatiques** — selon le profil et l'étape ; prévues, envoyées, sans réponse, en retard ; adaptation dès que le prospect répond ou avance | *Relances* et *Relances → Scénarios*. Scénarios par déclencheur (étape, formulaire, devis envoyé, commande, essai) et par cible. Envoi dans une plage horaire ouvrée, validation possible avant envoi. Arrêt automatique sur réponse, prise de RDV, changement d'étape, signature, désinscription ou adresse invalide. |
| **Calendrier connecté à Google Agenda** — lien de prise de RDV, confirmations, rappels, planning quotidien | *Agenda* (synchronisation bidirectionnelle, liens Google Meet), page publique de réservation `/rdv/votre-nom`, confirmations avec invitation calendrier, rappels J-1 et H-1, modification/annulation par le contact, *Ma journée* et email de planning chaque matin. |
| **Formulaire du site** — fiche créée, attribuée, confirmation, tâche de rappel | *Paramètres → Formulaires du site* : formulaire prêt à intégrer (iframe) ou envoi depuis votre propre formulaire. Attribution (tour de rôle, par cible, commercial fixe), email de confirmation, tâche de rappel dans la plage ouvrée, relances dédiées. Anti-spam intégré. |
| **Shopify** — clients et commandes sans doublons, suivi après achat | *Commandes*. Synchronisation par webhooks + rattrapage périodique, dédoublonnage par email/téléphone/identifiant Shopify. Suivi après-achat automatique : installation, prise en main, questionnaire de satisfaction (avis ≤ 3/5 → tâche urgente). |
| **Assistant IA** — transcription pendant l'échange, compte rendu, besoins, objections, actions ; le commercial vérifie et valide l'email de suivi | *Assistant IA* : enregistrement en direct (appel, visio avec son de l'onglet, RDV physique), import d'un enregistrement, transcription Google Meet ou texte collé. Claude rédige le compte rendu ; le commercial corrige, choisit les tâches à créer, l'étape du dossier et valide l'email de suivi. |
| **Devis et essais/pilotes** | *Devis* : produits, quantités, remises, TVA, PDF, envoi, consultation et acceptation en ligne (preuve horodatée). *Essais & pilotes* : matériel prêté (numéros de série), dates, jalons, retours, résultat. |
| **Tableau de bord par commercial** — appels, RDV, relances, devis, ventes, CA, dossiers bloqués | *Tableau de bord* (équipe et détail par commercial, périodes), *Ma journée* (la direction peut afficher la journée de chaque commercial). |

Rôles : **Administrateur** (tout, dont paramètres et équipe), **Manager** (toute l'équipe, sans les paramètres techniques), **Commercial** (ses dossiers ; visibilité de l'équipe réglable dans *Paramètres → Pipeline, relances, rappels*).

---

## 2. Démarrage en local

Prérequis : Node.js 20.9 ou plus récent. Aucune base de données à installer : une base PostgreSQL embarquée est démarrée automatiquement (données dans `~/.pillqare-crm/postgres`).

```bash
npm install
npm run setup      # crée .env avec une clé de chiffrement
npm run dev        # base embarquée + migrations + données de référence + serveur sur http://localhost:3000
```

Au premier lancement, la page `/installation` crée le compte administrateur. Les cibles, produits PillQare, modèles d'emails, scénarios de relance et formulaires sont installés automatiquement.

Pour une démonstration avec 3 commerciaux et 12 dossiers fictifs : `SEED_DEMO=true npm run db:seed` (mot de passe des comptes de démo : `PillQare-demo-2026`).

En local, `EMAIL_DELIVERY=log` : les emails sont enregistrés dans le CRM (visibles sur les fiches) mais **pas envoyés**.

Commandes utiles :

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Développement (base embarquée comprise) |
| `npm run db:studio` | Explorer la base (Prisma Studio) |
| `npm run test` | Tests unitaires |
| `npm run typecheck` / `npm run lint` | Vérifications |
| `npm run worker` | Tâches de fond dans un processus séparé |

---

## 3. Mise en production

### Option A — Serveur avec Docker (recommandé)

Sur un serveur Linux (VPS) avec Docker et un nom de domaine pointant vers lui :

```bash
npm run setup -- --production https://crm.votre-domaine.fr   # ou copiez .env.example en .env
echo 'POSTGRES_PASSWORD=un-mot-de-passe-long' >> .env
DOMAIN=crm.votre-domaine.fr docker compose --profile https up -d --build
```

Cela démarre PostgreSQL 18, l'application, le worker (tâches de fond) et Caddy (certificat HTTPS automatique). Sans le profil `https`, l'application écoute sur le port 3000 (à placer derrière votre propre proxy HTTPS).

Les migrations de base sont appliquées à chaque démarrage. Mise à jour : `git pull && docker compose --profile https up -d --build`.

### Option B — Node.js + PostgreSQL géré

1. Une base PostgreSQL 16+ (Scaleway, OVHcloud, Neon, Supabase…), `DATABASE_URL` dans `.env`, `EMBEDDED_POSTGRES=false`.
2. `npm ci && npm run build && npm run db:deploy && npm run db:seed`
3. `npm start` (port 3000) derrière un proxy HTTPS, avec un gestionnaire de processus (systemd, pm2).
4. Tâches de fond : par défaut dans le serveur web (`SCHEDULER_MODE=internal`). Voir §5.

### Variables indispensables en production

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | Base PostgreSQL |
| `APP_URL` | Adresse publique en **https://** (liens des emails, Google, Shopify) |
| `ENCRYPTION_KEY` | Chiffre les jetons et mots de passe enregistrés — **à sauvegarder, ne jamais changer** |
| `EMAIL_DELIVERY=live` | Envoi réel des emails |

Toutes les variables sont décrites dans [`.env.example`](.env.example). Au démarrage, l'application signale dans les journaux toute configuration manquante.

---

## 4. Configuration des intégrations

Toutes les connexions se font ensuite dans **Paramètres → Email, agenda, Shopify**, chaque commercial connectant sa propre boîte et son agenda.

### 4.1 Google Workspace / Gmail (emails, agenda, Meet)

**Une seule fois, par l'administrateur (≈ 10 min)** : *Paramètres → Email, agenda, Shopify*. Un assistant guide pas à pas (liens directs vers la console Google Cloud, adresse de redirection à copier), puis on colle l'ID client et le code secret : le CRM les vérifie auprès de Google et les enregistre chiffrés. Aucun fichier à modifier, aucun redémarrage.
Choisir l'audience **Interne** (comptes Google Workspace PillQare uniquement, aucune validation Google nécessaire).
> Les variables `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` restent possibles en alternative.

**Ensuite, pour chaque commercial** : bouton **Se connecter avec Google** sur la page de connexion. En un clic il est connecté au CRM, sa boîte Gmail et son agenda sont synchronisés, ses visios reçoivent un lien Meet et ses occupations bloquent ses créneaux de réservation. Seule condition : l'administrateur l'a invité avec la même adresse email (*Paramètres → Équipe et accès*).

Transcriptions Google Meet : si la transcription est activée dans la réunion (Google Workspace), le CRM la récupère après le RDV et prépare le compte rendu IA automatiquement.

### 4.2 Autres boîtes email (IMAP/SMTP)

Ajouter une adresse IMAP/SMTP avec les serveurs de l'hébergeur (préréglages OVHcloud, IONOS, Infomaniak, Gandi, o2switch). Le CRM teste la connexion avant de l'enregistrer ; le mot de passe est chiffré.
Microsoft 365 / Outlook.com n'acceptent plus la connexion par mot de passe : utilisez Google Workspace.

### 4.3 Shopify (boutique commande.pillqare.com)

1. Dans le [Dev Dashboard Shopify](https://dev.shopify.com/) (ou *Paramètres → Applications → Développer des applications*), créer une application pour la boutique avec les accès : `read_customers`, `read_orders`, `read_all_orders`, `read_products`.
2. Dans le CRM : *Paramètres → Email, agenda, Shopify → Connecter la boutique*, saisir le domaine `votre-boutique.myshopify.com` et le Client ID / Client secret de l'application (ou, pour une ancienne application personnalisée, son jeton d'accès Admin API `shpat_…`).
3. Les webhooks sont enregistrés automatiquement : commandes et clients arrivent en temps réel (`/api/webhooks/shopify`, signatures vérifiées, doublons ignorés). Une synchronisation de rattrapage tourne toutes les 30 minutes ; les boutons **Synchroniser**, **Import complet** et **Réenregistrer les webhooks** sont disponibles.

Les commandes payées déclenchent le suivi après-achat (scénario « Après-achat »). Un dossier ouvert du même client passe automatiquement en « Signé ».

### 4.4 Formulaire du site

*Paramètres → Formulaires du site* : chaque formulaire fournit trois intégrations prêtes à copier.

- **iframe** (le plus simple) : `<iframe src="https://crm.votre-domaine.fr/f/site-contact?embed=1" …>`
- **Votre formulaire HTML** : `action="https://crm.votre-domaine.fr/api/public/forms/site-contact"` en `method="post"`.
- **JavaScript** : `fetch` en JSON vers la même adresse (réponse `{ ok, message, redirectUrl }`).

Champs reconnus automatiquement (français ou anglais) : prénom, nom, email, téléphone, société/établissement, fonction, message, code postal, ville, « vous êtes »/cible, quantité ; les autres champs sont conservés dans la fiche. Renseignez les **origines autorisées** (ex. `https://pillqare.com`) pour refuser les envois d'autres sites. Protection : champ piège, délai minimal, limite de 10 envois / 10 min par adresse IP.

### 4.5 Intelligence artificielle

Une clé **OpenAI** (`OPENAI_API_KEY`) ou **Anthropic** (`ANTHROPIC_API_KEY`) active :
- **Rédaction d'emails** (bouton « Rédiger avec l'IA » dans chaque email) : à partir d'une consigne en une phrase, personnalisé avec la fiche, le dossier et les derniers échanges ; retouches en un clic (plus court, plus chaleureux, plus formel, plus convaincant, corriger) ; **réponse proposée** aux emails reçus.
- **Relances automatiques personnalisées** : option « ✨ Personnaliser avec l'IA » par étape de scénario (activée par défaut sur les emails fournis). Le modèle sert de base, l'IA l'adapte à chaque contact juste avant l'envoi (ou avant la validation par le commercial), sans rien inventer ; en cas de souci, le modèle part tel quel.
- **Analyse IA** sur les fiches contact et dossier : synthèse, niveau d'intérêt, prochaine meilleure action (planifiable en un clic), arguments, points de vigilance.
- **Comptes rendus de RDV** (Assistant IA) et **transcription audio** (avec OpenAI, ElevenLabs ou Deepgram).

Le contexte transmis à l'IA (offre, prix, arguments) et le ton des emails se règlent dans *Paramètres → Pipeline, relances, rappels → Intelligence artificielle*. Coût : à l'usage, quelques centimes par email ou analyse ; limite de 80 demandes par heure et par commercial.
L'enregistrement d'un échange nécessite l'accord des participants ; l'audio n'est pas conservé.

**Copilote** (bouton « Copilote » en bas à droite, raccourci ⌘J, clé OpenAI requise) : pilote le CRM en langage naturel avec les droits de l'utilisateur. Il recherche, consulte, crée et modifie contacts, dossiers, tâches, RDV, devis et notes ; il programme des séries de relances (jusqu'à la minute, en heures ouvrées ou non) et analyse les dossiers. Les envois vers l'extérieur et les suppressions (emails, relances, devis, annulations, archivage) affichent le contenu et demandent une confirmation d'un clic. Il comprend la page ouverte (« ce contact »). Conversations conservées ; limite de 60 demandes par heure et par utilisateur.

### 4.6 Prise de rendez-vous

*Paramètres → Prise de rendez-vous* : lien personnel, durée, pause entre RDV, délai minimum, horaires par jour, type (visio, téléphone, physique) et lien de visio permanent (si Google n'est pas connecté). Le lien est inséré automatiquement dans les emails via `{{bookingLink}}`.

---

## 5. Fonctionnement des tâches de fond

Relances, rappels de RDV, synchronisations email/agenda/Shopify, planning du matin et comptes rendus automatiques sont exécutés toutes les 30 secondes, avec un verrou en base (jamais deux exécutions simultanées) :

| Mode | Utilisation |
| --- | --- |
| `SCHEDULER_MODE=internal` (défaut) | Exécuté par le serveur web. Idéal pour un serveur unique. |
| `SCHEDULER_MODE=external` + `npm run worker` | Processus séparé (utilisé par `docker-compose.yml`). |
| `SCHEDULER_MODE=external` + cron | Hébergement serverless : appeler `GET /api/cron/tick` chaque minute avec l'en-tête `Authorization: Bearer <CRON_SECRET>`. |

*Paramètres → État du système* affiche l'état de chaque tâche, les erreurs et permet de relancer les tâches échouées.

---

## 6. Sauvegardes, sécurité, RGPD

- **Sauvegardes** : sauvegardez la base PostgreSQL chaque jour, par exemple
  `docker compose exec db pg_dump -U pillqare pillqare_crm | gzip > sauvegarde-$(date +%F).sql.gz`, et conservez `ENCRYPTION_KEY` en lieu sûr (sans elle, les connexions enregistrées sont illisibles).
- **Sécurité** : mots de passe hachés (bcrypt), sessions en base révocables, limitation des tentatives de connexion, secrets chiffrés (AES-256-GCM), signatures vérifiées (webhooks Shopify, OAuth), en-têtes de sécurité, pages internes non intégrables dans un site tiers.
- **RGPD** : lien de désinscription dans les relances (arrêt immédiat des relances commerciales ; le suivi des commandes continue sans email), contact « ne pas contacter », suppression et fusion de fiches, export CSV. Les données sont hébergées là où vous déployez la base.

---

## 7. Tests et maintenance

```bash
npm run test        # tests unitaires (créneaux, planning des relances, heures d'été/hiver, devis, détection de cible, emails…)
npm run typecheck
npm run lint
npm run build
```

Structure : `src/app` (pages), `src/actions` (actions serveur), `src/lib` (logique métier : `sequences/`, `email/`, `google/`, `shopify/`, `quotes/`, `ai/`, `booking/`, `scheduler/`), `prisma/` (schéma, migrations, données initiales), `tests/unit`.

Modifier le modèle de données : éditer `prisma/schema.prisma` puis `npm run db:migrate` (crée une migration, appliquée en production au déploiement).
