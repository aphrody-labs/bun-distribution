/**
 * Socle PUR des commandes qui exercent les pouvoirs Discord du bot.
 *
 * Le bot porte la permission « Administrateur » sur le serveur Rose Griffon :
 * il peut bannir, expulser, exclure temporairement, créer et distribuer des
 * rôles, ouvrir, verrouiller et purger des salons. C'est un pouvoir réel, et
 * trois choses le rendent dangereux si on l'appelle naïvement :
 *
 *   1. **La hiérarchie prime sur la permission.** Être administrateur ne permet
 *      PAS d'agir sur quelqu'un dont le rôle le plus haut est au-dessus (ou à
 *      égalité) de celui du bot, ni sur le propriétaire du serveur. Discord
 *      répond alors `50013 Missing Permissions` — un message que le membre lit
 *      comme « le bot est cassé » alors que c'est un refus normal.
 *   2. **Les bornes ne sont pas négociables.** Une exclusion dépasse rarement
 *      28 jours par accident : c'est le plafond de l'API. Une suppression de
 *      masse ne touche pas un message de plus de 14 jours. Un mode lent va de 0
 *      à 6 heures. Ces bornes se vérifient AVANT l'appel, pas dans un `catch`.
 *   3. **Une action de modération sans motif est une action sans trace.** Le
 *      journal d'audit Discord accepte 512 caractères ; on y écrit toujours QUI
 *      a demandé l'action depuis Discord, en plus de la trace en base.
 *
 * Tout ce qui DÉCIDE vit donc ici, sans `interaction`, sans base, sans réseau,
 * et se teste dans `discord-admin.test.ts`. Les fichiers de commande n'ont plus
 * qu'à appeler et à mettre en forme.
 */

import {
  AuditLogEvent,
  ChannelType,
  GuildPremiumTier,
  GuildVerificationLevel,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type PermissionsBitField,
} from "discord.js";

// La charte vit dans `@rosegriffon/ui/tokens`, projection TypeScript PURE de
// `packages/ui/src/styles.css` (aucun import, aucune API Node). La réutiliser
// ici plutôt que d'écrire des hexadécimaux en dur garantit qu'un rôle créé
// depuis Discord porte EXACTEMENT la couleur du site, et qu'un changement de
// charte ne laisse pas le bot en retard.
import { MARQUE, MARQUES_TIERCES } from "@rosegriffon/ui/tokens";

// ─── Bornes de l'API Discord ────────────────────────────────────────────────

/** Exclusion temporaire (`timeout`) : 28 jours, plafond dur de l'API. */
export const MAX_EXCLUSION_MS = 28 * 24 * 60 * 60 * 1000;

/** Suppression de masse : Discord refuse tout message de plus de 14 jours. */
export const AGE_MAX_SUPPRESSION_MASSE_MS = 14 * 24 * 60 * 60 * 1000;

/** `bulkDelete` accepte de 2 à 100 messages par appel. */
export const MAX_SUPPRESSION_MASSE = 100;

/** Mode lent d'un salon : de 0 à 6 heures, en secondes. */
export const MAX_LENTEUR_SECONDES = 21_600;

/** Longueur maximale d'un motif de journal d'audit. */
export const LIMITE_MOTIF_AUDIT = 512;

/** Longueur maximale d'un nom de salon ou de rôle. */
export const LIMITE_NOM = 100;

/** Nombre de jours de messages qu'un bannissement peut effacer (0 à 7). */
export const MAX_JOURS_PURGE_BANNISSEMENT = 7;

// ─── Durées ─────────────────────────────────────────────────────────────────

const UNITES_DUREE: Readonly<Record<string, number>> = Object.freeze({
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  d: 86_400_000,
});

/**
 * Lit une durée écrite à la main : `10m`, `2h`, `1h30m`, `7j`, `45 min`.
 *
 * Rend `null` sur tout le reste plutôt qu'une valeur par défaut : exclure
 * quelqu'un « 10 minutes » et l'exclure « pour toujours » ne se distinguent que
 * par ce qui a été tapé, et une saisie mal comprise doit être refusée, pas
 * devinée. Rend `null` aussi au-delà de `MAX_EXCLUSION_MS`, que l'API refuse.
 */
export function analyserDuree(saisie: unknown): number | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const propre = saisie.trim().toLowerCase().replaceAll(" ", "");
  if (propre.length === 0) {
    return null;
  }
  // Une saisie doit être ENTIÈREMENT consommée : `10mois` ne doit pas être lu
  // comme « 10 minutes » en ignorant la fin.
  const motif = /(\d+)(sec|min|[smhjd])/g;
  let total = 0;
  let consomme = 0;
  for (const trouve of propre.matchAll(motif)) {
    const [entier, nombre, unite] = trouve;
    consomme += entier.length;
    const facteur = UNITES_DUREE[unite ?? ""];
    if (facteur === undefined || nombre === undefined) {
      return null;
    }
    total += Number(nombre) * facteur;
  }
  if (consomme !== propre.length || total <= 0) {
    return null;
  }
  return total > MAX_EXCLUSION_MS ? null : total;
}

/** Écrit une durée en français, sans unité vide : `1 h 30 min`, `7 j`. */
export function dureeLisible(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  const morceaux: string[] = [];
  let reste = Math.floor(ms / 1000);
  const jours = Math.floor(reste / 86_400);
  reste -= jours * 86_400;
  const heures = Math.floor(reste / 3600);
  reste -= heures * 3600;
  const minutes = Math.floor(reste / 60);
  const secondes = reste - minutes * 60;
  if (jours > 0) morceaux.push(`${jours} j`);
  if (heures > 0) morceaux.push(`${heures} h`);
  if (minutes > 0) morceaux.push(`${minutes} min`);
  if (secondes > 0) morceaux.push(`${secondes} s`);
  return morceaux.join(" ");
}

// ─── Motif d'audit ──────────────────────────────────────────────────────────

/**
 * Compose le motif envoyé au journal d'audit Discord.
 *
 * On y met TOUJOURS l'auteur humain : sans lui, le journal du serveur n'affiche
 * que « Rose Griffon » pour toutes les sanctions, et plus personne ne sait qui a
 * demandé quoi. Le résultat est borné à 512 caractères, limite de l'en-tête.
 */
export function motifAudit(opts: { auteur: string; motif?: string | null }): string {
  const motif = opts.motif?.trim();
  const base = motif && motif.length > 0 ? `${motif} — demandé par ${opts.auteur}` : `Demandé par ${opts.auteur}`;
  return base.length > LIMITE_MOTIF_AUDIT ? `${base.slice(0, LIMITE_MOTIF_AUDIT - 1)}…` : base;
}

// ─── Hiérarchie ─────────────────────────────────────────────────────────────

/** Ce qui empêche une action de modération d'aboutir, avant même de l'essayer. */
export type EmpechementHierarchie = "soi-meme" | "le-bot" | "proprietaire" | "role-superieur" | "role-egal";

export interface ContexteHierarchie {
  /** Position du rôle le plus haut du bot. */
  positionBot: number;
  /** Position du rôle le plus haut de la cible. */
  positionCible: number;
  /** La cible est-elle le propriétaire du serveur ? */
  cibleProprietaire: boolean;
  /** La cible est-elle la personne qui lance la commande ? */
  cibleEstAuteur: boolean;
  /** La cible est-elle le bot lui-même ? */
  cibleEstBot: boolean;
}

/**
 * Dit si le bot peut agir sur cette cible, AVANT d'appeler l'API.
 *
 * Discord applique ces règles sans les expliquer : la réponse est un `50013`
 * indifférencié. On les rejoue donc ici pour pouvoir dire au staff CE QUI
 * bloque — un rôle trop haut ne se répare pas de la même façon qu'une tentative
 * de bannir le propriétaire du serveur.
 */
export function empechementHierarchie(contexte: ContexteHierarchie): EmpechementHierarchie | null {
  if (contexte.cibleEstAuteur) {
    return "soi-meme";
  }
  if (contexte.cibleEstBot) {
    return "le-bot";
  }
  if (contexte.cibleProprietaire) {
    return "proprietaire";
  }
  if (contexte.positionCible > contexte.positionBot) {
    return "role-superieur";
  }
  if (contexte.positionCible === contexte.positionBot) {
    return "role-egal";
  }
  return null;
}

/** Phrase expliquant un empêchement, telle qu'elle s'affiche dans un salon. */
export function expliquerEmpechement(empechement: EmpechementHierarchie): string {
  switch (empechement) {
    case "soi-meme":
      return "Tu ne peux pas appliquer cette action sur toi-même.";
    case "le-bot":
      return "Le bot ne peut pas s'appliquer cette action à lui-même.";
    case "proprietaire":
      return "Le propriétaire du serveur est hors de portée de toute modération, même pour un administrateur.";
    case "role-superieur":
      return "Le rôle le plus haut de ce membre est au-dessus de celui du bot : Discord refuse l'action. Remonte le rôle du bot au-dessus dans les paramètres du serveur.";
    case "role-egal":
      return "Ce membre a un rôle de même niveau que le bot : Discord exige un rôle STRICTEMENT plus haut. Remonte le rôle du bot d'un cran.";
  }
}

// ─── Permissions ────────────────────────────────────────────────────────────

/** Les permissions Discord dont chaque famille d'actions a besoin. */
export const PERMISSIONS_PAR_ACTION = Object.freeze({
  bannir: [PermissionFlagsBits.BanMembers],
  expulser: [PermissionFlagsBits.KickMembers],
  exclure: [PermissionFlagsBits.ModerateMembers],
  role: [PermissionFlagsBits.ManageRoles],
  salon: [PermissionFlagsBits.ManageChannels],
  purger: [PermissionFlagsBits.ManageMessages],
  pseudo: [PermissionFlagsBits.ManageNicknames],
  invitation: [PermissionFlagsBits.CreateInstantInvite],
  emoji: [PermissionFlagsBits.ManageGuildExpressions],
  journal: [PermissionFlagsBits.ViewAuditLog],
}) satisfies Record<string, readonly bigint[]>;

export type ActionDiscord = keyof typeof PERMISSIONS_PAR_ACTION;

/** Nom lisible d'un drapeau de permission, pour le dire au staff en clair. */
const NOMS_PERMISSIONS = new Map<bigint, string>([
  [PermissionFlagsBits.BanMembers, "Bannir des membres"],
  [PermissionFlagsBits.KickMembers, "Expulser des membres"],
  [PermissionFlagsBits.ModerateMembers, "Exclure temporairement des membres"],
  [PermissionFlagsBits.ManageRoles, "Gérer les rôles"],
  [PermissionFlagsBits.ManageChannels, "Gérer les salons"],
  [PermissionFlagsBits.ManageMessages, "Gérer les messages"],
  [PermissionFlagsBits.ManageNicknames, "Gérer les pseudos"],
  [PermissionFlagsBits.CreateInstantInvite, "Créer une invitation"],
  [PermissionFlagsBits.ManageGuildExpressions, "Gérer les émojis et autocollants"],
  [PermissionFlagsBits.ViewAuditLog, "Voir le journal d'audit"],
  [PermissionFlagsBits.Administrator, "Administrateur"],
]);

export function nomPermission(drapeau: bigint): string {
  return NOMS_PERMISSIONS.get(drapeau) ?? `Permission ${drapeau}`;
}

/**
 * Permissions manquantes pour une action, en clair.
 *
 * `Administrator` couvre tout : le tester d'abord évite d'annoncer « il manque
 * Bannir des membres » à un bot qui est administrateur du serveur.
 */
export function permissionsManquantes(possedees: PermissionsBitField | bigint, action: ActionDiscord): string[] {
  const bits = typeof possedees === "bigint" ? possedees : possedees.bitfield;
  if ((bits & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    return [];
  }
  return PERMISSIONS_PAR_ACTION[action].filter(requise => (bits & requise) !== requise).map(nomPermission);
}

// ─── Bornes de saisie ───────────────────────────────────────────────────────

/**
 * Normalise un nom de salon textuel comme Discord le fait lui-même.
 *
 * Sans cette étape, « Salon des Annonces » revient de l'API en
 * `salon-des-annonces` et l'accusé de réception affiche autre chose que la
 * réalité — le staff croit alors à un bug de nommage.
 */
export function normaliserNomSalon(saisie: string): string {
  return saisie
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .replaceAll(/[^a-z0-9-_]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITE_NOM);
}

/** Ramène un mode lent dans les bornes de l'API, ou `null` si la saisie est hors jeu. */
export function normaliserLenteur(secondes: unknown): number | null {
  if (typeof secondes !== "number" || !Number.isFinite(secondes)) {
    return null;
  }
  const entier = Math.trunc(secondes);
  if (entier < 0 || entier > MAX_LENTEUR_SECONDES) {
    return null;
  }
  return entier;
}

/** Ramène un nombre de jours de purge de bannissement dans les bornes (0 à 7). */
export function normaliserJoursPurge(jours: unknown): number | null {
  if (typeof jours !== "number" || !Number.isFinite(jours)) {
    return null;
  }
  const entier = Math.trunc(jours);
  if (entier < 0 || entier > MAX_JOURS_PURGE_BANNISSEMENT) {
    return null;
  }
  return entier;
}

/**
 * Combien de messages une suppression de masse peut réellement toucher.
 *
 * `bulkDelete` exige entre 2 et 100 messages ET refuse tout ce qui dépasse 14
 * jours : demander « 100 » dans un salon calme supprime souvent moins. On le
 * calcule ici pour l'annoncer avant, plutôt que de laisser croire à une purge
 * complète.
 */
export function partitionnerSuppression(
  horodatages: readonly number[],
  maintenant: number,
  demande: number,
): { supprimables: number; tropAnciens: number; plafonne: boolean } {
  const limite = Math.min(Math.max(Math.trunc(demande), 0), MAX_SUPPRESSION_MASSE);
  const candidats = horodatages.slice(0, limite);
  let supprimables = 0;
  let tropAnciens = 0;
  for (const horodatage of candidats) {
    if (maintenant - horodatage < AGE_MAX_SUPPRESSION_MASSE_MS) {
      supprimables += 1;
    } else {
      tropAnciens += 1;
    }
  }
  return { supprimables, tropAnciens, plafonne: demande > MAX_SUPPRESSION_MASSE };
}

// ─── Rôles : la palette de la charte ────────────────────────────────────────

/** Une couleur proposée à la création d'un rôle. */
export interface CouleurRole {
  /** Libellé montré dans la liste de choix Discord. */
  readonly nom: string;
  /** Valeur transmise par l'option — stable, c'est elle qui est stockée en audit. */
  readonly valeur: string;
  /** Écriture hexadécimale, vide quand le rôle n'a pas de couleur propre. */
  readonly hex: string;
  /** Ce que l'API attend réellement : un entier sRGB. `0` = aucune couleur. */
  readonly entier: number;
}

/** Valeur qui signifie « laisse le rôle sans couleur propre ». */
export const COULEUR_ROLE_AUCUNE = "aucune";

/** `#a14b3f` → `10570047`. L'API des rôles ne lit pas l'hexadécimal en texte. */
function entierCouleur(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function couleurCharte(nom: string, valeur: string, hex: string): CouleurRole {
  return { nom: `${nom} (${hex})`, valeur, hex, entier: entierCouleur(hex) };
}

/**
 * Les couleurs qu'un rôle Rose Griffon a le droit de porter.
 *
 * ── POURQUOI UNE LISTE FERMÉE ──────────────────────────────────────────────
 * Un champ libre `#RRGGBB` invite à inventer une teinte à chaque création : au
 * bout de dix rôles, la liste des membres ne ressemble plus à rien et aucune
 * couleur ne correspond au site. Les valeurs viennent donc de la charte
 * (`MARQUE`) et des trois marques tierces que nous n'avons pas le droit de
 * changer (`MARQUES_TIERCES`). Quatorze entrées : Discord plafonne une liste de
 * choix à 25, on reste largement dessous.
 */
export const COULEURS_ROLE: readonly CouleurRole[] = Object.freeze([
  couleurCharte("Marine", "marine", MARQUE.marine),
  couleurCharte("Marine clair", "marine-clair", MARQUE.marineClair),
  couleurCharte("Rose Griffon", "rose", MARQUE.rose),
  couleurCharte("Or griffon", "griffon", MARQUE.griffon),
  couleurCharte("Brique", "brique", MARQUE.brique),
  couleurCharte("Brique clair", "brique-clair", MARQUE.briqueClair),
  couleurCharte("Blanc cassé", "blanc-casse", MARQUE.surMarine),
  couleurCharte("Vert (succès)", "succes", MARQUE.succes),
  couleurCharte("Bleu (information)", "info", MARQUE.info),
  couleurCharte("Ambre (alerte)", "alerte", MARQUE.alerte),
  couleurCharte("Blurple Discord", "discord", MARQUES_TIERCES.discord),
  couleurCharte("Rouge Patreon", "patreon", MARQUES_TIERCES.patreon),
  couleurCharte("Violet Twitch", "twitch", MARQUES_TIERCES.twitch),
  { nom: "Aucune couleur (grise, héritée)", valeur: COULEUR_ROLE_AUCUNE, hex: "", entier: 0 },
]);

/** Choix Discord dérivés de la palette — jamais réécrits à la main. */
export const CHOIX_COULEUR_ROLE = COULEURS_ROLE.map(couleur => ({
  name: couleur.nom,
  value: couleur.valeur,
}));

/**
 * Retrouve une couleur de la charte. `null` sur tout le reste.
 *
 * Une saisie absente vaut « aucune couleur » : c'est le comportement par défaut
 * de Discord quand on crée un rôle depuis l'interface, et il vaut mieux qu'un
 * oubli d'option produise le rôle attendu qu'un rôle rose vif.
 */
export function resoudreCouleurRole(saisie: unknown): CouleurRole | null {
  if (saisie === undefined || saisie === null) {
    return COULEURS_ROLE.at(-1) ?? null;
  }
  if (typeof saisie !== "string") {
    return null;
  }
  const cible = saisie.trim().toLowerCase();
  return COULEURS_ROLE.find(couleur => couleur.valeur === cible) ?? null;
}

/**
 * Normalise le nom d'un rôle.
 *
 * Contrairement à un salon, Discord ne retouche PAS un nom de rôle : les
 * majuscules, les accents et les espaces y survivent tels quels. On se contente
 * donc de ce qui casse vraiment — les espaces de bord, les suites d'espaces et
 * les retours à la ligne (un nom sur deux lignes s'affiche tronqué dans la
 * liste des membres) — puis on borne à 100 caractères, plafond de l'API.
 *
 * `@everyone` et `@here` sont refusés : ce sont les deux mentions générales du
 * serveur, et un rôle qui porte ce nom rend illisible toute discussion sur les
 * permissions (« j'ai retiré @everyone » ne veut alors plus rien dire).
 */
export function normaliserNomRole(saisie: unknown): string | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const propre = saisie.replaceAll(/\s+/g, " ").trim();
  if (propre.length === 0 || propre.length > LIMITE_NOM) {
    return null;
  }
  const minuscule = propre.toLowerCase();
  if (minuscule === "@everyone" || minuscule === "@here") {
    return null;
  }
  return propre;
}

// ─── Rôles : ce qui interdit d'y toucher ────────────────────────────────────

/** Ce qui met un rôle hors de portée du bot, avant même d'appeler l'API. */
export type EmpechementRole =
  "everyone" | "gere-par-integration" | "role-du-bot" | "administration" | "role-superieur" | "role-egal";

export interface ContexteRole {
  /** Le rôle est-il le `@everyone` du serveur ? */
  readonly estEveryone: boolean;
  /** `role.managed` : rôle posé par un bot, un boost ou un abonnement. */
  readonly gereParIntegration: boolean;
  /** Le rôle est-il celui que porte notre propre bot ? */
  readonly estRoleDuBot: boolean;
  /** Le rôle porte-t-il la permission « Administrateur » ? */
  readonly porteAdministration: boolean;
  /** Position du rôle visé. */
  readonly positionRole: number;
  /** Position du rôle le plus haut du bot. */
  readonly positionBot: number;
}

/**
 * Dit si le bot peut distribuer, modifier ou supprimer ce rôle.
 *
 * ── LA HIÉRARCHIE MORD PLUS FORT ICI QU'AILLEURS ───────────────────────────
 * Pour bannir, Discord compare le bot au MEMBRE. Pour un rôle, il compare le
 * bot au RÔLE : donner un rôle situé au-dessus du sien est refusé même si la
 * personne visée est le dernier arrivé du serveur. C'est la confusion la plus
 * fréquente, et elle produit un `50013` que personne ne sait lire. On rejoue
 * donc la règle avec la même fonction que la modération des membres, sur la
 * position du rôle.
 *
 * Trois interdits s'y ajoutent, dans cet ordre :
 *   1. `@everyone` — ce n'est pas un rôle qu'on attribue, c'est le socle de
 *      permissions du serveur ; l'API refuse de l'ajouter à qui que ce soit ;
 *   2. un rôle `managed` — posé par une intégration (bot, boost Nitro,
 *      abonnement) ; Discord interdit de l'attribuer, de le renommer et de le
 *      supprimer, et l'échec arrive APRÈS l'appel si on ne filtre pas avant ;
 *   3. un rôle porteur d'« Administrateur » — le distribuer depuis un salon
 *      ferait du bot un chemin d'escalade de privilèges vers le serveur entier.
 * Le rôle du bot lui-même est traité à part pour pouvoir le DIRE : c'est en
 * général un rôle `managed`, mais le message « le bot ne se scie pas la branche
 * sur laquelle il est assis » est plus utile que « rôle d'intégration ».
 */
export function empechementRole(contexte: ContexteRole): EmpechementRole | null {
  if (contexte.estEveryone) {
    return "everyone";
  }
  if (contexte.estRoleDuBot) {
    return "role-du-bot";
  }
  if (contexte.gereParIntegration) {
    return "gere-par-integration";
  }
  if (contexte.porteAdministration) {
    return "administration";
  }
  const rang = empechementHierarchie({
    positionBot: contexte.positionBot,
    positionCible: contexte.positionRole,
    cibleProprietaire: false,
    cibleEstAuteur: false,
    cibleEstBot: false,
  });
  return rang === "role-superieur" || rang === "role-egal" ? rang : null;
}

/** Phrase expliquant pourquoi ce rôle est hors de portée. */
export function expliquerEmpechementRole(empechement: EmpechementRole): string {
  switch (empechement) {
    case "everyone":
      return "`@everyone` n'est pas un rôle que l'on distribue : c'est le socle de permissions du serveur, et l'API refuse de l'ajouter ou de le retirer à qui que ce soit.";
    case "role-du-bot":
      return "C'est le rôle du bot lui-même. Y toucher revient à lui retirer les pouvoirs qui lui permettent d'agir, et plus rien ne serait réparable depuis Discord.";
    case "gere-par-integration":
      return "Ce rôle est géré par une intégration (bot, boost Nitro, abonnement) : Discord interdit de l'attribuer, de le renommer et de le supprimer. Il se règle chez l'intégration qui le pose.";
    case "administration":
      return "Ce rôle porte la permission « Administrateur ». Le distribuer depuis un salon ferait du bot un chemin d'escalade de privilèges vers le serveur entier : il se donne à la main, dans les paramètres du serveur.";
    case "role-superieur":
      return "Ce rôle est AU-DESSUS du rôle du bot : Discord refuse l'action, même à un administrateur. Remonte le rôle du bot au-dessus dans les paramètres du serveur.";
    case "role-egal":
      return "Ce rôle est au MÊME niveau que celui du bot : Discord exige un rang STRICTEMENT plus haut. Remonte le rôle du bot d'un cran.";
  }
}

// ─── Rôles : distribution en masse ──────────────────────────────────────────

/**
 * Plafond de membres traités par une seule distribution en masse.
 *
 * Le serveur compte ~1 984 membres : sans plafond, une seule commande lancerait
 * près de deux mille écritures. Au-delà de 500, la bonne réponse n'est pas
 * d'attendre vingt minutes dans une interaction Discord — c'est de découper.
 */
export const MAX_MEMBRES_MASSE = 500;

/** Nombre d'attributions envoyées avant de rendre la main à l'API. */
export const TAILLE_LOT_MASSE = 5;

/** Pause entre deux lots, en millisecondes. */
export const PAUSE_LOT_MASSE_MS = 1_500;

export interface PlanMasse {
  /** Membres réellement traités. */
  readonly aTraiter: number;
  /** Membres laissés de côté par le plafond. */
  readonly ignores: number;
  /** Nombre de lots envoyés. */
  readonly lots: number;
  /** Pause observée entre deux lots. */
  readonly pauseMs: number;
  /** Durée minimale de l'opération : la somme des seules pauses. */
  readonly dureeMinimaleMs: number;
  /** Vrai si le plafond a mordu. */
  readonly plafonne: boolean;
}

/**
 * Compose la cadence d'une distribution en masse.
 *
 * ── POURQUOI PAS UNE RAFALE ────────────────────────────────────────────────
 * `Promise.all` sur 500 attributions envoie 500 requêtes d'un coup. Discord
 * répond alors `429`, et un dépassement répété du seuil global fait bannir le
 * JETON pendant plusieurs minutes — c'est-à-dire le bot entier, pas seulement la
 * commande. Cinq requêtes puis une pace d'une seconde et demie tiennent environ
 * 3,3 requêtes par seconde, très en dessous des seuils, et rendent l'opération
 * prévisible : on peut annoncer sa durée AVANT de la lancer.
 *
 * `dureeMinimaleMs` ne compte que les pauses : le temps de réponse de l'API
 * s'ajoute. C'est un plancher honnête, pas une estimation optimiste.
 */
export function planifierMasse(nombre: number): PlanMasse {
  const demande = Number.isFinite(nombre) ? Math.max(Math.trunc(nombre), 0) : 0;
  const aTraiter = Math.min(demande, MAX_MEMBRES_MASSE);
  const lots = Math.ceil(aTraiter / TAILLE_LOT_MASSE);
  return {
    aTraiter,
    ignores: demande - aTraiter,
    lots,
    pauseMs: PAUSE_LOT_MASSE_MS,
    dureeMinimaleMs: Math.max(lots - 1, 0) * PAUSE_LOT_MASSE_MS,
    plafonne: demande > MAX_MEMBRES_MASSE,
  };
}

/** Le strict nécessaire pour décider si un membre est concerné. */
export interface MembrePourRole {
  readonly id: string;
  /** Identifiants des rôles que le membre porte DÉJÀ. */
  readonly roles: readonly string[];
}

/**
 * Sépare les membres à traiter de ceux pour qui l'appel serait un coup dans
 * l'eau.
 *
 * Donner un rôle à quelqu'un qui l'a déjà réussit côté API sans rien changer :
 * l'appel est donc invisible, mais il consomme une requête et une ligne de
 * journal d'audit. Sur 500 membres dont 480 sont déjà pourvus, filtrer avant
 * transforme dix minutes de distribution en vingt secondes — et le compte rendu
 * dit enfin la vérité sur ce qui a changé.
 */
export function trierMembresPourRole(
  membres: readonly MembrePourRole[],
  role: string,
  sens: "donner" | "retirer",
): { aTraiter: string[]; sansChangement: string[] } {
  const aTraiter: string[] = [];
  const sansChangement: string[] = [];
  for (const membre of membres) {
    const possede = membre.roles.includes(role);
    if (sens === "donner" ? possede : !possede) {
      sansChangement.push(membre.id);
    } else {
      aTraiter.push(membre.id);
    }
  }
  return { aTraiter, sansChangement };
}

export interface BilanMasse {
  readonly reussis: number;
  readonly echecs: number;
  readonly sansChangement: number;
  readonly ignores: number;
  readonly dureeMs: number;
}

/**
 * Compte rendu d'une distribution en masse.
 *
 * Les quatre nombres sont toujours écrits, même à zéro : une ligne « 0 échec »
 * est une information, son absence laisse croire qu'on a oublié de compter.
 */
export function resumerMasse(bilan: BilanMasse): string {
  const lignes = [
    `Attribué : **${bilan.reussis}**`,
    `Échecs : **${bilan.echecs}**`,
    `Déjà pourvus (aucun appel) : **${bilan.sansChangement}**`,
    `Durée : **${dureeLisible(bilan.dureeMs)}**`,
  ];
  if (bilan.ignores > 0) {
    lignes.push(
      `⚠ **${bilan.ignores}** membre(s) laissés de côté par le plafond de ${MAX_MEMBRES_MASSE} : relance la commande pour les traiter.`,
    );
  }
  return lignes.join("\n");
}

/**
 * Extrait l'identifiant d'un rôle d'une saisie libre.
 *
 * L'option `role` de `/administration role` est de type TEXTE et non `Role` :
 * Discord n'autorise l'autocomplétion que sur du texte, et c'est elle qui permet
 * d'écarter AVANT l'appel les rôles hors de portée (gérés par une intégration,
 * au-dessus du bot). Conséquence : la valeur reçue est ce que l'autocomplétion a
 * posé — un flocon — mais peut aussi être une mention collée à la main
 * (`<@&123…>`) ou l'identifiant brut copié depuis le menu contextuel.
 *
 * Rend `null` sur tout le reste, y compris sur un nom de rôle : deux rôles
 * peuvent porter le même nom, et agir sur « celui qu'on a trouvé en premier »
 * n'est pas acceptable quand l'action supprime.
 */
export function extraireIdentifiantRole(saisie: unknown): string | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const propre = saisie.trim();
  const mention = /^<@&(\d{17,20})>$/.exec(propre);
  if (mention?.[1]) {
    return mention[1];
  }
  return /^\d{17,20}$/.test(propre) ? propre : null;
}

// ════════════════════════════════════════════════════════════════════════════
// INSPECTION — ce qui sert à LIRE l'état du serveur (`/staff discord`)
//
// Rien ici ne modifie quoi que ce soit : ce sont les traductions et les bornes
// dont a besoin la consultation. Elles vivent dans le même socle que les gardes
// de modération parce qu'elles répondent à la MÊME question sous un autre
// angle — « qu'est-ce que le bot peut faire, et sur qui » — et qu'un diagnostic
// qui ne partagerait pas `PERMISSIONS_PAR_ACTION` avec les commandes qu'il
// diagnostique finirait par mentir sur ce qu'elles exigent.
// ════════════════════════════════════════════════════════════════════════════

// ─── Noms français de TOUTES les permissions ────────────────────────────────

/**
 * Les permissions que `NOMS_PERMISSIONS` ne couvre pas.
 *
 * `nomPermission` ne connaît que les dix drapeaux exercés par les commandes de
 * modération : demandé pour `ManageGuild`, il rend « Permission 32 », ce qui
 * n'aide personne à cliquer au bon endroit dans les paramètres du serveur. On
 * complète ici SANS recopier les dix premiers — deux tables des mêmes noms
 * divergeraient à la première correction de libellé.
 */
const NOMS_PERMISSIONS_SUPPLEMENTAIRES: ReadonlyMap<bigint, string> = new Map([
  [PermissionFlagsBits.ManageGuild, "Gérer le serveur"],
  [PermissionFlagsBits.ManageWebhooks, "Gérer les webhooks"],
  [PermissionFlagsBits.ManageEvents, "Gérer les événements"],
  [PermissionFlagsBits.ManageThreads, "Gérer les fils"],
  [PermissionFlagsBits.MentionEveryone, "Mentionner @everyone, @here et tous les rôles"],
  [PermissionFlagsBits.ViewChannel, "Voir les salons"],
  [PermissionFlagsBits.SendMessages, "Envoyer des messages"],
  [PermissionFlagsBits.EmbedLinks, "Intégrer des liens"],
  [PermissionFlagsBits.AttachFiles, "Joindre des fichiers"],
  [PermissionFlagsBits.ReadMessageHistory, "Lire l'historique des messages"],
  [PermissionFlagsBits.AddReactions, "Ajouter des réactions"],
  [PermissionFlagsBits.UseExternalEmojis, "Utiliser des émojis externes"],
  [PermissionFlagsBits.UseApplicationCommands, "Utiliser les commandes d'application"],
  [PermissionFlagsBits.ViewGuildInsights, "Voir les statistiques du serveur"],
  [PermissionFlagsBits.MoveMembers, "Déplacer des membres en vocal"],
  [PermissionFlagsBits.MuteMembers, "Rendre muet en vocal"],
  [PermissionFlagsBits.DeafenMembers, "Mettre en sourdine en vocal"],
  [PermissionFlagsBits.PinMessages, "Épingler des messages"],
  [PermissionFlagsBits.BypassSlowmode, "Ignorer le mode lent"],
  [PermissionFlagsBits.SendPolls, "Créer des sondages"],
  [PermissionFlagsBits.CreateEvents, "Créer des événements"],
  [PermissionFlagsBits.CreateGuildExpressions, "Créer des émojis et autocollants"],
]);

/** Nom français d'un drapeau, en s'appuyant d'abord sur la table de modération. */
export function nomPermissionFr(drapeau: bigint): string {
  return NOMS_PERMISSIONS_SUPPLEMENTAIRES.get(drapeau) ?? nomPermission(drapeau);
}

/**
 * Ce qui manque parmi une liste libre de drapeaux.
 *
 * `permissionsManquantes` ne sait répondre que pour les dix actions de
 * modération. Une LECTURE peut exiger autre chose — la liste des invitations
 * réclame « Gérer le serveur », qui n'est l'action de personne — et sans cette
 * variante on ne saurait pas dire pourquoi Discord répond `50013`.
 */
export function manquantesParmi(possedees: PermissionsBitField | bigint, requises: readonly bigint[]): string[] {
  const bits = typeof possedees === "bigint" ? possedees : possedees.bitfield;
  if ((bits & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    return [];
  }
  return requises.filter(requise => (bits & requise) !== requise).map(nomPermissionFr);
}

/** Lire la liste des invitations du serveur exige « Gérer le serveur ». */
export const PERMISSIONS_LECTURE_INVITATIONS: readonly bigint[] = Object.freeze([PermissionFlagsBits.ManageGuild]);

/**
 * Les permissions qui changent ce qu'un rôle peut faire DU SERVEUR.
 *
 * Un rôle en porte souvent trente : les lister toutes noie la seule qui
 * compte. Celles-ci sont celles dont la présence sur un rôle est une décision,
 * pas un réglage de confort.
 */
export const PERMISSIONS_SENSIBLES: readonly bigint[] = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
]);

/**
 * Permissions sensibles RÉELLEMENT portées par un ensemble de droits.
 *
 * ⚠ Contrairement à `permissionsManquantes`, on n'applique PAS ici le
 * raccourci « Administrateur couvre tout » : on décrit ce qu'un rôle accorde
 * littéralement. Un rôle qui n'a que le drapeau `Administrator` doit se lire
 * « Administrateur » — prétendre qu'il porte les quinze autres ferait croire
 * qu'on peut lui en retirer une pour le brider, ce qui est faux.
 */
export function permissionsSensibles(possedees: PermissionsBitField | bigint): string[] {
  const bits = typeof possedees === "bigint" ? possedees : possedees.bitfield;
  return PERMISSIONS_SENSIBLES.filter(drapeau => (bits & drapeau) === drapeau).map(nomPermissionFr);
}

/**
 * Un rôle qui accorde ces pouvoirs se distribue-t-il sans le rôle RG `admin` ?
 *
 * ── LA FAILLE QUE CETTE RÈGLE FERME ────────────────────────────────────────
 * `requireRgAdmin` laisse passer DEUX rôles Rose Griffon : `admin` et `staff`.
 * Tout ce qui sanctionne (`/administration moderation bannir`, `expulser`,
 * `exclure`) exige, lui, `requireRgAdminStrict` — donc `admin` seul. Distribuer
 * un rôle Discord est pourtant une action réversible, et à ce titre elle
 * n'appelle que la garde ordinaire.
 *
 * Le raccourci saute aux yeux dès qu'on l'écrit : un `staff` se donne un rôle
 * portant « Bannir des membres », puis bannit depuis l'interface de Discord.
 * La garde stricte de la modération est contournée par le bas, sans jamais
 * l'avoir affrontée, et la trace en base dit « role.donner », pas « bannir ».
 * `empechementRole` ne suffit pas à couvrir ce cas : il n'écarte que le drapeau
 * « Administrateur », or aucun des quatorze autres pouvoirs sensibles n'en a
 * besoin pour faire des dégâts sur un serveur de près de deux mille personnes.
 *
 * La règle est donc : dès qu'un rôle accorde UN pouvoir sensible, sa
 * distribution demande le même rang que la sanction qu'il rend possible.
 *
 * @param possedees permissions portées par le RÔLE (pas par le bot).
 */
export function exigeRoleAdminRg(possedees: PermissionsBitField | bigint): boolean {
  return permissionsSensibles(possedees).length > 0;
}

// ─── Diagnostic action par action ───────────────────────────────────────────

/** Ce que chaque famille d'actions permet de faire, dite en clair. */
export const LIBELLES_ACTION: Readonly<Record<ActionDiscord, string>> = Object.freeze({
  bannir: "Bannir un membre",
  expulser: "Expulser un membre",
  exclure: "Exclure temporairement un membre (mise en retrait)",
  role: "Distribuer ou retirer un rôle",
  salon: "Créer, renommer, verrouiller un salon",
  purger: "Supprimer des messages en masse",
  pseudo: "Changer le pseudo d'un membre",
  invitation: "Créer une invitation",
  emoji: "Gérer les émojis et autocollants",
  journal: "Lire le journal d'audit",
});

export interface DiagnosticAction {
  readonly action: ActionDiscord;
  readonly libelle: string;
  readonly possible: boolean;
  /** Vide quand l'action est possible ; sinon, ce qu'il faut accorder au bot. */
  readonly manquantes: readonly string[];
}

/**
 * Croise les permissions réelles du bot avec ce que chaque action exige.
 *
 * C'est le diagnostic que l'on lit quand une commande de modération refuse :
 * plutôt que de deviner laquelle des dix permissions manque, on les rend
 * toutes, avec leur verdict.
 */
export function diagnostiquerActions(possedees: PermissionsBitField | bigint): DiagnosticAction[] {
  return (Object.keys(PERMISSIONS_PAR_ACTION) as ActionDiscord[]).map(action => {
    const manquantes = permissionsManquantes(possedees, action);
    return {
      action,
      libelle: LIBELLES_ACTION[action],
      possible: manquantes.length === 0,
      manquantes,
    };
  });
}

/**
 * Combien de membres sont hors de portée de toute modération.
 *
 * La comparaison est `>=` et non `>` : Discord exige un rôle STRICTEMENT plus
 * haut, donc une égalité de position est déjà un refus (`empechementHierarchie`
 * rend « role-egal »). Compter en `>` afficherait « 0 membre hors de portée »
 * sur un serveur où le staff partage le rang du bot.
 */
export function compterHorsDePortee(positionsDesMembres: Iterable<number>, positionBot: number): number {
  let total = 0;
  for (const position of positionsDesMembres) {
    if (position >= positionBot) {
      total += 1;
    }
  }
  return total;
}

// ─── Traduction des types Discord ───────────────────────────────────────────

/**
 * Types d'entrée du journal d'audit, en français.
 *
 * L'API ne rend qu'un entier (`22` = bannissement). Afficher l'entier, ou même
 * son nom anglais `MemberBanAdd`, oblige à aller chercher la table à chaque
 * lecture. La table est incomplète par construction (Discord en ajoute) : le
 * repli nomme l'entier plutôt que d'afficher un vide.
 */
export const LIBELLES_EVENEMENT_AUDIT: Readonly<Record<number, string>> = Object.freeze({
  [AuditLogEvent.GuildUpdate]: "Serveur modifié",
  [AuditLogEvent.ChannelCreate]: "Salon créé",
  [AuditLogEvent.ChannelUpdate]: "Salon modifié",
  [AuditLogEvent.ChannelDelete]: "Salon supprimé",
  [AuditLogEvent.ChannelOverwriteCreate]: "Permission de salon ajoutée",
  [AuditLogEvent.ChannelOverwriteUpdate]: "Permission de salon modifiée",
  [AuditLogEvent.ChannelOverwriteDelete]: "Permission de salon retirée",
  [AuditLogEvent.MemberKick]: "Membre expulsé",
  [AuditLogEvent.MemberPrune]: "Membres inactifs purgés",
  [AuditLogEvent.MemberBanAdd]: "Membre banni",
  [AuditLogEvent.MemberBanRemove]: "Bannissement levé",
  [AuditLogEvent.MemberUpdate]: "Membre modifié (pseudo, exclusion)",
  [AuditLogEvent.MemberRoleUpdate]: "Rôles d'un membre modifiés",
  [AuditLogEvent.MemberMove]: "Membre déplacé en vocal",
  [AuditLogEvent.MemberDisconnect]: "Membre déconnecté du vocal",
  [AuditLogEvent.BotAdd]: "Bot ajouté",
  [AuditLogEvent.RoleCreate]: "Rôle créé",
  [AuditLogEvent.RoleUpdate]: "Rôle modifié",
  [AuditLogEvent.RoleDelete]: "Rôle supprimé",
  [AuditLogEvent.InviteCreate]: "Invitation créée",
  [AuditLogEvent.InviteUpdate]: "Invitation modifiée",
  [AuditLogEvent.InviteDelete]: "Invitation supprimée",
  [AuditLogEvent.WebhookCreate]: "Webhook créé",
  [AuditLogEvent.WebhookUpdate]: "Webhook modifié",
  [AuditLogEvent.WebhookDelete]: "Webhook supprimé",
  [AuditLogEvent.EmojiCreate]: "Émoji créé",
  [AuditLogEvent.EmojiUpdate]: "Émoji modifié",
  [AuditLogEvent.EmojiDelete]: "Émoji supprimé",
  [AuditLogEvent.MessageDelete]: "Message supprimé",
  [AuditLogEvent.MessageBulkDelete]: "Messages supprimés en masse",
  [AuditLogEvent.MessagePin]: "Message épinglé",
  [AuditLogEvent.MessageUnpin]: "Message désépinglé",
  [AuditLogEvent.IntegrationCreate]: "Intégration ajoutée",
  [AuditLogEvent.IntegrationUpdate]: "Intégration modifiée",
  [AuditLogEvent.IntegrationDelete]: "Intégration retirée",
  [AuditLogEvent.StageInstanceCreate]: "Conférence ouverte",
  [AuditLogEvent.StageInstanceUpdate]: "Conférence modifiée",
  [AuditLogEvent.StageInstanceDelete]: "Conférence fermée",
  [AuditLogEvent.StickerCreate]: "Autocollant créé",
  [AuditLogEvent.StickerUpdate]: "Autocollant modifié",
  [AuditLogEvent.StickerDelete]: "Autocollant supprimé",
  [AuditLogEvent.GuildScheduledEventCreate]: "Événement créé",
  [AuditLogEvent.GuildScheduledEventUpdate]: "Événement modifié",
  [AuditLogEvent.GuildScheduledEventDelete]: "Événement supprimé",
  [AuditLogEvent.ThreadCreate]: "Fil créé",
  [AuditLogEvent.ThreadUpdate]: "Fil modifié",
  [AuditLogEvent.ThreadDelete]: "Fil supprimé",
  [AuditLogEvent.ApplicationCommandPermissionUpdate]: "Droits d'une commande modifiés",
  [AuditLogEvent.SoundboardSoundCreate]: "Son ajouté au sampler",
  [AuditLogEvent.SoundboardSoundUpdate]: "Son du sampler modifié",
  [AuditLogEvent.SoundboardSoundDelete]: "Son du sampler supprimé",
  [AuditLogEvent.AutoModerationRuleCreate]: "Règle d'automodération créée",
  [AuditLogEvent.AutoModerationRuleUpdate]: "Règle d'automodération modifiée",
  [AuditLogEvent.AutoModerationRuleDelete]: "Règle d'automodération supprimée",
  [AuditLogEvent.AutoModerationBlockMessage]: "Message bloqué par l'automodération",
  [AuditLogEvent.AutoModerationFlagToChannel]: "Message signalé par l'automodération",
  [AuditLogEvent.AutoModerationUserCommunicationDisabled]: "Membre exclu par l'automodération",
  [AuditLogEvent.AutoModerationQuarantineUser]: "Membre mis en quarantaine",
  [AuditLogEvent.CreatorMonetizationRequestCreated]: "Demande de monétisation",
  [AuditLogEvent.CreatorMonetizationTermsAccepted]: "Conditions de monétisation acceptées",
  [AuditLogEvent.OnboardingPromptCreate]: "Question d'accueil créée",
  [AuditLogEvent.OnboardingPromptUpdate]: "Question d'accueil modifiée",
  [AuditLogEvent.OnboardingPromptDelete]: "Question d'accueil supprimée",
  [AuditLogEvent.OnboardingCreate]: "Accueil configuré",
  [AuditLogEvent.OnboardingUpdate]: "Accueil modifié",
  [AuditLogEvent.HomeSettingsCreate]: "Page d'accueil créée",
  [AuditLogEvent.HomeSettingsUpdate]: "Page d'accueil modifiée",
});

export function libelleEvenementAudit(action: number): string {
  return LIBELLES_EVENEMENT_AUDIT[action] ?? `Action Discord n° ${action}`;
}

/** Types de salon, en français. Les valeurs sont celles de `ChannelType`. */
export const LIBELLES_TYPE_SALON: Readonly<Record<number, string>> = Object.freeze({
  [ChannelType.GuildText]: "Textuel",
  [ChannelType.GuildVoice]: "Vocal",
  [ChannelType.GuildCategory]: "Catégorie",
  [ChannelType.GuildAnnouncement]: "Annonces",
  [ChannelType.AnnouncementThread]: "Fil d'annonce",
  [ChannelType.PublicThread]: "Fil public",
  [ChannelType.PrivateThread]: "Fil privé",
  [ChannelType.GuildStageVoice]: "Conférence",
  [ChannelType.GuildDirectory]: "Annuaire",
  [ChannelType.GuildForum]: "Forum",
  [ChannelType.GuildMedia]: "Média",
});

export function libelleTypeSalon(type: number): string {
  return LIBELLES_TYPE_SALON[type] ?? `Type n° ${type}`;
}

/** Pictogramme d'un type de salon, pour lire une arborescence d'un coup d'œil. */
export const PICTOS_TYPE_SALON: Readonly<Record<number, string>> = Object.freeze({
  [ChannelType.GuildText]: "#",
  [ChannelType.GuildVoice]: "🔊",
  [ChannelType.GuildCategory]: "📂",
  [ChannelType.GuildAnnouncement]: "📣",
  [ChannelType.GuildStageVoice]: "🎙",
  [ChannelType.GuildForum]: "💬",
  [ChannelType.GuildMedia]: "🖼",
  [ChannelType.GuildDirectory]: "🧭",
});

export function pictoTypeSalon(type: number): string {
  return PICTOS_TYPE_SALON[type] ?? "•";
}

/** Niveau de boost, avec ce qu'il change concrètement. */
export function libelleNiveauBoost(niveau: number): string {
  switch (niveau) {
    case GuildPremiumTier.None:
      return "Aucun palier";
    case GuildPremiumTier.Tier1:
      return "Palier 1";
    case GuildPremiumTier.Tier2:
      return "Palier 2";
    case GuildPremiumTier.Tier3:
      return "Palier 3";
    default:
      return `Palier n° ${niveau}`;
  }
}

/** Niveau de vérification exigé à l'entrée. */
export function libelleNiveauVerification(niveau: number): string {
  switch (niveau) {
    case GuildVerificationLevel.None:
      return "Aucune";
    case GuildVerificationLevel.Low:
      return "Faible (e-mail vérifié)";
    case GuildVerificationLevel.Medium:
      return "Moyenne (compte de plus de 5 minutes)";
    case GuildVerificationLevel.High:
      return "Élevée (membre depuis plus de 10 minutes)";
    case GuildVerificationLevel.VeryHigh:
      return "Très élevée (téléphone vérifié)";
    default:
      return `Niveau n° ${niveau}`;
  }
}

/**
 * Fonctionnalités de serveur, en français.
 *
 * Discord les rend en `SCREAMING_SNAKE_CASE` : la liste brute d'un serveur
 * communautaire tient sur cinq lignes de majuscules illisibles. Ce qui n'est
 * pas traduit retombe sur une forme lisible plutôt que sur du vide, parce que
 * Discord en ajoute sans prévenir.
 */
export const LIBELLES_FONCTIONNALITE_GUILDE: Readonly<Record<string, string>> = Object.freeze({
  ANIMATED_BANNER: "Bannière animée",
  ANIMATED_ICON: "Icône animée",
  AUTO_MODERATION: "Automodération",
  BANNER: "Bannière",
  COMMUNITY: "Serveur communautaire",
  CREATOR_MONETIZABLE_PROVISIONAL: "Monétisation créateur (provisoire)",
  CREATOR_STORE_PAGE: "Boutique créateur",
  DEVELOPER_SUPPORT_SERVER: "Serveur de support développeur",
  DISCOVERABLE: "Visible dans la découverte",
  ENHANCED_ROLE_COLORS: "Couleurs de rôle avancées",
  FEATURABLE: "Éligible à la mise en avant",
  GUESTS_ENABLED: "Invités autorisés",
  GUILD_TAGS: "Étiquettes de serveur",
  HAS_DIRECTORY_ENTRY: "Inscrit dans un annuaire",
  HUB: "Hub étudiant",
  INVITES_DISABLED: "Invitations désactivées",
  INVITE_SPLASH: "Visuel d'invitation",
  LINKED_TO_HUB: "Rattaché à un hub",
  MEMBER_VERIFICATION_GATE_ENABLED: "Écran de règles à l'entrée",
  MONETIZATION_ENABLED: "Monétisation active",
  MORE_SOUNDBOARD: "Sampler étendu",
  MORE_STICKERS: "Autocollants supplémentaires",
  NEWS: "Salons d'annonces",
  PARTNERED: "Serveur partenaire",
  PIN_PERMISSION_MIGRATION_COMPLETE: "Permission d'épinglage migrée",
  PREVIEW_ENABLED: "Aperçu public",
  PRIVATE_THREADS: "Fils privés",
  RAID_ALERTS_DISABLED: "Alertes de raid désactivées",
  ROLE_ICONS: "Icônes de rôle",
  ROLE_SUBSCRIPTIONS_AVAILABLE_FOR_PURCHASE: "Abonnements de rôle en vente",
  ROLE_SUBSCRIPTIONS_ENABLED: "Abonnements de rôle activés",
  SOUNDBOARD: "Sampler",
  TICKETED_EVENTS_ENABLED: "Événements payants",
  VANITY_URL: "URL personnalisée",
  VERIFIED: "Serveur vérifié",
  VIP_REGIONS: "Régions vocales VIP",
  WELCOME_SCREEN_ENABLED: "Écran d'accueil",
});

export function libelleFonctionnaliteGuilde(code: string): string {
  const connu = LIBELLES_FONCTIONNALITE_GUILDE[code];
  if (connu) {
    return connu;
  }
  // Repli lisible : `NEW_THING` devient « New thing » plutôt que de disparaître.
  const mots = code.toLowerCase().replaceAll("_", " ").trim();
  return mots.length === 0 ? code : mots.charAt(0).toUpperCase() + mots.slice(1);
}

// ─── Pagination des listes d'inspection ─────────────────────────────────────

/** Entrées par page. 25 est aussi le plafond de champs d'un embed Discord. */
export const MAX_LIGNES_PAGE_INSPECTION = 25;

/** Nombre de pages nécessaires. Toujours au moins 1, même pour une liste vide. */
export function nombreDePagesInspection(total: number, parPage: number = MAX_LIGNES_PAGE_INSPECTION): number {
  if (!Number.isFinite(total) || total <= 0 || parPage <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / parPage));
}

/** Ramène un numéro de page dans les bornes plutôt que de rendre une page vide. */
export function bornerPageInspection(
  page: number,
  total: number,
  parPage: number = MAX_LIGNES_PAGE_INSPECTION,
): number {
  const pages = nombreDePagesInspection(total, parPage);
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.min(Math.max(Math.trunc(page), 1), pages);
}

/** La tranche d'éléments réellement affichée par une page bornée. */
export function trancheInspection<T>(
  elements: readonly T[],
  page: number,
  parPage: number = MAX_LIGNES_PAGE_INSPECTION,
): T[] {
  const borne = bornerPageInspection(page, elements.length, parPage);
  const debut = (borne - 1) * parPage;
  return elements.slice(debut, debut + parPage);
}

/**
 * Ce qu'on s'autorise dans la description d'un embed de liste.
 *
 * Discord plafonne une description à 4096 caractères. On s'arrête avant, parce
 * que la coupe de sécurité ci-dessous peut rendre deux caractères de plus par
 * ligne (voir `raccourcirLigneInspection`).
 */
export const BUDGET_DESCRIPTION_INSPECTION = 3_900;

/**
 * Raccourcit une ligne SANS laisser d'astérisques orphelins.
 *
 * Couper au milieu d'un `**gras**` ne tronque pas seulement le texte : Discord
 * affiche alors les astérisques restants tels quels, et toute la fin de la liste
 * part en gras. On referme donc le gras quand la coupe l'a laissé ouvert.
 */
export function raccourcirLigneInspection(ligne: string, limite: number): string {
  if (limite <= 1) {
    return "…";
  }
  if (ligne.length <= limite) {
    return ligne;
  }
  const coupe = `${ligne.slice(0, limite - 1).trimEnd()}…`;
  const gras = (coupe.match(/\*\*/g) ?? []).length;
  return gras % 2 === 0 ? coupe : `${coupe}**`;
}

/**
 * Assemble les lignes d'une page en garantissant que TOUTES y figurent.
 *
 * ── POURQUOI CE N'EST PAS DU CONFORT ───────────────────────────────────────
 * Une page vaut 25 entrées, et une entrée de rôle ou de bannissement peut
 * dépasser 200 caractères (le motif d'un bannissement, la liste des permissions
 * d'un rôle). 25 × 200 = 5 000 > 4 096 : tronquer la description entière fait
 * disparaître les dernières entrées de la page — et comme la page suivante
 * reprend à l'indice 26, elles deviennent INVISIBLES, sans que rien ne le dise.
 * On préfère raccourcir chaque ligne au prorata : chaque entrée reste listée,
 * identifiable, et donc consultable ailleurs.
 */
export function assemblerPageInspection(
  lignes: readonly string[],
  budget: number = BUDGET_DESCRIPTION_INSPECTION,
): string {
  if (lignes.length === 0) {
    return "";
  }
  const separateurs = lignes.length - 1;
  const total = lignes.reduce((somme, ligne) => somme + ligne.length, 0) + separateurs;
  if (total <= budget) {
    return lignes.join("\n");
  }
  const part = Math.max(8, Math.floor((budget - separateurs) / lignes.length));
  return lignes.map(ligne => raccourcirLigneInspection(ligne, part)).join("\n");
}

/** Préfixe des boutons de pagination de `/staff discord`. */
export const PREFIXE_PAGE_INSPECTION = "rgdisc";

/** Longueur maximale d'un `custom_id` Discord. Au-delà, l'envoi ÉCHOUE. */
const LIMITE_CUSTOM_ID_INSPECTION = 100;

export interface EtatPageInspection {
  /** Quelle liste : `bannissements` ou `invitations`. */
  readonly vue: string;
  readonly page: number;
  /** Identifiant de la personne qui a lancé la commande. */
  readonly graine: string;
}

/**
 * Sérialise l'état d'une page dans le `custom_id` du bouton.
 *
 * La graine est l'identifiant de la personne qui a demandé la liste : c'est
 * elle qui permet de refuser qu'un tiers pagine une réponse qui ne lui
 * appartient pas. Tout l'état tient dans l'identifiant, donc un redémarrage du
 * bot ne laisse jamais de bouton mort.
 *
 * Rend `null` au-delà de 100 caractères : l'appelant affiche alors la page sans
 * boutons plutôt que de voir son message ENTIER refusé par l'API.
 */
export function construireIdPageInspection(etat: EtatPageInspection): string | null {
  if (etat.vue.includes("|") || etat.graine.includes("|")) {
    return null;
  }
  const id = `${PREFIXE_PAGE_INSPECTION}|${etat.vue}|${Math.trunc(etat.page)}|${etat.graine}`;
  return id.length > LIMITE_CUSTOM_ID_INSPECTION ? null : id;
}

/** Relit un identifiant produit ci-dessus. `null` = ce bouton n'est pas à nous. */
export function analyserIdPageInspection(id: unknown): EtatPageInspection | null {
  if (typeof id !== "string") {
    return null;
  }
  const morceaux = id.split("|");
  if (morceaux.length !== 4 || morceaux[0] !== PREFIXE_PAGE_INSPECTION) {
    return null;
  }
  const [, vue, page, graine] = morceaux;
  if (!vue || !page || !graine) {
    return null;
  }
  const numero = Number(page);
  if (!Number.isInteger(numero) || numero < 1) {
    return null;
  }
  return { vue, page: numero, graine };
}

// ─── Modération : ce que l'API répond quand elle refuse ─────────────────────

/**
 * Traduit un code d'erreur de l'API Discord en phrase actionnable.
 *
 * ── POURQUOI CE N'EST PAS DU CONFORT ───────────────────────────────────────
 * Une erreur de l'API remonte sous la forme « DiscordAPIError[50013]: Missing
 * Permissions » : le membre qui la lit dans un salon en conclut que le bot est
 * cassé, alors que c'est un refus parfaitement normal — et surtout, la même
 * phrase couvre trois causes qui ne se réparent pas du tout pareil (rôle du bot
 * trop bas, permission absente, cible hors de portée). Les codes ci-dessous
 * sont les seuls que la modération peut réellement croiser, et chacun est repris
 * de l'énumération `RESTJSONErrorCodes` de `discord-api-types` — jamais d'un
 * nombre écrit de mémoire.
 *
 * Rend `null` sur un code inconnu : l'appelant affiche alors le message brut de
 * l'API plutôt qu'une traduction inventée.
 */
export function expliquerCodeDiscord(code: unknown): string | null {
  switch (code) {
    case RESTJSONErrorCodes.UnknownMember:
      return "Ce compte n'est pas (ou plus) membre du serveur.";
    case RESTJSONErrorCodes.UnknownUser:
      return "Discord ne connaît aucun compte sous cet identifiant.";
    case RESTJSONErrorCodes.UnknownBan:
      return "Aucun bannissement en cours pour ce compte sur ce serveur.";
    case RESTJSONErrorCodes.MaximumNumberOfNonGuildMemberBansHasBeenExceeded:
      return "Le serveur a atteint le nombre maximal de bannissements de comptes non-membres. Lève d'anciens bannissements avant d'en poser un nouveau.";
    case RESTJSONErrorCodes.UserBannedFromThisGuild:
      return "Ce compte est déjà banni de ce serveur.";
    case RESTJSONErrorCodes.MissingAccess:
      return "Le bot n'a pas accès à cette ressource. Vérifie qu'il voit bien le salon ou le membre visé.";
    case RESTJSONErrorCodes.CannotSendMessagesToThisUser:
    case RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds:
      return "Ce membre n'accepte pas les messages privés du serveur : la notification n'a pas pu lui être remise.";
    case RESTJSONErrorCodes.MissingPermissions:
      return "Discord a refusé l'action (permissions manquantes). C'est presque toujours la hiérarchie : le rôle du bot doit être STRICTEMENT au-dessus de celui de la cible.";
    case RESTJSONErrorCodes.InvalidFormBodyOrContentType:
      return "L'API a refusé la requête : une valeur envoyée est hors bornes.";
    default:
      return null;
  }
}

/**
 * Lit le code numérique porté par une erreur de l'API Discord.
 *
 * `DiscordAPIError` expose `code`, mais l'erreur peut aussi être un `HTTPError`
 * ou n'importe quoi d'autre : on ne suppose rien de la forme, on regarde si un
 * `code` numérique est présent. Rend `null` quand l'erreur ne vient pas de l'API.
 */
export function codeErreurDiscord(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return null;
  }
  const code = (err as { code: unknown }).code;
  return typeof code === "number" ? code : null;
}

/**
 * Vrai si l'erreur signifie « cette personne n'est pas sur le serveur ».
 *
 * Cas très fréquent en modération : on bannit justement quelqu'un qui vient de
 * partir pour échapper à la sanction. `guild.members.fetch()` échoue alors,
 * mais `guild.bans.create()` accepte parfaitement un identifiant seul. Sans
 * cette distinction, la commande renoncerait là où l'API dirait oui.
 */
export function estMembreAbsent(err: unknown): boolean {
  const code = codeErreurDiscord(err);
  return code === RESTJSONErrorCodes.UnknownMember || code === RESTJSONErrorCodes.UnknownUser;
}

/** Vrai si l'erreur signifie « ce compte n'est pas banni ». */
export function estBannissementInexistant(err: unknown): boolean {
  return codeErreurDiscord(err) === RESTJSONErrorCodes.UnknownBan;
}

// ─── Purge de messages jointe à un bannissement ─────────────────────────────

/**
 * Convertit des jours de purge en secondes, comme l'API les attend.
 *
 * `BanOptions.deleteMessageDays` est DÉPRÉCIÉ dans discord.js v14 au profit de
 * `deleteMessageSeconds` : passer l'ancien champ marche encore mais disparaîtra,
 * et surtout mélanger les deux unités sur le même appel produit une purge
 * silencieusement fausse (7 « jours » interprétés comme 7 secondes). On convertit
 * donc une seule fois, ici, et les commandes ne manipulent que des secondes.
 */
export function secondesPurgeBannissement(jours: unknown): number | null {
  const normalises = normaliserJoursPurge(jours);
  return normalises === null ? null : normalises * 86_400;
}

// ─── Message privé envoyé à la personne sanctionnée ─────────────────────────

/** Les quatre sanctions qui donnent lieu à une notification privée. */
export type SanctionNotifiee = "bannissement" | "expulsion" | "exclusion" | "avertissement";

/** Longueur maximale d'un message Discord ordinaire. */
export const LIMITE_MESSAGE = 2_000;

const LIBELLES_SANCTION: Readonly<Record<SanctionNotifiee, string>> = Object.freeze({
  bannissement: "Tu as été banni du serveur",
  expulsion: "Tu as été expulsé du serveur",
  exclusion: "Tu as été exclu temporairement",
  avertissement: "Tu reçois un avertissement",
});

const SUITES_SANCTION: Readonly<Record<SanctionNotifiee, string>> = Object.freeze({
  bannissement:
    "Le bannissement est définitif tant qu'un membre du staff ne le lève pas. Tu peux répondre à ce message pour le contester.",
  expulsion: "Une expulsion n'est pas un bannissement : tu peux revenir avec une nouvelle invitation.",
  exclusion: "Pendant l'exclusion tu restes sur le serveur mais tu ne peux ni écrire, ni réagir, ni parler en vocal.",
  avertissement: "Aucune sanction n'a été appliquée : c'est un rappel. Il est consigné dans le journal du staff.",
});

/**
 * Compose la notification privée envoyée à la personne sanctionnée.
 *
 * ── POURQUOI L'ENVOYER AVANT D'AGIR ────────────────────────────────────────
 * Un bannissement retire le serveur commun : après l'appel, Discord refuse
 * l'ouverture du salon privé (`50007`). La notification part donc TOUJOURS avant
 * la sanction, jamais après — sinon la personne est bannie sans jamais savoir
 * pourquoi, ce qui rend le recours impossible.
 *
 * Le texte ne nomme jamais l'auteur humain de la sanction : le journal d'audit
 * du serveur et `admin_audit_log` le portent, un message privé transmis à un
 * membre en colère n'a pas à désigner une personne.
 */
export function messageSanctionPrivee(opts: {
  sanction: SanctionNotifiee;
  serveur: string;
  motif?: string | null;
  /** Durée de l'exclusion, en millisecondes. Ignorée pour les autres sanctions. */
  dureeMs?: number | null;
}): string {
  const motif = opts.motif?.trim();
  const lignes = [
    `**${LIBELLES_SANCTION[opts.sanction]} ${opts.serveur}.**`,
    "",
    motif && motif.length > 0 ? `Motif : ${motif}` : "Aucun motif n'a été précisé.",
  ];
  if (opts.sanction === "exclusion" && typeof opts.dureeMs === "number" && opts.dureeMs > 0) {
    lignes.push(`Durée : ${dureeLisible(opts.dureeMs)}`);
  }
  lignes.push("", SUITES_SANCTION[opts.sanction]);
  const texte = lignes.join("\n");
  return texte.length > LIMITE_MESSAGE ? `${texte.slice(0, LIMITE_MESSAGE - 1)}…` : texte;
}

// ─── Empêchements hors hiérarchie ───────────────────────────────────────────

/**
 * Empêchements applicables à une action qui n'exerce AUCUN pouvoir Discord.
 *
 * Un avertissement n'est qu'un message privé : il ne touche ni aux rôles, ni à
 * la présence sur le serveur. Lui appliquer la hiérarchie interdirait d'avertir
 * un collègue du staff, ce qui n'a aucun sens — Discord, lui, ne refuserait
 * rien. Restent les deux cas qui n'ont pas de sens quelle que soit l'action :
 * s'avertir soi-même, et avertir le bot.
 */
export function empechementMessagePrive(
  contexte: Pick<ContexteHierarchie, "cibleEstAuteur" | "cibleEstBot">,
): EmpechementHierarchie | null {
  if (contexte.cibleEstAuteur) {
    return "soi-meme";
  }
  if (contexte.cibleEstBot) {
    return "le-bot";
  }
  return null;
}

// ─── Autocomplétion de la liste des bannis ──────────────────────────────────

/** Discord refuse plus de 25 propositions, et 100 caractères par proposition. */
export const MAX_PROPOSITIONS = 25;
export const LIMITE_PROPOSITION = 100;

export interface BanniAffichable {
  /** Flocon du compte banni. C'est LUI que la commande renvoie. */
  readonly id: string;
  /** Nom lisible du compte au moment du bannissement. */
  readonly etiquette: string;
  /** Motif inscrit au journal d'audit, s'il en reste un. */
  readonly motif?: string | null;
}

/**
 * Propositions d'autocomplétion pour `debannir`.
 *
 * ── POURQUOI FILTRER ICI PLUTÔT QUE DANS LA COMMANDE ───────────────────────
 * La recherche porte sur DEUX champs (le nom et l'identifiant) : on tape
 * rarement un flocon de 19 chiffres de tête, mais on le colle souvent depuis un
 * signalement. Ne chercher que sur le nom rendrait l'identifiant collé
 * introuvable, et ne chercher que sur l'identifiant rendrait l'autocomplétion
 * inutile. Les deux bornes de Discord (25 propositions, 100 caractères) sont
 * appliquées ici, une fois, plutôt que rappelées à chaque appel.
 *
 * La `value` renvoyée est TOUJOURS l'identifiant, jamais le nom : un pseudo
 * change, et deux comptes peuvent porter le même.
 */
export function filtrerBannis(
  bannis: readonly BanniAffichable[],
  saisie: unknown,
  limite: number = MAX_PROPOSITIONS,
): Array<{ name: string; value: string }> {
  const cible = typeof saisie === "string" ? saisie.trim().toLowerCase() : "";
  const plafond = Math.min(Math.max(Math.trunc(limite), 0), MAX_PROPOSITIONS);
  const retenus: Array<{ name: string; value: string }> = [];
  for (const banni of bannis) {
    if (retenus.length >= plafond) {
      break;
    }
    if (cible.length > 0 && !banni.etiquette.toLowerCase().includes(cible) && !banni.id.includes(cible)) {
      continue;
    }
    const motif = banni.motif?.trim();
    const brut =
      motif && motif.length > 0 ? `${banni.etiquette} (${banni.id}) — ${motif}` : `${banni.etiquette} (${banni.id})`;
    retenus.push({
      name: brut.length > LIMITE_PROPOSITION ? `${brut.slice(0, LIMITE_PROPOSITION - 1)}…` : brut,
      value: banni.id.slice(0, LIMITE_PROPOSITION),
    });
  }
  return retenus;
}

// ─── Salons : tenue, verrouillage et purge ──────────────────────────────────

/**
 * Longueur maximale du sujet (`topic`) d'un salon textuel ou d'annonces.
 *
 * Ce n'est PAS la même limite partout : un forum accepte 4096 caractères. On
 * borne sur la valeur du seul cas que `/administration salon creer` sait poser,
 * parce qu'un sujet trop long ne tronque pas — l'API refuse la création entière
 * en `50035`, et le salon n'existe jamais.
 */
export const LIMITE_SUJET_SALON = 1024;

/** `messages.fetch` ne rend jamais plus de 100 messages par appel. */
export const TAILLE_PAGE_MESSAGES = 100;

/**
 * Pages de 100 messages qu'une purge accepte de parcourir.
 *
 * Nécessaire dès qu'on filtre par auteur : demander « les 50 derniers messages
 * de X » n'a de sens que si l'on regarde plus de 50 messages. Cinq pages, soit
 * 500 messages examinés, tiennent largement sous la limite de débit de l'API
 * tout en couvrant un salon actif. Au-delà, la commande le DIT plutôt que de
 * laisser croire qu'elle a tout vu.
 */
export const PAGES_MAX_PURGE = 5;

/** Voir et lire l'historique : le strict nécessaire pour préparer une purge. */
export const PERMISSIONS_LECTURE_MESSAGES: readonly bigint[] = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
]);

/**
 * Publier un embed signé dans un salon.
 *
 * `EmbedLinks` est la permission qu'on oublie : sans elle l'envoi RÉUSSIT, et
 * l'embed n'apparaît simplement jamais. Aucune erreur, aucun message — l'annonce
 * est perdue en silence. Elle se vérifie donc avant, pas après.
 */
export const PERMISSIONS_PUBLICATION: readonly bigint[] = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
]);

/** Ce que `/administration salon creer` sait poser, et ce que Discord en fait. */
export interface TypeSalonCreable {
  /** Valeur choisie dans Discord. */
  readonly valeur: "textuel" | "vocal" | "annonce";
  readonly libelle: string;
  readonly type: ChannelType.GuildText | ChannelType.GuildVoice | ChannelType.GuildAnnouncement;
  /**
   * Discord réécrit-il le nom en minuscules-avec-tirets ?
   *
   * OUI pour les salons textuels et d'annonces, NON pour le vocal : un salon
   * vocal garde ses majuscules et ses espaces. Appliquer `normaliserNomSalon`
   * partout afficherait « salon-vocal-test » là où le serveur montre « Salon
   * Vocal Test ».
   */
  readonly nomNormalise: boolean;
  /** Le type porte-t-il un sujet ? Le vocal n'en a pas. */
  readonly accepteSujet: boolean;
  /** Le type exige-t-il que le serveur soit une Communauté ? */
  readonly exigeCommunaute: boolean;
}

export const TYPES_SALON_CREABLES: readonly TypeSalonCreable[] = Object.freeze([
  {
    valeur: "textuel",
    libelle: "Salon textuel",
    type: ChannelType.GuildText,
    nomNormalise: true,
    accepteSujet: true,
    exigeCommunaute: false,
  },
  {
    valeur: "vocal",
    libelle: "Salon vocal",
    type: ChannelType.GuildVoice,
    nomNormalise: false,
    accepteSujet: false,
    exigeCommunaute: false,
  },
  {
    // Un salon d'annonces n'existe QUE sur un serveur Communauté : sans la
    // fonctionnalité, l'API répond `50024` et le nom du refus ne dit rien de
    // la cause. On le sait avant d'appeler.
    valeur: "annonce",
    libelle: "Salon d'annonces",
    type: ChannelType.GuildAnnouncement,
    nomNormalise: true,
    accepteSujet: true,
    exigeCommunaute: true,
  },
]);

/** Résout le choix de type. `null` sur tout ce qui n'est pas l'une des trois valeurs. */
export function lireTypeSalon(valeur: unknown): TypeSalonCreable | null {
  if (typeof valeur !== "string") {
    return null;
  }
  const cible = valeur.trim().toLowerCase();
  return TYPES_SALON_CREABLES.find(type => type.valeur === cible) ?? null;
}

/**
 * Nom réellement obtenu après passage par Discord.
 *
 * Un salon vocal n'est pas normalisé, mais il reste rogné et borné à 100
 * caractères. Rend `null` quand il ne reste rien d'exploitable : « ??? » devient
 * une chaîne vide une fois normalisé, et l'API refuse alors la création.
 */
export function nomSalonEffectif(saisie: unknown, type: TypeSalonCreable): string | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const nom = type.nomNormalise ? normaliserNomSalon(saisie) : saisie.trim().slice(0, LIMITE_NOM);
  return nom.length === 0 ? null : nom;
}

/**
 * État de « Envoyer des messages » pour `@everyone` sur un salon donné.
 *
 * Trois états, pas deux : une surcharge Discord distingue « explicitement
 * autorisé », « explicitement refusé » et « pas de surcharge » (la permission
 * est alors héritée de la catégorie puis des rôles). C'est précisément ce que
 * `deverrouiller` doit savoir : remettre « autorisé » là où il n'y avait aucune
 * surcharge OUVRE un salon que la catégorie tenait fermé.
 */
export type EtatEnvoi = "autorise" | "refuse" | "herite";

export function estEtatEnvoi(valeur: unknown): valeur is EtatEnvoi {
  return valeur === "autorise" || valeur === "refuse" || valeur === "herite";
}

/** Lit l'état depuis les deux masques d'une surcharge. `null` = aucune surcharge. */
export function lireEtatEnvoi(
  surcharge: { readonly autorise: boolean; readonly refuse: boolean } | null | undefined,
): EtatEnvoi {
  if (!surcharge) {
    return "herite";
  }
  // `deny` prime : Discord ne pose jamais les deux bits, mais une surcharge
  // forgée à la main par l'API pourrait, et un refus doit alors l'emporter.
  if (surcharge.refuse) {
    return "refuse";
  }
  return surcharge.autorise ? "autorise" : "herite";
}

export const LIBELLES_ETAT_ENVOI: Readonly<Record<EtatEnvoi, string>> = Object.freeze({
  autorise: "explicitement autorisé",
  refuse: "explicitement refusé",
  herite: "hérité (aucune surcharge sur ce salon)",
});

export function libelleEtatEnvoi(etat: EtatEnvoi): string {
  return LIBELLES_ETAT_ENVOI[etat];
}

/**
 * Valeur à passer à `permissionOverwrites.edit` pour rétablir un état.
 *
 * `null` n'est pas « je ne sais pas » : c'est la valeur que l'API attend pour
 * RETIRER le bit de la surcharge, donc pour revenir à l'héritage. C'est ce qui
 * permet à `deverrouiller` de remettre exactement ce qu'il y avait, et non
 * « autorisé » par défaut.
 */
export function surchargeEnvoi(etat: EtatEnvoi): boolean | null {
  if (etat === "autorise") {
    return true;
  }
  return etat === "refuse" ? false : null;
}

/**
 * Relit l'état d'avant-verrouillage archivé dans `admin_audit_log.details`.
 *
 * Le bot n'a AUCUNE mémoire entre deux commandes : le seul endroit où l'état
 * précédent survit à un redémarrage est la trace d'audit qu'on écrit en même
 * temps que le verrouillage. Rend `null` sur une trace absente ou d'une forme
 * inattendue — `deverrouiller` retombe alors sur l'héritage en le disant.
 */
export function lireEtatEnvoiArchive(details: unknown): EtatEnvoi | null {
  if (typeof details !== "object" || details === null) {
    return null;
  }
  const valeur = (details as Record<string, unknown>).envoyer_avant;
  return estEtatEnvoi(valeur) ? valeur : null;
}

/** Ce qu'une purge va réellement faire, avant de la faire. */
export interface BilanPurge {
  /** Nombre demandé dans la commande. */
  readonly demande: number;
  /** Messages réellement parcourus dans l'historique. */
  readonly examines: number;
  /** Messages épinglés écartés du lot. */
  readonly epingles: number;
  /** Messages que `bulkDelete` peut supprimer. */
  readonly supprimables: number;
  /** Messages retenus mais trop vieux de plus de quatorze jours. */
  readonly tropAnciens: number;
  /** La demande dépassait le plafond de 100 de l'API. */
  readonly plafonne: boolean;
  /** L'historique a été parcouru jusqu'au bout des pages autorisées. */
  readonly tronque: boolean;
}

/**
 * Phrase exacte de ce qu'une purge va supprimer.
 *
 * ── POURQUOI ELLE EXISTE ───────────────────────────────────────────────────
 * `bulkDelete` refuse silencieusement tout message de plus de quatorze jours :
 * demander 100 dans un salon calme en supprime souvent une poignée. Annoncer
 * « 100 messages supprimés » serait faux, et c'est le genre de faux qui fait
 * relancer la commande jusqu'à vider un salon qu'on croyait déjà vide. On dit
 * donc le chiffre réel, et ce qui explique l'écart.
 */
export function resumerPurge(bilan: BilanPurge): string {
  const phrases: string[] = [
    `**${bilan.supprimables}** message${bilan.supprimables > 1 ? "s" : ""} sur les ` +
      `${bilan.demande} demandé${bilan.demande > 1 ? "s" : ""}.`,
  ];
  if (bilan.tropAnciens > 0) {
    phrases.push(
      `${bilan.tropAnciens} ${bilan.tropAnciens > 1 ? "ont" : "a"} plus de quatorze jours : ` +
        "Discord interdit de les supprimer en masse.",
    );
  }
  if (bilan.epingles > 0) {
    phrases.push(
      `${bilan.epingles} message${bilan.epingles > 1 ? "s" : ""} épinglé${bilan.epingles > 1 ? "s" : ""} ` +
        `${bilan.epingles > 1 ? "ont été laissés" : "a été laissé"} en place.`,
    );
  }
  if (bilan.plafonne) {
    phrases.push(`La demande a été ramenée au plafond de ${MAX_SUPPRESSION_MASSE} de l'API.`);
  }
  phrases.push(`${bilan.examines} message${bilan.examines > 1 ? "s" : ""} parcouru${bilan.examines > 1 ? "s" : ""}.`);
  if (bilan.tronque) {
    phrases.push(
      `La recherche s'est arrêtée après ${PAGES_MAX_PURGE} pages : il peut rester des messages plus anciens.`,
    );
  }
  return phrases.join(" ");
}

/**
 * Où un salon apparaît dans la configuration du bot.
 *
 * ── POURQUOI C'EST UN GARDE-FOU ET PAS UNE COQUETTERIE ─────────────────────
 * `lib/config.ts` ne porte AUCUN identifiant de salon (vérifié le 13/8/2026 :
 * il n'y a que la guilde, Redis et l'URL du site). Les salons vivent ailleurs —
 * dans `DISCORD_CHANNELS` de `@rosegriffon/types/discord`, dans les variables
 * `DISCORD_*_CHANNEL_ID`, et dans `settings['tweets.notification'].salon` en
 * base. Supprimer l'un d'eux ne casse rien tout de suite : la panne apparaît au
 * prochain drain de la veille ou à la prochaine annonce, sous la forme d'un
 * `10003 Unknown Channel` que plus personne ne relie à la suppression.
 *
 * Générique sur une table `nom lisible → identifiant` pour rester pur : la
 * commande assemble les sources, cette fonction ne fait que les confronter.
 */
export function referencesSalon(
  salonId: string,
  sources: Readonly<Record<string, string | null | undefined>>,
): string[] {
  const cible = salonId.trim();
  if (cible.length === 0) {
    return [];
  }
  return Object.entries(sources)
    .filter(([, valeur]) => typeof valeur === "string" && valeur.trim() === cible)
    .map(([nom]) => nom);
}
