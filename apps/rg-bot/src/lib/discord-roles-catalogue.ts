/**
 * Noyau PUR du catalogue de rôles Discord — décodage des permissions et
 * classification, sans aucune I/O (ni réseau, ni base). Le script qui
 * remplit `discord_roles_catalogue` (`scripts/sync-roles-catalogue.ts`) ne
 * fait qu'aller chercher les FAITS et appeler ce qui est ici.
 *
 * ── POURQUOI UNE CLASSIFICATION PAR IDENTIFIANT, PAS PAR REGEX SUR LE NOM ──
 * Le serveur porte deux rôles strictement homonymes (`Joueur Intermédiaire`,
 * `1220472997240897607` et `1086256838137352242`) qui n'ont RIEN en commun :
 * l'un est un palier de la ladder d'activité (132 porteurs, permission
 * `SendMessagesInThreads`), l'autre un titre à 3 porteurs sans permission,
 * assis au milieu des rôles d'honneur (`Booster Riche`, `Membre d'honneur`).
 * Un filtre sur le texte du nom les aurait confondus. Le nom d'un rôle
 * `Médaille` est lui-même parfois écrit en caractères mathématiques Unicode
 * stylisés (`𝑴𝒆́𝒅𝒂𝒊𝒍𝒍𝒆 …`) qu'une regex `/^Médaille/` ne reconnaît pas. La
 * classification retient donc l'IDENTIFIANT du rôle comme clé, jamais son
 * texte — le texte ne sert qu'à écrire l'`utilite` une fois la catégorie déjà
 * choisie.
 *
 * ── CE QUI EST OBSERVABLE, ET CE QUI NE L'EST PAS ──────────────────────────
 * Trois catégories se déduisent d'un fait STRUCTUREL de l'API Discord, valable
 * pour n'importe quelle guilde et n'importe quand :
 *   - `base` — le rôle `@everyone` de la guilde (son nom l'identifie sans
 *     ambiguïté) ;
 *   - `bot`  — `role.managed === true` ET `role.tags.bot_id` présent : Discord
 *     a lui-même créé ce rôle à l'installation d'un bot, il n'est pas
 *     attribuable à la main ;
 *   - `abonnement` — `role.managed === true` SANS `bot_id` (booster Nitro via
 *     `tags.premium_subscriber`, ou abonnement de rôle payant via
 *     `tags.subscription_listing_id`) : Discord l'attribue et le retire tout
 *     seul selon le paiement.
 * Le reste (staff, modération, cosmétique, niveau, notification, accès) ne se
 * lit dans AUCUN champ de l'API : c'est une lecture humaine du nom, de la
 * position, des permissions et du nombre de porteurs, vérifiée rôle par rôle
 * sur l'export réel de la guilde Rose Griffon (`GET /guilds/{id}/roles`) et le
 * comptage réel de `discord_members` le 14/8/2026. Elle est donc figée dans
 * des ensembles d'identifiants ci-dessous, PAS dans une heuristique générique
 * — un futur rôle non listé ici rend `categorie: null, utilite: null` plutôt
 * qu'une catégorie devinée (cf. `classifierRole`, dernier repli).
 *
 * ── LES DEUX PALIERS PAYANTS « JOUEUR DELUXE » ─────────────────────────────
 * Confirmés par `apps/website/src/lib/patreon/types.ts` (`TIER_MAPPING`) :
 * ces trois rôles sont les récompenses Discord des paliers Patreon/Stripe
 * « Niveau Roy » (2,50 €), « Niveau Gaelle » (7,50 €) et « Niveau Evans »
 * (14,50 €) — un abonnement payant au sens plein, même si Discord ne les a
 * pas posés lui-même en `managed` (l'attribution passe par le webhook
 * Patreon, pas par une intégration native Discord).
 *
 * ── LA LADDER D'ACTIVITÉ NOCTALY (TEXTE + VOCAL) ────────────────────────────
 * Neuf rôles, identifiés avec certitude par `apps/bot/src/scripts/
 * import-xp-tiers.ts` (recherche croisée sur le bot de niveaux Noctaly,
 * 14/8/2026) : Noctaly tient DEUX pistes de niveau séparées par membre (texte
 * et vocal), avec un rôle distinct par piste à chaque palier (10/25/40/60),
 * plus un rôle spécial exigeant le palier 60 sur les DEUX pistes à la fois.
 *   Piste texte  : Joueur Intermédiaire(10) → Joueur FF(25) → Joueur FFI(40)
 *     → Joueur Route Victoire(60)
 *   Piste vocale : Petit Parleur(10) → Débiteur Avancé(25) → Orateur de
 *     talent(40) → Prédicateur Suprême(60)
 *   Spécial      : Les Patriarches (texte 60 ET vocal 60 à la fois — même
 *     bitfield de permissions que Prédicateur Suprême, cohérent avec un rôle
 *     de palier ÉGAL, juste doublement exigeant)
 * `import-xp-tiers.ts` n'importe QUE la piste texte dans `bot_recompenses_
 * niveau` (notre système ne track pas d'XP vocale) : la piste vocale et le
 * rôle spécial restent des rôles Discord réels, juste hors de notre propre
 * système de récompenses.
 * `Joueur Débutant` (1073013308623429782), à l'inverse, N'EST PAS un palier
 * Noctaly : le même fichier l'identifie comme le rôle donné automatiquement
 * à l'arrivée sur le serveur — d'où ses 1 818 porteurs, proches du nombre
 * total de membres actifs. Catégorie `acces`, pas `niveau`.
 */
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

// ─── Décodage des permissions ───────────────────────────────────────────────

/**
 * Décode un bitfield décimal (`discord_roles.permissions`) vers les noms
 * OFFICIELS de `PermissionFlagsBits` (`"Administrator"`, `"BanMembers"`, …) —
 * exactement ce que `PermissionsBitField.toArray()` de discord.js rend, sans
 * traduction : ce sont ces chaînes qui servent de clé si on doit un jour
 * recomparer à un bitfield (`PermissionFlagsBits[nom]`), une traduction FR
 * perdrait cette propriété.
 */
export function decoderPermissions(permissionsDecimal: string): string[] {
  return new PermissionsBitField(BigInt(permissionsDecimal)).toArray();
}

/**
 * Les huit permissions dont la présence sur UN SEUL rôle change la nature du
 * risque qu'il porte — liste imposée par la mission, reprise telle quelle
 * (elle recoupe en grande partie `PERMISSIONS_SENSIBLES` de
 * `discord-admin.ts`, qui sert un autre usage — le diagnostic des DROITS DU
 * BOT — et ne doit pas être fusionnée avec elle : les deux évoluent pour des
 * raisons différentes).
 */
export const PERMISSIONS_DANGEREUSES: readonly bigint[] = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
]);

/** Vrai si le bitfield porte AU MOINS une des huit permissions dangereuses. */
export function estDangereux(permissionsDecimal: string): boolean {
  const bits = BigInt(permissionsDecimal);
  return PERMISSIONS_DANGEREUSES.some(drapeau => (bits & drapeau) === drapeau);
}

// ─── Catégories ──────────────────────────────────────────────────────────────

export const CATEGORIES_ROLE = [
  "base",
  "staff",
  "moderation",
  "bot",
  "abonnement",
  "cosmetique",
  "niveau",
  "notification",
  "acces",
] as const;

export type CategorieRole = (typeof CATEGORIES_ROLE)[number];

// ─── Faits d'entrée ──────────────────────────────────────────────────────────

/** Ce que le classifieur a besoin de savoir sur un rôle — rien de plus. */
export interface FaitsRole {
  readonly roleId: string;
  readonly nom: string;
  readonly position: number;
  /** Bitfield décimal, tel que rendu par l'API et stocké en base. */
  readonly permissions: string;
  /** `role.managed` de l'API — géré par une intégration, pas attribuable à la main. */
  readonly gereParIntegration: boolean;
  /** `role.tags.bot_id`, si le rôle appartient à un bot. */
  readonly tagBotId: string | null;
  /** `role.tags.premium_subscriber` OU `subscription_listing_id` présent. */
  readonly tagAbonnement: boolean;
  /** Membres actifs (`left_at IS NULL`) qui portent ce rôle, comptés en base. */
  readonly porteurs: number;
}

export interface ClassificationRole {
  readonly categorie: CategorieRole | null;
  readonly utilite: string | null;
}

// ─── Paliers payants « Joueur Deluxe » (Patreon/Stripe) ─────────────────────
// Source : apps/website/src/lib/patreon/types.ts → TIER_MAPPING, vérifié le
// 14/8/2026. `rgPlanName`/`grandfatheredCents` viennent de là, pas d'ici.
const TIERS_PATREON: ReadonlyMap<string, { nom: string; euros: number }> = new Map([
  ["1371177169216077864", { nom: "Niveau Roy", euros: 2.5 }],
  ["1371176894791159819", { nom: "Niveau Gaelle", euros: 7.5 }],
  ["1371176241213870131", { nom: "Niveau Evans", euros: 14.5 }],
]);

// ─── Ladder d'activité Noctaly (texte + vocal) ──────────────────────────────
// Source : apps/bot/src/scripts/import-xp-tiers.ts, § « RÉCOMPENSES DE RÔLE
// PAR PALIER » — paliers et XP Noctaly exacts, niveau-jeu recalculé par
// `niveauPour()`. Les quatre paliers TEXTE sont ceux réellement importés dans
// `bot_recompenses_niveau` ; VOCAL et le rôle spécial ne le sont pas (piste
// XP que notre système ne suit pas), mais restent des rôles réels du serveur.
const PALIERS_ACTIVITE: ReadonlyMap<string, string> = new Map([
  [
    "1086256838137352242", // Joueur Intermédiaire (PAS le doublon 1220472997240897607)
    "Palier Noctaly TEXTE 10 (4 025 XP → niveau 13 sur la courbe du jeu), importé dans bot_recompenses_niveau.",
  ],
  [
    "1086257086591160340", // Joueur FF
    "Palier Noctaly TEXTE 25 (36 625 XP → niveau 30 sur la courbe du jeu), importé dans bot_recompenses_niveau.",
  ],
  [
    "1086618597578776708", // Joueur FFI
    "Palier Noctaly TEXTE 40 (131 100 XP → niveau 45 sur la courbe du jeu), importé dans bot_recompenses_niveau.",
  ],
  [
    "1086619301714329720", // Joueur Route Victoire
    "Palier Noctaly TEXTE 60 (411 650 XP → niveau 62 sur la courbe du jeu), importé dans bot_recompenses_niveau.",
  ],
  [
    "1165331596170248192", // Petit Parleur
    "Palier Noctaly VOCAL 10, symétrique de « Joueur Intermédiaire » — piste vocale NON importée dans bot_recompenses_niveau.",
  ],
  [
    "1165332646591737997", // Débiteur Avancé
    "Palier Noctaly VOCAL 25, symétrique de « Joueur FF » — piste vocale NON importée dans bot_recompenses_niveau.",
  ],
  [
    "1165332891924963368", // Orateur de talent
    "Palier Noctaly VOCAL 40, symétrique de « Joueur FFI » — piste vocale NON importée dans bot_recompenses_niveau.",
  ],
  [
    "1165333255172665446", // Prédicateur Suprême
    "Palier Noctaly VOCAL 60, symétrique de « Joueur Route Victoire » — piste vocale NON importée dans bot_recompenses_niveau.",
  ],
  [
    "1165335240403849337", // Les Patriarches
    "Rôle spécial Noctaly exigeant le palier 60 sur LES DEUX pistes (texte ET vocal) à la fois — ni l'une ni l'autre piste n'étant importée seule, ce rôle combiné ne l'est pas non plus.",
  ],
]);

// ─── Badges cosmétiques (« Médaille … » + titres d'honneur statiques) ───────
// Aucune de ces 17 entrées ne sert à cibler une notification : ce sont des
// distinctions figées, décernées une fois, pas des étiquettes d'intérêt.
const COSMETIQUES: ReadonlySet<string> = new Set([
  "1132434348197556326", // Médaille Réglage
  "1089276039483641857", // Médaille Graphiste
  "1089273878674690090", // Médaille Traduction
  "1089276589679849504", // Médaille Réseaux
  "1089277008644673616", // Médaille Compétitif
  "1089275172609081463", // Médaille Wiki
  "1089274813559881750", // « Médaille » en Unicode mathématique stylisé
  "1141844126179012720", // Médaille Lore
  "1441200144753234075", // Médaille Architecte
  "1364903623783612498", // Médaille Azalée
  "1364905653918896150", // Médaille Achillea
  "1158164078787825684", // ANNIVERSAIRE !!!
  "1339195499902795818", // Membre d'honneur
  "1193177432606384189", // Inabikari
  "1163513558403907685", // Gagnants Tournois
  "1215661073433108501", // Gagnants concours
  "1220472997240897607", // Joueur Intermédiaire — DOUBLON de nom, 0 permission, 3 porteurs
]);

// ─── Étiquettes de notification / centre d'intérêt ──────────────────────────
// Permission nulle ou quasi nulle, grand nombre de porteurs hétérogènes,
// nommage thématique (loisir ou salon de diffusion « Direct <pseudo> ») :
// la fonction plausible est de servir de cible de mention ciblée par le staff
// plutôt que d'identifier un statut ou un pouvoir.
const NOTIFICATIONS: ReadonlySet<string> = new Set([
  "1263128822849470585", // Direct Euro
  "1226475873369325568", // Direct RG
  "1208045377090232410", // Direct TRE
  "1208045576835309648", // Direct Nioum
  "1208045726248992779", // Direct Ishido
  "1209535568472576090", // Direct Koenji
  "1294395724997595238", // Direct Bri
  "1294395808245874799", // Direct Tanej
  "1136286992620064778", // Sondage
  "1209528641021673482", // Quizz
  "1152301427243352104", // Cinéma
  "1258819718056509440", // Animation
  "1152305445097193614", // Compétiteur
  "1152050089423011881", // Cosplayer
  "1152050422102626395", // Créateur de contenu
  "1152050533289443358", // Dessinateur
  "1152049986297663518", // Auteur
  "1172725933514428447", // RG Roleplayer
  "1185708888381726850", // Smule
  "1210562041262116884", // Streamers affiliés
  "1379011060140474418", // Streamers WEBTV
  "1137382077906554962", // Annonces Mineures
  "1359506615765827744", // Annonces Azalée
  "1145381716916195328", // Annonces Lore
  "1257322355743526992", // Services Secrets
]);

// ─── Staff : autorité organisationnelle (Discord ou associative) ───────────
const STAFF: ReadonlyMap<string, string> = new Map([
  ["1072993826400124958", "Rôle d'administration suprême du serveur (permission Administrateur complète)."],
  [
    "1371547071362105374",
    "Second rôle d'administration, avec la même permission Administrateur que le rôle Administrateur principal.",
  ],
  [
    "1072991976179380244",
    "Rôle d'administration complète (Administrateur) tenu par un groupe de confiance plus large que « Administrateur » — nom évoquant une astreinte/veille.",
  ],
  [
    "1072992327766904865",
    "Rôle d'identification générale du staff, avec un large paquet de permissions de salon et de modération légère (pas Administrateur).",
  ],
  [
    "1130193914490540142",
    "Rôle d'appartenance à l'équipe Rose Griffon, avec la permission de gérer les webhooks (intégrations de salon).",
  ],
  [
    "1341163875919462420",
    "Rôle de secours à Administrateur complet (nom « double des clés »), détenu par une seule personne — filet de sécurité en cas d'indisponibilité des administrateurs habituels.",
  ],
  [
    "1306382542479556618",
    "Titre des membres du bureau de l'association Rose Griffon (loi 1901) — aucune permission Discord propre, c'est un statut associatif, pas un pouvoir technique.",
  ],
  [
    "1140078678357835909",
    "Rôle d'annonce officielle : gère les webhooks et peut mentionner @everyone/@here pour diffuser une annonce à tout le serveur.",
  ],
  [
    "1257695575915368529",
    "Rôle combinant annonce officielle (mention générale, gestion d'événements) et animation vocale (déplacer/mettre en sourdine) — actuellement sans porteur.",
  ],
  [
    "1145361441893908621",
    "Rôle d'hôte d'activités vocales : peut déplacer, mettre en sourdine et rendre muet en vocal pour animer une session (soirée jeu, événement).",
  ],
]);

// ─── Modération : pouvoir réel d'appliquer les règles ───────────────────────
const MODERATION: ReadonlyMap<string, string> = new Map([
  [
    "1267847004919300096",
    "Responsable de l'équipe de modération — porte la permission Administrateur complète pour agir sans dépendre d'un autre rôle.",
  ],
  [
    "1086314307383459880",
    "Rôle de modération de terrain : bannir, expulser, exclure temporairement, gérer les messages et les salons.",
  ],
  [
    "1196814100576088126",
    "Sous-équipe disposant d'un pouvoir d'expulsion (KickMembers) et de modération temporaire — probablement dédiée à un espace ou un événement précis (petit effectif).",
  ],
  [
    "1396273675933716510",
    "Rôle de modération vocale ciblée : mettre en sourdine, rendre muet et exclure temporairement, sans les autres pouvoirs de modération.",
  ],
  [
    "1138538436110852106",
    "Rôle de sourdine appliqué par la modération — sa portée réelle passe par des permissions de SALON (retrait du droit d'écrire), invisibles depuis les permissions globales lues ici.",
  ],
  [
    "1162364807450726460",
    "Second rôle de sourdine (même fonction que « Muted »), sans permission globale propre — la coexistence des deux suggère une transition d'outil de modération non nettoyée.",
  ],
]);

// ─── Accès : statut qui ouvre une porte, sans pouvoir de gestion ───────────
const ACCES: ReadonlyMap<string, string> = new Map([
  [
    "1306371087709507656",
    "Statut de membre de l'association Rose Griffon (loi 1901) — aucune permission Discord propre, sert vraisemblablement à ouvrir l'accès à des salons réservés via des permissions de salon.",
  ],
  [
    "1133461217768386572",
    "Rôle donnant des permissions de communication étendues (fils, pièces jointes, sons) sans aucun pouvoir de modération — fonction précise non déterminable depuis ce dépôt.",
  ],
  [
    "1073013308623429782", // Joueur Débutant
    "Rôle donné automatiquement à l'arrivée sur le serveur (identifié par apps/bot/src/scripts/import-xp-tiers.ts, exclu de ses récompenses de palier Noctaly pour cette raison) — pas un palier, un simple bienvenue.",
  ],
]);

// ─── Classification ──────────────────────────────────────────────────────────

function phraseIntegration(faits: FaitsRole): ClassificationRole {
  if (faits.tagBotId) {
    return {
      categorie: "bot",
      utilite: `Rôle posé automatiquement par Discord à l'installation d'un bot (application ${faits.tagBotId}) — non attribuable à la main, disparaît si le bot quitte le serveur. ${faits.porteurs} porteur(s).`,
    };
  }
  return {
    categorie: "abonnement",
    utilite: `Rôle géré automatiquement par une intégration payante native de Discord (boost Nitro ou abonnement de rôle) — Discord l'attribue et le retire seul selon le paiement. ${faits.porteurs} porteur(s).`,
  };
}

function phraseNotification(faits: FaitsRole): ClassificationRole {
  return {
    categorie: "notification",
    utilite: `Étiquette de centre d'intérêt sans permission serveur propre : sert vraisemblablement de cible de mention ciblée par le staff plutôt que de statut. ${faits.porteurs} porteur(s).`,
  };
}

function phraseCosmetique(faits: FaitsRole, permissions: readonly string[]): ClassificationRole {
  const detail =
    permissions.length > 0
      ? ` Porte exceptionnellement une permission réelle (${permissions.join(", ")}) malgré son usage décoratif.`
      : "";
  return {
    categorie: "cosmetique",
    utilite: `Badge/titre de reconnaissance, décerné individuellement, sans fonction de notification collective.${detail} ${faits.porteurs} porteur(s).`,
  };
}

/**
 * Classifie un rôle à partir de ses seuls FAITS observables.
 *
 * Un rôle absent de tous les ensembles ci-dessus (guilde non encore analysée,
 * ou nouveau rôle créé après le 14/8/2026) rend `{ categorie: null, utilite:
 * null }` — jamais une catégorie devinée. C'est `sync-roles-catalogue.ts` qui
 * décide quoi faire de ce cas (relancer une analyse humaine), pas ce module.
 */
export function classifierRole(faits: FaitsRole): ClassificationRole {
  if (faits.nom === "@everyone") {
    const permissions = decoderPermissions(faits.permissions);
    return {
      categorie: "base",
      utilite: `Rôle socle de la guilde : ses ${permissions.length} permissions s'appliquent à quiconque n'a aucun autre rôle actif (ou en complément de ses autres rôles).`,
    };
  }

  if (faits.gereParIntegration) {
    return phraseIntegration(faits);
  }

  const tierPatreon = TIERS_PATREON.get(faits.roleId);
  if (tierPatreon) {
    return {
      categorie: "abonnement",
      utilite: `Récompense du palier payant Patreon/Stripe « ${tierPatreon.nom} » (${tierPatreon.euros.toFixed(2)} €/mois, cf. TIER_MAPPING du site) — attribué par le webhook Patreon, pas par une intégration Discord native. ${faits.porteurs} porteur(s).`,
    };
  }

  const palierActivite = PALIERS_ACTIVITE.get(faits.roleId);
  if (palierActivite) {
    return { categorie: "niveau", utilite: `${palierActivite} ${faits.porteurs} porteur(s).` };
  }

  if (COSMETIQUES.has(faits.roleId)) {
    return phraseCosmetique(faits, decoderPermissions(faits.permissions));
  }

  if (NOTIFICATIONS.has(faits.roleId)) {
    return phraseNotification(faits);
  }

  const staff = STAFF.get(faits.roleId);
  if (staff) {
    return { categorie: "staff", utilite: `${staff} ${faits.porteurs} porteur(s).` };
  }

  const moderation = MODERATION.get(faits.roleId);
  if (moderation) {
    return { categorie: "moderation", utilite: `${moderation} ${faits.porteurs} porteur(s).` };
  }

  const acces = ACCES.get(faits.roleId);
  if (acces) {
    return { categorie: "acces", utilite: `${acces} ${faits.porteurs} porteur(s).` };
  }

  return { categorie: null, utilite: null };
}
