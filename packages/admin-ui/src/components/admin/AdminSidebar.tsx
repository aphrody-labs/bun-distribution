"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminSidebarView } from "@shenron/ui/admin/AdminSidebarView";
import {
  PenLine,
  LayoutDashboard,
  Home,
  RefreshCw,
  Settings,
  Bot,
  Brain,
  CalendarDays,
  Clock,
  Server,
  Radio,
  ScanText,
  BarChart2,
  Activity,
  Terminal,
  Zap,
  Webhook,
  Database,
  BookOpen,
  ImageIcon,
  Film,
  Gamepad2,
  Tv2,
  Eye,
  MapPin,
  Users,
  UserCircle,
  Palette,
  Layers,
  Gift,
  Ticket,
  MessageSquare,
  Rocket,
  Send,
  Coins,
  TrendingUp,
  ShoppingBag,
  Medal,
  Landmark,
  Trophy,
  Shield,
  BookMarked,
  Crown,
  Key,
  FileText,
  BookText,
  ListOrdered,
  History,
  Flag,
} from "lucide-react";

// Types internes

type SectionId = "pilotage" | "site" | "systeme" | "encyclopedie" | "communaute" | "economie" | "securite";

type AdminLink = {
  href: string;
  /** Libellé court affiché dans la sidebar */
  label: string;
  /** Description courte visible au survol / en sous-titre */
  description: string;
  /** Icône lucide-react */
  icon: React.ReactNode;
  section: SectionId;
};

// ---------------------------------------------------------------------------
// Définition des liens — les href sont INCHANGÉS (ne pas modifier)
// ---------------------------------------------------------------------------

const ADMIN_LINKS: AdminLink[] = [
  {
    href: "/admin/account",
    label: "Mon compte Discord",
    description: "Profil, serveurs et rôles du compte connecté",
    icon: <Shield className="h-4 w-4" />,
    section: "securite",
  },
  {
    href: "/admin/audit",
    label: "Journal des actions",
    description: "Actions du bot et audit Discord",
    icon: <FileText className="h-4 w-4" />,
    section: "securite",
  },
  {
    href: "/admin/logs",
    label: "Journaux du service",
    description: "Sortie du service Shenron",
    icon: <Terminal className="h-4 w-4" />,
    section: "systeme",
  },
  // ACCUEIL & ADMINISTRATION GÉNÉRALE
  {
    href: "/admin/dashboard",
    label: "Tableau de bord",
    description: "Vue d'ensemble du bot",
    icon: <LayoutDashboard className="h-4 w-4" />,
    section: "pilotage",
  },
  {
    href: "/admin/home",
    label: "Page d'accueil",
    description: "Réorganiser la home : sections, clips de fond, contenu",
    icon: <Home className="h-4 w-4" />,
    section: "site",
  },
  {
    href: "/admin/design",
    label: "Design & thème",
    description: "Palette et coins appliqués à tout le site",
    icon: <Palette className="h-4 w-4" />,
    section: "site",
  },
  {
    href: "/admin/sync",
    label: "Synchronisation",
    description: "Synchroniser Discord ↔ base de données",
    icon: <RefreshCw className="h-4 w-4" />,
    section: "pilotage",
  },
  {
    href: "/admin/settings",
    label: "Paramètres",
    description: "Réglages généraux du bot",
    icon: <Settings className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/bot",
    label: "Gestion du bot",
    description: "État et contrôle des personas",
    icon: <Bot className="h-4 w-4" />,
    section: "pilotage",
  },
  {
    href: "/admin/console",
    label: "Console bots",
    description: "Voir les messages d'un salon et faire parler une persona",
    icon: <Send className="h-4 w-4" />,
    section: "pilotage",
  },
  {
    href: "/admin/send",
    label: "Envoyer un message",
    description: "Diffuser une annonce via le bot",
    icon: <MessageSquare className="h-4 w-4" />,
    section: "pilotage",
  },
  {
    href: "/admin/commandes",
    label: "Exécuter une commande",
    description: "Lancer une commande du bot à distance (XP, zénis, races, rôles…)",
    icon: <Terminal className="h-4 w-4" />,
    section: "pilotage",
  },

  // SYSTÈME & TECHNIQUE
  {
    href: "/admin/events",
    label: "Événements",
    description: "Événements Discord reçus",
    icon: <CalendarDays className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/cron",
    label: "Tâches planifiées",
    description: "Jobs automatiques (cron)",
    icon: <Clock className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/services",
    label: "Services",
    description: "État des services internes",
    icon: <Server className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/live",
    label: "En direct",
    description: "Activité en temps réel",
    icon: <Radio className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/stats",
    label: "Statistiques",
    description: "Chiffres globaux d'utilisation",
    icon: <BarChart2 className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/activite",
    label: "Activité du site",
    description: "Audience web : visites, visiteurs, sources, top pages",
    icon: <Activity className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/ia",
    label: "IA & Canon",
    description: "Supervision, entraînement RAG, doctrine et agents",
    icon: <Brain className="h-4 w-4 text-dbz-orange" />,
    section: "systeme",
  },
  {
    href: "/admin/triggers",
    label: "Déclencheurs",
    description: "Réponses automatiques aux messages",
    icon: <Zap className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/webhooks",
    label: "Webhooks",
    description: "Connexions externes et notifications",
    icon: <Webhook className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/database",
    label: "Base de données",
    description: "Accès direct aux tables",
    icon: <Database className="h-4 w-4" />,
    section: "systeme",
  },

  // ENCYCLOPÉDIE / WIKI DBZ
  {
    href: "/admin/lancement",
    label: "Lancement wiki",
    description: "Ouvrir les catégories au public une par une (gating bêta)",
    icon: <Rocket className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/visibilite",
    label: "Visibilité",
    description: "Afficher/masquer chaque entité du wiki sur le site public",
    icon: <Eye className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/sources",
    label: "Sources",
    description: "Origines des données wiki",
    icon: <BookOpen className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/assets",
    label: "Images & médias",
    description: "Illustrations, icônes et visuels",
    icon: <ImageIcon className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/campagnes-bxc",
    label: "Campagnes BXC",
    description: "Réception, provenance et revue des collectes BXC",
    icon: <Activity className="h-4 w-4 text-dbz-orange" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/sagas",
    label: "Sagas",
    description: "Arcs narratifs de l'univers DBZ",
    icon: <MapPin className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/episodes",
    label: "Épisodes",
    description: "Catalogue des épisodes",
    icon: <Tv2 className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/films",
    label: "Films",
    description: "Films et OAV Dragon Ball",
    icon: <Film className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/chronologie",
    label: "Chronologie",
    description: "Ordre officiel de la frise universelle (épisodes + films)",
    icon: <History className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/games",
    label: "Jeux vidéo",
    description: "Jeux Dragon Ball référencés",
    icon: <Gamepad2 className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/db-universe/databooks",
    label: "Databooks & interviews",
    description: "Guides officiels, artbooks et interviews (triables par date)",
    icon: <BookOpen className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/databooks",
    label: "Databooks & Traductions",
    description: "Catalogue des 440 ouvrages, traductions et synchronisation",
    icon: <BookOpen className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/transcriptions",
    label: "Transcriptions & Arbitrage",
    description: "Suivi global, arbitrage des défauts et relecture des planches",
    icon: <ScanText className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/wiki",
    label: "Wiki (articles libres)",
    description: "Pages wiki rédigées manuellement",
    icon: <BookText className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/wiki/history",
    label: "Historique wiki",
    description: "Journal des révisions du wiki + retour arrière",
    icon: <History className="h-4 w-4" />,
    section: "encyclopedie",
  },
  {
    href: "/admin/posts",
    label: "Articles / Actualités",
    description: "Publications et annonces du serveur",
    icon: <FileText className="h-4 w-4" />,
    section: "site",
  },
  {
    href: "/admin/banners",
    label: "Bannières",
    description: "Visuels éditoriaux et annonces mises en avant",
    icon: <ImageIcon className="h-4 w-4" />,
    section: "site",
  },
  {
    href: "/admin/agents",
    label: "Agents & API",
    description: "Clés d'accès des agents, portées et journal des écritures",
    icon: <Bot className="h-4 w-4" />,
    section: "systeme",
  },
  {
    href: "/admin/a2a",
    label: "Coordination A2A",
    description: "Tâches, agents et échanges du protocole A2A",
    icon: <Radio className="h-4 w-4" />,
    section: "systeme",
  },
  {
    // Documentation de l'API d'écriture : interne par construction (règle 17),
    // donc rangée ici plutôt que sur une route publique gardée par un `notFound()`
    // — mesuré en production, ce garde rendait la page not-found avec un 200.
    href: "/admin/api-docs",
    label: "Documentation API",
    description: "Portées, endpoints d'écriture et routes du bot",
    icon: <Bot className="h-4 w-4" />,
    section: "systeme",
  },

  // COMMUNAUTÉ & SOCIAL
  {
    href: "/admin/discord",
    label: "Serveurs Discord",
    description: "Guildes et membres connectés",
    icon: <Users className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/profile",
    label: "Profils membres",
    description: "Fiches et données des membres",
    icon: <UserCircle className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/canvas",
    label: "Cartes de profil",
    description: "Visuels générés (niveau, profil)",
    icon: <Palette className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/canvas/themes",
    label: "Thèmes visuels",
    description: "Thèmes disponibles pour les cartes",
    icon: <Layers className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/giveaways",
    label: "Cadeaux & Tirages",
    description: "Concours et cadeaux en cours",
    icon: <Gift className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/tickets",
    label: "Tickets de support",
    description: "Demandes d'aide des membres",
    icon: <Ticket className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/signalements",
    label: "Signalements",
    description: "Erreurs remontées par les membres depuis le site",
    icon: <Flag className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/wiki/contributions",
    label: "Contributions wiki",
    description: "Corrections proposées par les membres — à relire et publier",
    icon: <PenLine className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/tierlists",
    label: "Tier lists",
    description: "Modérer, mettre en avant et créer des tier lists officielles",
    icon: <ListOrdered className="h-4 w-4" />,
    section: "communaute",
  },
  {
    href: "/admin/messages",
    label: "Messages",
    description: "Historique des messages importants",
    icon: <MessageSquare className="h-4 w-4" />,
    section: "communaute",
  },

  // ÉCONOMIE & PROGRESSION
  {
    href: "/admin/economy",
    label: "Économie",
    description: "Soldes, transactions, Zénies",
    icon: <Coins className="h-4 w-4" />,
    section: "economie",
  },
  {
    href: "/admin/levels",
    label: "Niveaux & XP",
    description: "Progression et paliers d'expérience",
    icon: <TrendingUp className="h-4 w-4" />,
    section: "economie",
  },
  {
    href: "/admin/shop",
    label: "Boutique",
    description: "Articles disponibles à l'achat",
    icon: <ShoppingBag className="h-4 w-4" />,
    section: "economie",
  },
  {
    href: "/admin/leaderboards",
    label: "Classements",
    description: "Meilleurs joueurs et combattants",
    icon: <Trophy className="h-4 w-4" />,
    section: "economie",
  },
  {
    href: "/admin/ursaf",
    label: "URSAF & inflation",
    description: "Avis d'imposition des tricheurs, indice des prix du serveur",
    icon: <Landmark className="h-4 w-4" />,
    section: "economie",
  },
  {
    href: "/admin/concours",
    label: "Concours communauté",
    description: "Top noteurs, top Zénis et dossier d'intégrité par membre",
    icon: <Medal className="h-4 w-4" />,
    section: "economie",
  },

  // MODÉRATION & SÉCURITÉ
  {
    href: "/admin/moderation",
    label: "Modération",
    description: "Sanctions, mutes, bans",
    icon: <Shield className="h-4 w-4" />,
    section: "securite",
  },
  {
    // Commentaires du SITE (articles, fiches wiki, databooks, tier lists) — à
    // distinguer de la modération Discord juste au-dessus : deux surfaces, deux
    // jeux de données, mais la même section parce que c'est le même métier.
    href: "/admin/moderation/commentaires",
    label: "Commentaires du site",
    description: "File unique des commentaires, toutes surfaces confondues",
    icon: <MessageSquare className="h-4 w-4" />,
    section: "securite",
  },
  {
    href: "/admin/audit-internal",
    label: "Journal interne",
    description: "Logs d'audit internes du bot",
    icon: <BookMarked className="h-4 w-4" />,
    section: "securite",
  },
  {
    href: "/admin/hierarchy",
    label: "Hiérarchie des rôles",
    description: "Rangs et rôles Discord",
    icon: <Crown className="h-4 w-4" />,
    section: "securite",
  },
  // Une seule entrée pour une seule page. « Permissions commandes » (Modération)
  // et « Commandes Discord » (Système) menaient à deux écrans distincts qui
  // pilotaient la MÊME table `command_permissions` ; le premier était cassé.
  // Le libellé de Modération est conservé — c'est celui qu'on cherche — et il
  // pointe désormais la page qui fonctionne.
  {
    href: "/admin/commands",
    label: "Permissions commandes",
    description: "Qui peut utiliser quelle commande du bot",
    icon: <Key className="h-4 w-4" />,
    section: "securite",
  },
];

// ---------------------------------------------------------------------------
// Configuration des sections — libellés et ordre d'affichage
// ---------------------------------------------------------------------------

type SectionConfig = {
  id: SectionId;
  label: string;
  description: string;
};

const SECTIONS: SectionConfig[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    description: "Actions quotidiennes et bot",
  },
  {
    id: "site",
    label: "Site & publication",
    description: "Accueil, design et contenus",
  },
  {
    id: "systeme",
    label: "Système & intégrations",
    description: "Services, automatisations et accès",
  },
  {
    id: "encyclopedie",
    label: "Encyclopédie Dragon Ball",
    description: "Wiki, sagas, films, jeux",
  },
  {
    id: "communaute",
    label: "Communauté",
    description: "Membres, échanges et créations",
  },
  {
    id: "economie",
    label: "Économie & Progression",
    description: "Niveaux, boutique, classements",
  },
  {
    id: "securite",
    label: "Modération & Sécurité",
    description: "Sanctions, rôles, permissions",
  },
];

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function AdminSidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <AdminSidebarView
      pathname={pathname}
      links={ADMIN_LINKS}
      sections={SECTIONS}
      linkComponent={Link}
      initialSection="pilotage"
      brand="Aphrody · Shenron"
    />
  );
}
