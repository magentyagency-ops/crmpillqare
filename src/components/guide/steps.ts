/**
 * Contenu du guide interactif. Une étape met en lumière un élément (`target`) d'une page (`route`).
 * Cibles : sélecteurs CSS (premier élément visible), « text:Titre » (carte dont le titre commence par ce texte)
 * ou plusieurs cibles séparées par « || » (la première trouvée est utilisée). Sans cible : carte centrée.
 * Routes : chemin fixe, ou « contact » / « deal » pour une fiche d'exemple réelle.
 */
export type GuideStep = {
  id: string;
  route?: string;
  target?: string;
  title: string;
  body: string;
  /** Invitation à essayer (le guide peut être mis en pause pour le faire) */
  tryIt?: string;
  /** Agrandit légèrement l'élément mis en avant */
  zoom?: boolean;
  placement?: "auto" | "right" | "left" | "top" | "bottom";
};

export type GuideChapter = { id: string; title: string; icon: string; steps: GuideStep[] };

export const CHAPTERS: GuideChapter[] = [
  {
    id: "bases",
    title: "Les bases",
    icon: "🧭",
    steps: [
      {
        id: "welcome",
        route: "/aujourdhui",
        title: "Bienvenue dans le CRM PillQare 👋",
        body: "Ce guide vous fait visiter le logiciel, page par page. Vous pouvez le mettre en pause à tout moment pour tester une fonctionnalité, puis reprendre exactement là où vous en étiez.\n\nRaccourcis : → étape suivante, ← précédente, Échap pour mettre en pause.",
      },
      {
        id: "nav",
        target: "[data-tour=nav]",
        placement: "right",
        title: "Le menu principal",
        body: "Toutes les pages du CRM : votre journée, le pipeline, les tâches, l'agenda, les emails et relances, puis vos clients (contacts, organisations, devis, essais, commandes). Les pastilles indiquent ce qui attend une action.",
      },
      {
        id: "search",
        target: "[data-tour=search]",
        zoom: true,
        title: "Recherche universelle",
        body: "Retrouvez instantanément un contact, une organisation, un dossier ou un devis — par nom, email, téléphone ou ville. Raccourci : ⌘K (Ctrl+K sur PC).",
        tryIt: "Tapez quelques lettres d'un nom de pharmacie.",
      },
      {
        id: "create",
        target: "[data-tour=create]",
        zoom: true,
        title: "Le bouton « Créer »",
        body: "Depuis n'importe quelle page : nouveau contact, dossier commercial, tâche, rendez-vous, devis ou session d'assistant IA.",
      },
      {
        id: "notifications",
        target: "[data-tour=notifications]",
        zoom: true,
        title: "Notifications",
        body: "Réponses de prospects, RDV pris en ligne, relances à valider, devis consultés… Tout ce qui demande votre attention arrive ici.",
      },
      {
        id: "copilot",
        target: "[data-tour=copilot]",
        zoom: true,
        placement: "top",
        title: "Le Copilote IA",
        body: "Pilotez le CRM en langage naturel : « crée une relance pour la pharmacie Martin dans 3 jours », « quels dossiers sont bloqués ? », « envoie le devis à… ». Les envois et suppressions vous sont toujours soumis pour confirmation. Raccourci : ⌘J.",
        tryIt: "Demandez-lui : « Qu'est-ce que j'ai à faire aujourd'hui ? »",
      },
    ],
  },
  {
    id: "journee",
    title: "Ma journée",
    icon: "☀️",
    steps: [
      {
        id: "today",
        route: "/aujourdhui",
        target: "[data-tour=page-header]",
        title: "Votre plan de la journée",
        body: "La page à ouvrir chaque matin : le CRM rassemble ce que vous devez faire aujourd'hui, par ordre de priorité.",
      },
      {
        id: "today-meetings",
        route: "/aujourdhui",
        target: "text:Rendez-vous du jour || main section",
        title: "Rendez-vous du jour",
        body: "Vos RDV avec le lien visio, la fiche du contact et la préparation suggérée.",
      },
      {
        id: "today-calls",
        route: "/aujourdhui",
        target: "text:Appels à passer || main section",
        title: "Appels à passer",
        body: "Rappels de leads entrants, relances téléphoniques et appels planifiés. Un clic pour appeler, puis notez le résultat : le CRM propose la suite (nouvelle relance, RDV, devis…).",
      },
      {
        id: "today-replies",
        route: "/aujourdhui",
        target: "text:Réponses à traiter || text:Dossiers à débloquer || main section",
        title: "Réponses et dossiers à débloquer",
        body: "Les emails de prospects reçus et pas encore traités, et les dossiers sans prochaine action ou inactifs depuis trop longtemps.",
      },
    ],
  },
  {
    id: "contacts",
    title: "Contacts et organisations",
    icon: "👥",
    steps: [
      {
        id: "contacts-list",
        route: "/contacts",
        target: "main table || main section",
        title: "Vos contacts",
        body: "Pharmacies, EHPAD, SSIAD, CCAS, aidants… Filtrez par segment, statut ou commercial ; la recherche accepte plusieurs mots et les numéros de téléphone.",
      },
      {
        id: "contacts-actions",
        route: "/contacts",
        target: "[data-tour=page-actions]",
        zoom: true,
        title: "Ajouter ou importer",
        body: "Créez un contact à la main ou importez un fichier CSV/Excel. Le segment (pharmacie, EHPAD…) est détecté automatiquement d'après le nom de l'organisation et le message.",
      },
      {
        id: "contact-page",
        route: "contact",
        target: "[data-tour=page-header]",
        title: "La fiche contact",
        body: "Tout l'historique d'un contact sur une seule page : emails, appels, RDV, devis, essais, commandes et notes.",
      },
      {
        id: "contact-actions",
        route: "contact",
        target: "[data-tour=record-actions] || [data-tour=page-actions]",
        title: "Agir en un clic",
        body: "Envoyer un email (avec rédaction assistée par l'IA), enregistrer un appel, planifier un RDV ou créer une tâche, sans quitter la fiche.",
        tryIt: "Ouvrez « Email » puis cliquez sur « Proposer une réponse » ou une idée de l'IA.",
      },
      {
        id: "contact-ai",
        route: "contact",
        target: "text:✨ Analyse IA || text:Coordonnées",
        title: "L'analyse IA de la relation",
        body: "Une synthèse de la relation, le niveau d'intérêt, la meilleure prochaine action et les points à aborder. Le bouton « Planifier cette action » crée la tâche pour vous.",
      },
      {
        id: "contact-deals",
        route: "contact",
        target: "text:Dossiers || text:Relances automatiques",
        title: "Dossiers et relances",
        body: "Les dossiers commerciaux du contact et les séries de relances en cours, que vous pouvez arrêter ou relancer à tout moment.",
      },
      {
        id: "orgs",
        route: "/organisations",
        target: "main table || main section || [data-tour=page-header]",
        title: "Organisations",
        body: "Chaque pharmacie, EHPAD ou groupement regroupe ses contacts, dossiers, devis et commandes.",
      },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline et dossiers",
    icon: "📊",
    steps: [
      {
        id: "kanban",
        route: "/pipeline",
        target: "[data-tour=kanban] || main",
        title: "Le pipeline commercial",
        body: "Chaque carte est un dossier. Glissez-la d'une colonne à l'autre pour la faire avancer : le CRM enregistre l'historique et déclenche les automatismes de l'étape (relances, tâches).",
        tryIt: "Faites glisser une carte vers l'étape suivante.",
      },
      {
        id: "kanban-new",
        route: "/pipeline",
        target: "[data-tour=page-actions]",
        zoom: true,
        title: "Nouveau dossier",
        body: "Créez un dossier pour un contact existant ou un nouveau prospect. Un dossier perdu demande un motif : il alimente les statistiques de refus.",
      },
      {
        id: "deal",
        route: "deal",
        target: "[data-tour=page-header]",
        title: "La fiche dossier",
        body: "Étape, montant, prochaine action, historique, devis et analyse IA du dossier. Un dossier doit toujours avoir une prochaine action : sinon il remonte dans « Dossiers à débloquer ».",
      },
    ],
  },
  {
    id: "taches",
    title: "Tâches",
    icon: "✅",
    steps: [
      {
        id: "tasks",
        route: "/taches",
        target: "main section || main table || [data-tour=page-header]",
        title: "Vos tâches",
        body: "Appels, emails, comptes rendus, installations… Filtrez par échéance, reportez d'un jour ou d'une semaine en un clic, cochez quand c'est fait. Les tâches avec une heure apparaissent aussi dans l'agenda.",
      },
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    icon: "📅",
    steps: [
      {
        id: "agenda-grid",
        route: "/agenda",
        target: "[data-tour=agenda-grid]",
        title: "L'agenda, comme Google Agenda",
        body: "RDV, tâches et relances automatiques prévues, à l'heure de votre profil. Synchronisé dans les deux sens avec Google Agenda.\n\n• Cliquez sur un créneau (ou glissez sur une plage) pour créer un RDV ou une tâche.\n• Cliquez sur un événement pour ouvrir sa fiche.\n• Glissez un RDV pour le déplacer, tirez son bord bas pour changer sa durée.",
        tryIt: "Cliquez sur un créneau libre demain matin.",
      },
      {
        id: "agenda-create",
        route: "/agenda",
        target: "[data-tour=agenda-create]",
        zoom: true,
        title: "Créer",
        body: "Un rendez-vous complet (visio Google Meet générée automatiquement, confirmation et rappels envoyés au contact) ou une tâche.",
      },
      {
        id: "agenda-mini",
        route: "/agenda",
        target: "[data-tour=agenda-mini]",
        title: "Mini-calendrier",
        body: "Cliquez sur un jour pour y aller directement.",
      },
      {
        id: "agenda-layers",
        route: "/agenda",
        target: "[data-tour=agenda-layers]",
        title: "Agendas affichés",
        body: "Masquez ou affichez les RDV, les tâches et les relances automatiques. La direction peut aussi superposer l'agenda de chaque commercial.",
      },
      {
        id: "agenda-views",
        route: "/agenda",
        target: "[data-tour=agenda-views]",
        zoom: true,
        title: "Jour, semaine, mois, planning",
        body: "Changez de vue ici, ou au clavier : D (jour), W (semaine), M (mois), A (planning), T (aujourd'hui), J / K (suivant / précédent), C (créer).",
      },
    ],
  },
  {
    id: "emails",
    title: "Emails et relances",
    icon: "✉️",
    steps: [
      {
        id: "emails",
        route: "/emails",
        target: "main section || [data-tour=page-header]",
        title: "La boîte de réception du CRM",
        body: "Les emails échangés avec vos contacts, synchronisés avec Gmail. Les réponses des prospects sont détectées : elles arrêtent les relances automatiques et créent une tâche de suivi.",
      },
      {
        id: "relances",
        route: "/relances",
        target: "[data-tour=page-header]",
        title: "Les relances automatiques",
        body: "Les séries d'emails de relance en cours : prochain envoi, étape, statut. Chaque email peut être personnalisé par l'IA d'après l'historique du contact, et envoyé automatiquement ou après votre validation.",
      },
      {
        id: "relances-actions",
        route: "/relances",
        target: "[data-tour=page-actions]",
        zoom: true,
        title: "Scénarios de relance",
        body: "Définissez vos scénarios : délais (en jours, heures ou minutes), heures ouvrées, validation manuelle, personnalisation IA, et déclencheurs (nouveau lead, devis envoyé, RDV réalisé…).",
      },
    ],
  },
  {
    id: "ventes",
    title: "Devis, essais, commandes",
    icon: "🧾",
    steps: [
      {
        id: "devis",
        route: "/devis",
        target: "[data-tour=page-header]",
        title: "Devis",
        body: "Créez un devis à partir du catalogue, envoyez-le par email avec un lien de consultation et de signature en ligne. Vous êtes prévenu quand le client l'ouvre ; une relance « devis envoyé » peut partir automatiquement.",
      },
      {
        id: "essais",
        route: "/essais",
        target: "[data-tour=page-header]",
        title: "Essais et pilotes",
        body: "Suivez les piluliers prêtés en test : dates, bilan, conversion en commande.",
      },
      {
        id: "commandes",
        route: "/commandes",
        target: "[data-tour=page-header]",
        title: "Commandes",
        body: "Les commandes de la boutique Shopify arrivent ici automatiquement et sont rattachées au bon contact.",
      },
    ],
  },
  {
    id: "ia",
    title: "Assistant IA",
    icon: "✨",
    steps: [
      {
        id: "assistant",
        route: "/assistant",
        target: "[data-tour=page-header]",
        title: "L'assistant de RDV et d'appels",
        body: "Enregistrez ou importez un appel, une visio ou un RDV : l'IA en tire un compte rendu structuré (besoins, objections, prochaines étapes), à valider en un clic. Les tâches et la mise à jour du dossier suivent automatiquement.",
      },
      {
        id: "assistant-new",
        route: "/assistant",
        target: "[data-tour=page-actions]",
        zoom: true,
        title: "Nouvelle session",
        body: "Démarrez une session pendant un appel ou après un RDV. Pour les visios Google Meet, la transcription est récupérée automatiquement.",
      },
    ],
  },
  {
    id: "pilotage",
    title: "Pilotage et réglages",
    icon: "⚙️",
    steps: [
      {
        id: "dashboard",
        route: "/tableau-de-bord",
        target: "[data-tour=page-header]",
        title: "Tableau de bord",
        body: "L'activité par commercial (appels, RDV, relances, devis), le pipeline par étape, les motifs de refus, l'origine des contacts et les dossiers bloqués.",
      },
      {
        id: "settings",
        route: "/parametres/integrations",
        target: "[data-tour=page-header] || main",
        title: "Intégrations",
        body: "Connectez votre compte Google en un clic : Gmail (envoi et réception), Google Agenda et Google Meet.",
      },
      {
        id: "settings-nav",
        route: "/parametres/integrations",
        target: "main nav || main aside || main",
        title: "Tous les réglages",
        body: "Votre profil et signature, le lien de prise de RDV en ligne, l'équipe, les modèles d'emails, les produits, les segments, les règles d'automatisation et les formulaires du site.",
      },
      {
        id: "end",
        title: "Vous êtes prêt 🎉",
        body: "C'est la fin de la visite. Vous pouvez relancer le guide à tout moment depuis le bouton « Guide » en haut de l'écran, ou ouvrir directement un chapitre.",
      },
    ],
  },
];

// Une étape sans page reste sur celle de l'étape précédente (utile à la reprise après une pause)
export const ALL_STEPS = CHAPTERS.flatMap((c) => c.steps.map((s) => ({ ...s, chapter: c }))).map((s, i, all) => {
  if (s.route || !s.target) return s;
  const prev = all.slice(0, i).reverse().find((p) => p.route);
  return { ...s, route: prev?.route };
});
