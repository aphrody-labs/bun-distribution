import { BASE_ESPORT, BASE_WIKI, CHEMINS_ESPORT, CHEMINS_WIKI, esport, wiki } from "./routes";

export interface NavItem {
  label: string;
  path: string;
  imageUrl?: string;
  commonSprite?: string;
  /** Clé d'une VRAIE icône de menu du jeu (cf. `config/game-icons.ts` des apps). */
  gameIcon?: string;
  /**
   * Clé d'une emote Rose Griffon (`lib/emotes.ts`) — Roy, Gaëlle, le griffon.
   *
   * La navigation rendait des pictogrammes lucide génériques : un même dessin
   * de « maison » pour l'accueil d'un site d'association Inazuma Eleven que
   * pour n'importe quel tableau de bord. Les emotes et les icônes du jeu sont
   * les images que cette communauté reconnaît ; elles passent devant.
   */
  emote?: string;
  icon: string;
  adminOnly?: boolean;
  defaultOpen?: boolean;
  children?: NavItem[];
  /**
   * Entête de groupe : l'item n'est PAS une destination, seulement un
   * déclencheur de repli. Les quatre groupes de l'administration (`content`,
   * `social`, `tools`, `security`) n'ont aucune route derrière eux — sans ce
   * drapeau, la barre latérale en faisait des liens qui tombaient en 404.
   */
  groupOnly?: boolean;
  /** Préfixes supplémentaires qui rendent l'item actif (navigation mobile). */
  activePaths?: string[];
  /**
   * Visibilité déclarative d'une destination. L'interface l'utilise seulement
   * pour ne pas proposer un écran auquel la session courante n'a pas accès ;
   * l'API reste l'autorité qui autorise ou refuse chaque opération.
   */
  access?: {
    requiresAuthentication?: boolean;
    /** Rôle Achilléa: 1 modérateur, 2 administrateur, 3 super-administrateur. */
    minimumAchilleaRole?: number;
    /** Rôle de clan: 2 vice-président, 3 président. */
    minimumClanRole?: number;
  };
}

/**
 * Une route est-elle « sous » une entrée de menu ?
 *
 * Comparaison par SEGMENT, jamais par préfixe de chaîne : `/modeles` commence par
 * `/mode` sans être dedans, et les trois barres de navigation (colonne, rail,
 * barre du bas) testaient `pathname.startsWith(item.path)` — la page des modèles
 * allumait donc aussi l'entrée des modes. Symétriquement, un simple `===`
 * n'allumait rien du tout sur une fiche : `/chara/c05028001` laissait « Joueurs »
 * éteint. Les deux défauts se corrigent au même endroit.
 *
 * La racine est un cas à part : tout chemin lui est subordonné, seule l'égalité
 * la rend active.
 */
export function estRouteActive(pathname: string, path: string): boolean {
  if (path === "/") {
    return pathname === "/";
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Une entrée de menu est active quand on est sur sa route, sur une de ses routes
 * annexes (`activePaths`), ou sur la route d'un de ses enfants — un parent replié
 * doit se signaler quand la page courante est dans sa section.
 */
export function estItemActif(pathname: string, item: NavItem): boolean {
  if (item.activePaths?.some(p => estRouteActive(pathname, p))) {
    return true;
  }
  if (!item.groupOnly && estRouteActive(pathname, item.path)) {
    return true;
  }
  return Boolean(item.children?.some(enfant => estItemActif(pathname, enfant)));
}

/** Parcourt un arbre de navigation en profondeur. */
export function parcourirNav(items: NavItem[]): NavItem[] {
  return items.flatMap(item => [item, ...parcourirNav(item.children ?? [])]);
}

/**
 * Conserve la structure du menu après avoir écarté les destinations que la
 * session ne peut pas utiliser. Centraliser ce filtrage évite qu'une entrée
 * protégée reste visible dans un accordéon alors qu'elle est absente d'une
 * autre surface de navigation.
 */
export function filtrerNavigation(items: NavItem[], canView: (item: NavItem) => boolean): NavItem[] {
  return items.flatMap(item => {
    if (!canView(item)) return [];
    const children = item.children ? filtrerNavigation(item.children, canView) : undefined;
    // Un groupe purement structurel ne doit pas devenir un accordéon vide.
    if (item.groupOnly && item.children && children?.length === 0) return [];
    return [{ ...item, ...(item.children ? { children } : {}) }];
  });
}

/**
 * Tous les chemins réellement cliquables d'un arbre : les entêtes de groupe sont
 * exclues puisqu'elles ne pointent nulle part. C'est cette liste que le test de
 * non-régression confronte aux routes présentes sur le disque.
 */
export function cheminsCliquables(items: NavItem[]): string[] {
  return [
    ...new Set(
      parcourirNav(items)
        .filter(i => !i.groupOnly)
        .map(i => i.path),
    ),
  ];
}

/**
 * Navigation principale (barre latérale + rail), préfixée pour l'app hôte.
 *
 * `w()` préfixe les routes du wiki ; les routes de service (`/news`,
 * `/settings`) restent à la racine dans les deux apps et ne doivent JAMAIS être
 * préfixées — `/wiki/news` et `/wiki/settings` n'existent pas côté website.
 */
export function construireNavigationItems(): NavItem[] {
  const w = wiki;

  return [
    // Accueil : pictogramme Material, le logo Azalée reste réservé à l'entête du groupe.
    { icon: "home", label: "nav.home", path: w("/") },
    // Sprite « lien » : connexion/collaboration, utilisé pour Inazuma Eleven Cross.
    { commonSprite: "lien", icon: "sports_soccer", label: "nav.cross", path: w("/cross") },
    // Les articles et notes de version décrivent l'actualité du jeu et du wiki.
    { icon: "feed", label: "nav.association.news", path: "/news" },
    { icon: "update", label: "nav.news.patch_notes", path: w("/patch-notes") },
    // — Base de données (wiki curé) —
    // Sprite « chara » : portrait/personnage, donc index des joueurs.
    { commonSprite: "chara", icon: "groups", label: "nav.wiki.players", path: w("/chara") },
    {
      // Techniques, tactiques, passifs (capacités hors hyper).
      children: [
        {
          label: "nav.wiki.skills",
          path: w("/skill"),
          icon: "sports_martial_arts",
          commonSprite: "skill",
        },
        {
          commonSprite: "justice",
          label: "nav.wiki.tactics",
          path: w("/tactic"),
          icon: "strategy",
        },
        {
          label: "nav.wiki.passives",
          path: w("/passive"),
          icon: "auto_awesome",
          commonSprite: "tension",
        },
      ],
      icon: "sports_martial_arts",
      label: "nav.section.abilities",
      path: w("/skill"),
    },
    {
      // Hyper-techniques (5 familles d'auras).
      children: [
        {
          label: "nav.wiki.auras.keshin",
          path: w("/aura/esprits-guerriers"),
          icon: "swords",
          commonSprite: "keshin",
        },
        {
          label: "nav.wiki.auras.soul",
          path: w("/aura/totems"),
          icon: "pets",
          commonSprite: "soul",
        },
        {
          label: "nav.wiki.auras.miximax",
          path: w("/aura/miximax"),
          icon: "group_add",
          commonSprite: "miximax",
        },
        {
          label: "nav.wiki.auras.awakening",
          path: w("/aura/eveil"),
          icon: "wb_twilight",
          commonSprite: "eveil",
        },
        {
          label: "nav.wiki.auras.mode",
          path: w("/aura/changement-mode"),
          icon: "change_circle",
          commonSprite: "mode_change",
        },
      ],
      icon: "auto_awesome",
      label: "nav.wiki.hyper_skills",
      path: w("/aura"),
    },
    {
      // Équipes, entraîneurs, stades.
      children: [
        { label: "nav.wiki.teams", path: w("/equipe"), icon: "shield", gameIcon: "emblem" },
        { label: "nav.wiki.coaches", path: w("/entraineur"), icon: "sports", gameIcon: "medal" },
        { label: "nav.wiki.stadiums", path: w("/stade"), icon: "stadium", gameIcon: "stadium" },
      ],
      gameIcon: "emblem",
      icon: "shield",
      label: "nav.section.clubs",
      path: w("/equipe"),
    },
    {
      // Objets & moyens d'obtention (boutiques, capsules, drops).
      children: [
        { label: "nav.wiki.items", path: w("/item"), icon: "backpack", gameIcon: "chest" },
        { label: "nav.wiki.shops", path: w("/boutique"), icon: "storefront", gameIcon: "moneybag" },
        { label: "nav.wiki.capsules", path: w("/capsule"), icon: "casino", gameIcon: "ticket" },
        {
          label: "nav.wiki.invocation",
          path: w("/invocation"),
          icon: "stars",
          gameIcon: "star-token",
        },
        { gameIcon: "creature", label: "nav.wiki.drops", path: w("/drops"), icon: "redeem" },
      ],
      gameIcon: "chest",
      icon: "backpack",
      label: "nav.section.items",
      path: w("/item"),
    },
    { icon: "task_alt", label: "nav.wiki.quests", path: w("/quete") },
    {
      // Table d'expérience du jeu (`inagle_exp_table`) : courbe + calculateurs.
      icon: "trending_up",
      label: "nav.wiki.levels",
      path: w("/niveau"),
    },
    { gameIcon: "medal", icon: "emoji_events", label: "nav.wiki.trophies", path: w("/succes") },
  ];
}

/**
 * Navigation mobile unifiée à 5 onglets pour les apps multi-domaines (website).
 *
 * 1. Accueil (Association)
 * 2. Wiki (Wiki Azalée)
 * 3. E-Sport (Achilléa)
 * 4. Recherche (Global federated search)
 * 5. Paramètres / Compte
 */
export function construireMobileNavUnifiee(): NavItem[] {
  // Les chemins NON préfixés restent dans `activePaths` : `rosegriffon.fr`
  // sert encore les anciennes URL d'azalee.rosegriffon.fr par redirection
  // permanente, et l'onglet doit rester allumé le temps qu'elle se résolve.
  const cheminsWikiActifs = [
    ...CHEMINS_WIKI.filter(c => c !== "/").map(wiki),
    ...CHEMINS_WIKI.filter(c => c !== "/"),
    BASE_WIKI,
  ];

  const cheminsEsportActifs = CHEMINS_ESPORT.map(esport);

  return [
    {
      activePaths: ["/"],
      icon: "home",
      label: "nav.home",
      path: "/",
    },
    {
      activePaths: [...new Set(cheminsWikiActifs)],
      icon: "menu_book",
      label: "nav.wiki",
      path: BASE_WIKI,
    },
    {
      activePaths: [...new Set(cheminsEsportActifs)],
      icon: "sports_esports",
      label: "nav.domaine.esport",
      path: BASE_ESPORT,
    },
    {
      activePaths: ["/search"],
      icon: "search",
      label: "nav.search",
      path: "/search",
    },
    {
      activePaths: ["/settings", "/login", "/profile"],
      icon: "settings",
      label: "nav.settings",
      path: "/settings",
    },
  ];
}

// ─── NAVIGATION UNIFIÉE — TROIS DOMAINES ─────────────────────────────────────
//
// Depuis la fusion des trois sites sous `rosegriffon.fr`, un seul menu doit
// porter le wiki Azalée, l'e-sport Achilléa et le portail de l'association.
// Les empiler à plat donnerait une cinquantaine d'entrées sans hiérarchie :
// on les groupe donc en trois sous-catégories repliables.
//
// TOUT EST ADDITIF. `construireNavigationItems` et ses sœurs ne changent pas de
// signature ni de résultat : les apps migrent quand elles veulent, et rien ne
// casse entre-temps.

/**
 * Les trois domaines et catégories de premier niveau du réseau.
 * L'actualité (/news) est intégrée dans la catégorie Wiki.
 */
export const DOMAINES = ["association", "wiki", "esport"] as const;

export type Domaine = (typeof DOMAINES)[number];

/** Les catégories de premier niveau du menu, dans l'ordre d'affichage. */
export const GROUPES_NAV = ["association", "wiki", "esport"] as const;

export type GroupeNav = (typeof GROUPES_NAV)[number];

export interface SousCategorieNav {
  /** Catégorie de menu, pour cibler un style ou ouvrir le bon accordéon. */
  domaine: GroupeNav;
  /** Entrée racine repliable, avec ses enfants. */
  item: NavItem;
}

/** Menu de l'e-sport (Achilléa). */
export function construireEsportItems(): NavItem[] {
  const e = esport;

  return [
    {
      // L'accueil garde un pictogramme Material ; le logo est déjà sur le groupe.
      icon: "sports_esports",
      label: "nav.esport.home",
      path: e("/"),
    },
    {
      children: [
        { icon: "groups", label: "nav.esport.clans.list", path: e("/clans") },
        {
          icon: "add_circle",
          label: "nav.esport.clans.create",
          path: e("/clans/create"),
          access: { requiresAuthentication: true },
        },
        {
          icon: "shield",
          label: "nav.esport.clans.dashboard",
          path: e("/clans/dashboard"),
          access: { minimumClanRole: 2 },
        },
      ],
      icon: "groups",
      label: "nav.esport.clans",
      path: e("/clans"),
    },
    {
      children: [
        {
          icon: "leaderboard",
          label: "nav.esport.ranked.leaderboard",
          path: e("/ranked/leaderboard"),
        },
        { icon: "military_tech", label: "nav.esport.ranked.tiers", path: e("/ranked/tiers") },
        {
          icon: "swords",
          label: "nav.esport.ranked.play",
          path: e("/ranked"),
          access: { requiresAuthentication: true },
        },
        {
          icon: "history",
          label: "nav.esport.ranked.history",
          path: e("/ranked/history"),
          access: { requiresAuthentication: true },
        },
      ],
      icon: "swords",
      label: "nav.esport.ranked",
      path: e("/ranked/leaderboard"),
    },
    {
      children: [
        {
          icon: "emoji_events",
          label: "nav.esport.tournaments.list",
          path: e("/tournaments"),
        },
        {
          icon: "add_circle",
          label: "nav.esport.tournaments.create",
          path: e("/tournaments/create"),
          access: { requiresAuthentication: true },
        },
        {
          icon: "trending_up",
          label: "nav.esport.tournaments.circuit",
          path: e("/tournaments/circuit/ranking"),
        },
      ],
      icon: "emoji_events",
      label: "nav.esport.tournaments",
      path: e("/tournaments"),
    },
    {
      // Marque de l'Astral League (`public/achillea/leagues/astral-logo-mark.png`).
      icon: "stadium",
      imageUrl: "/achillea/leagues/astral-logo-mark.png",
      label: "nav.esport.leagues",
      path: e("/leagues/astral"),
    },
    { icon: "live_tv", label: "nav.esport.casts", path: e("/casts") },
    {
      children: [
        {
          icon: "badge",
          label: "nav.esport.licence",
          path: e("/licence"),
          access: { requiresAuthentication: true },
        },
        {
          icon: "account_balance_wallet",
          label: "nav.esport.wallet",
          path: e("/wallet"),
          access: { requiresAuthentication: true },
        },
        {
          icon: "deployed_code",
          label: "nav.esport.organizations.create",
          path: e("/organizations/create"),
          access: { requiresAuthentication: true },
        },
      ],
      icon: "person",
      label: "nav.esport.my_space",
      path: e("/licence"),
      access: { requiresAuthentication: true },
    },
    {
      children: [
        {
          icon: "dashboard",
          label: "nav.esport.admin.dashboard",
          path: e("/admins/dashboard"),
          access: { minimumAchilleaRole: 1 },
        },
        {
          icon: "gavel",
          label: "nav.esport.admin.disputes",
          path: e("/admins/ranked-disputes"),
          access: { minimumAchilleaRole: 2 },
        },
        {
          icon: "warning",
          label: "nav.esport.admin.sanctions",
          path: e("/admins/sanctions"),
          access: { minimumAchilleaRole: 2 },
        },
        {
          icon: "verified",
          label: "nav.esport.admin.organizations",
          path: e("/organizations/validate"),
          access: { minimumAchilleaRole: 2 },
        },
      ],
      icon: "dashboard",
      label: "nav.esport.admin",
      path: e("/admins/dashboard"),
      access: { minimumAchilleaRole: 1 },
    },
    { icon: "menu_book", label: "nav.esport.guide", path: e("/guide") },
  ];
}

/**
 * Menu « Actualité » — le FLUX, rien d'autre.
 *
 * Quatrième catégorie de premier niveau : ce qu'on vient consulter
 * régulièrement, par opposition à la vie de l'association, qui se lit une fois.
 * Les événements et la webTV en sont sortis — ce sont des activités de
 * l'association, pas des publications.
 *
 * `/chroniques` n'y figure plus : le fil est unifié sous `/news`, où les
 * chroniques sont un filtre et non un second site.
 */
export function construireActualiteItems(): NavItem[] {
  return [{ emote: "gaelle-fiere", icon: "feed", label: "nav.association.news", path: "/news" }];
}

/**
 * Menu de l'association.
 *
 * « Vie de la communauté » et « L'association » n'en font plus qu'UNE. Les
 * sous-projets (RGTV, IERGDay) sont regroupés sous « Projets ». Le doublon
 * de chroniques et la coquille inutile de la page association sont retirés.
 */
export function construireAssociationItems(): NavItem[] {
  return [
    // Le groupe porte déjà le logo RG : l'accueil utilise le symbole Maison.
    { icon: "home", label: "nav.association.home", path: "/" },
    { emote: "rg-funny", icon: "forum", label: "nav.association.community", path: "/community" },
    { emote: "gaelle-salut", icon: "groups", label: "nav.association.team", path: "/notre-equipe" },
    { icon: "event", label: "nav.association.events", path: "/evenements" },
    { icon: "how_to_vote", label: "nav.association.polls", path: "/sondages" },
    {
      children: [
        {
          icon: "live_tv",
          imageUrl: "/rgtv/rgtv.webp",
          label: "nav.association.rgtv",
          path: "/rose-griffon-tv",
        },
        {
          emote: "roy-coeur",
          icon: "celebration",
          label: "nav.association.iergday",
          path: "/iergday",
        },
        {
          emote: "gaelle-fiere",
          icon: "account_circle",
          label: "nav.association.avatar_rg",
          path: "/projets/outils/pfp",
        },
        {
          emote: "gaelle-coeur",
          icon: "palette",
          label: "nav.association.nostalgie",
          path: "/projets/nostalgie",
        },
        {
          emote: "rg-funny",
          icon: "groups",
          label: "nav.association.murals",
          path: "/projets/muraux",
        },
        {
          emote: "gaelle-surprise",
          icon: "sentiment_satisfied",
          label: "nav.association.emotes",
          path: "/projets/emotes",
        },
      ],
      icon: "rocket_launch",
      label: "nav.association.projects",
      path: "/projets",
    },
    {
      icon: "volunteer_activism",
      label: "nav.association.support",
      path: "/nous-soutenir",
    },
  ];
}

/**
 * Menu complet, groupé en trois catégories : association, wiki et e-sport.
 *
 * `groupOnly` sur l'entête : le groupe n'est pas une destination, seulement un
 * déclencheur de repli — sans ce drapeau la barre latérale en ferait un lien
 * vers une page qui n'existe pas.
 */
export function construireNavigationUnifiee(): SousCategorieNav[] {
  const groupes: {
    domaine: GroupeNav;
    enfants: NavItem[];
    icon: string;
    imageUrl?: string;
    emote?: string;
    label: string;
    /**
     * Déplié au chargement.
     *
     * La barre n'affiche qu'un univers à la fois. L'association est le repli
     * initial ; le composant de navigation ouvre ensuite automatiquement le
     * groupe correspondant à la route courante.
     */
    ouvertParDefaut: boolean;
  }[] = [
    {
      domaine: "association",
      enfants: construireAssociationItems(),
      icon: "diversity_3",
      imageUrl: "/RG_Logo_V2.5.webp",
      label: "nav.domaine.association",
      ouvertParDefaut: true,
    },
    {
      domaine: "wiki",
      enfants: construireNavigationItems(),
      icon: "menu_book",
      imageUrl: "/RG_Azalee-logo.webp",
      label: "nav.domaine.wiki",
      ouvertParDefaut: false,
    },
    {
      domaine: "esport",
      enfants: construireEsportItems(),
      icon: "sports_esports",
      imageUrl: "/achillea/logo1.svg",
      label: "nav.domaine.esport",
      ouvertParDefaut: false,
    },
  ];

  return groupes
    .filter(groupe => groupe.enfants.length > 0)
    .map(groupe => ({
      domaine: groupe.domaine,
      item: {
        children: groupe.enfants,
        defaultOpen: groupe.ouvertParDefaut,
        ...(groupe.emote ? { emote: groupe.emote } : {}),
        groupOnly: true,
        icon: groupe.icon,
        ...(groupe.imageUrl ? { imageUrl: groupe.imageUrl } : {}),
        label: groupe.label,
        path: `#${groupe.domaine}`,
      },
    }));
}

/**
 * Domaine auquel appartient une route.
 *
 * Sert à ouvrir la bonne sous-catégorie au chargement et à appliquer le thème
 * de section. L'ordre du test compte : l'e-sport et le wiki sont préfixés, donc
 * testés d'abord ; l'association est la racine et récupère tout le reste.
 */
export function domaineDeLaRoute(pathname: string): Domaine {
  if (estRouteActive(pathname, BASE_ESPORT)) return "esport";
  if (estRouteActive(pathname, BASE_WIKI)) return "wiki";
  if (pathname === "/news" || pathname.startsWith("/news/")) return "wiki";
  return "association";
}

/**
 * Arbre rendu par les TROIS surfaces de navigation (barre latérale, rail,
 * barre du bas).
 *
 * Ce bloc de résolution était recopié à l'identique dans les trois composants,
 * avec chacun sa branche `bases.esport !== undefined` et son repli vers
 * `construireDashboardItems` — lequel n'était jamais rendu, l'administration
 * ayant sa propre barre latérale (`AdminSidebar`). Une seule fonction, donc.
 */
export function itemsDeNavigation(): NavItem[] {
  return construireNavigationUnifiee().map(groupe => groupe.item);
}
