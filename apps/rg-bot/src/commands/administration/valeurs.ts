/**
 * Valeurs et conversions de `/administration` — module PUR.
 *
 * Aucune base, aucun réseau, aucun `discord.js` : tout ce qui décide (est-ce un
 * rôle valable ? cette date est-elle lisible ? ce bouton m'appartient-il ?) se
 * teste ici, dans `valeurs.test.ts`, plutôt que dans un salon.
 *
 * C'est particulièrement vrai des rôles : la liste écrite en dur dans l'ancien
 * `/rg-user` ne correspondait PAS à la base.
 */

import { ALL_ROLES, type RgRole } from "@rosegriffon/types/roles";

// `echapperMarkdown` est déjà écrit et déjà testé dans `commands/staff/format.ts`,
// et il est PUR lui aussi : le réécrire ici garantirait qu'une des deux copies
// finisse en retard sur l'autre.
import { echapperMarkdown } from "../staff/format";

import { CLE_REGLAGE_TWEETS, type FiltreTweets } from "../../lib/tweets-format";

/**
 * Rôles réellement attribuables à un profil.
 *
 * ⚠ `member` n'est PAS dans `ALL_ROLES` de `@rosegriffon/types/roles`, et
 * pourtant 1 839 des 1 850 profils le portent (relevé le 13/8/2026 :
 * `member` 1839, `admin` 7, `superadmin` 2, `user` 1, `moderator` 1). L'ancien
 * `/rg-user list` proposait `user, premium, moderator, staff, admin, banned` :
 * filtrer sur `member` était donc IMPOSSIBLE, et filtrer sur `staff` ou
 * `premium` ne rendait jamais rien. On additionne ici l'union typée et la
 * réalité de la colonne, plutôt que de choisir laquelle mentir.
 */
export const ROLES_ASSIGNABLES: readonly string[] = Object.freeze(
  [...new Set<string>([...ALL_ROLES, "member"])].toSorted((a, b) => a.localeCompare(b, "fr")),
);

/** Vrai si la valeur est un rôle que l'on accepte d'écrire dans `profiles.role`. */
export function estRoleAssignable(valeur: unknown): valeur is RgRole | "member" {
  return typeof valeur === "string" && ROLES_ASSIGNABLES.includes(valeur);
}

/** Les trois états d'un article, tels que la colonne `articles.status` les porte. */
export const STATUTS_ARTICLE = ["published", "draft", "archived"] as const;
export type StatutArticle = (typeof STATUTS_ARTICLE)[number];

export function estStatutArticle(valeur: unknown): valeur is StatutArticle {
  return typeof valeur === "string" && (STATUTS_ARTICLE as readonly string[]).includes(valeur);
}

/**
 * Les dix équipes de `team_members.team_id`, avec leur libellé d'affichage.
 * Repris tel quel de `commands/admin/team.ts` : ce sont les valeurs en base.
 */
export const EQUIPES_RG = [
  { nom: "Bureau de l'Association", valeur: "bureauteam" },
  { nom: "Association", valeur: "assoteam" },
  { nom: "Partenaires & Collaborateurs", valeur: "collabteam" },
  { nom: "Équipe Achilléa", valeur: "achilleateam" },
  { nom: "Équipe Azalée", valeur: "azaleeteam" },
  { nom: "Équipe Lore", valeur: "loreteam" },
  { nom: "Équipe Dessinateur", valeur: "dessinateurteam" },
  { nom: "Cellule de Médiation", valeur: "mediationteam" },
  { nom: "Équipe Production", valeur: "productionteam" },
  { nom: "Équipe Réseaux", valeur: "socialteam" },
] as const;

/** Les sept jours, index `stream_schedules.day_of_week` (0 = dimanche). */
export const JOURS_SEMAINE = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] as const;

/**
 * Lit une date saisie à la main.
 *
 * Accepte `2026-05-01`, `2026-05-01 20:00`, `2026-05-01T20:00`,
 * `2026-05-01T20:00:00+02:00`. SANS fuseau explicite, la valeur est lue dans le
 * fuseau du serveur — `Etc/UTC` sur ce VPS, aussi bien pour le processus que
 * pour Postgres (vérifié le 13/8/2026). L'écrire est plus honnête que de
 * laisser croire à une heure de Paris.
 *
 * Retourne `null` plutôt qu'une date fausse : `new Date("n'importe quoi")` rend
 * un `Invalid Date` qui s'insère silencieusement en base sous forme de `null`
 * ou lève très loin de la saisie.
 */
export function analyserDate(saisie: unknown): Date | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const propre = saisie.trim();
  if (propre.length === 0) {
    return null;
  }
  // On n'accepte que les formes ancrées sur une date ISO : `01/05/2026` est
  // ambigu (jour/mois ou mois/jour), et `new Date` le résout différemment
  // selon la locale du moteur.
  const forme = /^(\d{4})-(\d{2})-(\d{2})([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(propre);
  if (!forme) {
    return null;
  }
  // Le calendrier se vérifie AVANT `new Date`, arithmétiquement : `new Date`
  // ne rejette pas un jour hors du mois, il le reporte silencieusement
  // (`2026-02-30` devenait le 2 mars, et une correction de saisie passait donc
  // pour une date valable). `Date.UTC(a, mois, 0)` donne le dernier jour du
  // mois précédent, soit le nombre de jours du mois demandé, années
  // bissextiles comprises.
  const annee = Number(forme[1]);
  const mois = Number(forme[2]);
  const jour = Number(forme[3]);
  if (mois < 1 || mois > 12 || jour < 1) {
    return null;
  }
  if (jour > new Date(Date.UTC(annee, mois, 0)).getUTCDate()) {
    return null;
  }
  const instant = new Date(propre.replace(" ", "T"));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Lit une heure `HH:MM` et la rend normalisée sur deux chiffres.
 * `stream_schedules.start_time` est une colonne `time`, pas un texte libre.
 */
export function analyserHeure(saisie: unknown): string | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const trouve = /^(\d{1,2}):(\d{2})$/.exec(saisie.trim());
  if (!trouve) {
    return null;
  }
  const heures = Number(trouve[1]);
  const minutes = Number(trouve[2]);
  if (heures > 23 || minutes > 59) {
    return null;
  }
  return `${String(heures).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Vrai si la valeur a la forme d'un UUID (les clés primaires du site). */
export function estUuid(valeur: unknown): boolean {
  return (
    typeof valeur === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valeur.trim())
  );
}

/** Vrai si la valeur a la forme d'un identifiant Discord (flocon numérique). */
export function estIdentifiantDiscord(valeur: unknown): boolean {
  return typeof valeur === "string" && /^\d{17,20}$/.test(valeur.trim());
}

/** Huit premiers caractères d'un identifiant, pour un accusé de réception lisible. */
export function abregerIdentifiant(valeur: string | null | undefined): string {
  if (!valeur) {
    return "—";
  }
  return valeur.length > 8 ? `${valeur.slice(0, 8)}…` : valeur;
}

// ─── Boutons de confirmation ────────────────────────────────────────────────

/** Préfixe des identifiants de bouton de confirmation. */
export const PREFIXE_CONFIRMATION = "rgconf";

export type ReponseConfirmation = "oui" | "non";

/**
 * Compose l'identifiant d'un bouton de confirmation.
 *
 * Discord plafonne `custom_id` à 100 caractères. La graine est l'identifiant de
 * l'interaction d'origine (un flocon de 19 chiffres) : `rgconf|oui|<19>` tient
 * largement, et reste unique même si deux personnes lancent la même action à la
 * même seconde.
 */
export function construireIdConfirmation(reponse: ReponseConfirmation, graine: string): string {
  return `${PREFIXE_CONFIRMATION}|${reponse}|${graine}`;
}

/** Décompose un identifiant de bouton. Rend `null` sur tout ce qui n'est pas à nous. */
export function analyserIdConfirmation(id: unknown): { reponse: ReponseConfirmation; graine: string } | null {
  if (typeof id !== "string") {
    return null;
  }
  const morceaux = id.split("|");
  if (morceaux.length !== 3 || morceaux[0] !== PREFIXE_CONFIRMATION) {
    return null;
  }
  const [, reponse, graine] = morceaux;
  if ((reponse !== "oui" && reponse !== "non") || !graine || graine.length === 0) {
    return null;
  }
  return { reponse, graine };
}

/**
 * Résume un changement de valeur pour l'accusé de réception ET pour l'audit.
 *
 * Écrit « avant → après » plutôt que le seul « après » : un journal qui ne dit
 * pas d'où l'on vient ne permet pas de revenir en arrière.
 */
export function decrireChangement(avant: unknown, apres: unknown, limite = 120): string {
  return `\`${bornerValeur(avant, limite)}\` → \`${bornerValeur(apres, limite)}\``;
}

/** Rend une valeur quelconque affichable sur une ligne, sans jamais lever. */
export function bornerValeur(valeur: unknown, limite = 120): string {
  if (valeur === null || valeur === undefined) {
    return "aucune";
  }
  let texte: string;
  if (typeof valeur === "string") {
    texte = valeur;
  } else {
    try {
      texte = JSON.stringify(valeur) ?? String(valeur);
    } catch {
      texte = String(valeur);
    }
  }
  texte = texte.replace(/\s+/g, " ").trim();
  if (texte.length === 0) {
    return "vide";
  }
  return texte.length > limite ? `${texte.slice(0, limite - 1)}…` : texte;
}

// ─── Réglages k/v (`public.settings`) ───────────────────────────────────────

/**
 * Forme d'une clé de `public.settings`.
 *
 * Les huit clés réellement en base (relevé le 13/8/2026 : `patreon.cutoff_days`,
 * `patreon.discord_grace_days`, `patreon.grandfather_months`,
 * `patreon.import_addresses_consent`, `patreon.incentive_max_redemptions`,
 * `patreon.incentive_offer`, `patreon.t0`, `tweets.notification`) suivent toutes
 * `domaine.sous_clef`, en minuscules. La table n'a AUCUNE contrainte dessus :
 * un `INSERT` avec « Patreon.T0 » ou « tweets.notification » suivi d'une espace
 * crée une SECONDE ligne, que plus rien ne lit — le service continue de servir
 * l'ancienne valeur pendant qu'on croit l'avoir changée. D'où cette forme,
 * appliquée avant toute écriture.
 */
const FORME_CLE_REGLAGE = /^[a-z0-9][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/** Clé normalisée (rognée, en minuscules), ou `null` si la forme est refusée. */
export function normaliserCleReglage(saisie: unknown): string | null {
  if (typeof saisie !== "string") {
    return null;
  }
  const propre = saisie.trim().toLowerCase();
  return FORME_CLE_REGLAGE.test(propre) ? propre : null;
}

export interface ValeurReglage {
  /** Ce qui sera réellement écrit dans la colonne `jsonb`. */
  valeur: unknown;
  /** Vrai si la saisie était du JSON ; faux si elle est rangée comme chaîne. */
  json: boolean;
}

/**
 * Lit la valeur saisie pour un réglage.
 *
 * La colonne `settings.value` est de type `jsonb` : `60` doit y arriver en
 * NOMBRE (c'est ainsi que `patreon.cutoff_days` est stocké et lu), et `true` en
 * BOOLÉEN. Ranger tout en chaîne casserait les comparaisons côté site ; refuser
 * tout ce qui n'est pas du JSON interdirait d'écrire une phrase. On tente donc
 * le JSON, et on retombe sur la chaîne — c'est le comportement de l'ancien
 * `/rg-settings set`, conservé parce qu'il correspond au contenu réel de la
 * table, mais rendu VISIBLE : la réponse dit lequel des deux chemins a servi.
 */
export function analyserValeurReglage(saisie: string): ValeurReglage {
  try {
    return { valeur: JSON.parse(saisie.trim()) as unknown, json: true };
  } catch {
    return { valeur: saisie, json: false };
  }
}

/**
 * Refuse-t-on d'écrire cette valeur sous cette clé ? (`null` = écriture permise)
 *
 * ── LE CAS RÉEL QUE CE GARDE FERME ─────────────────────────────────────────
 * `settings['tweets.notification']` est relu par `lireFiltreTweets`, qui
 * commence par `if (!valeur || typeof valeur !== "object" || Array.isArray(…))
 * return { …FILTRE_TWEETS_DEFAUT }`. Autrement dit, écrire `false` ou `"off"`
 * sous cette clé — la faute la plus naturelle pour qui veut couper la
 * notification — ne provoque AUCUNE erreur : la veille retombe sur les valeurs
 * par défaut du code et les 8 comptes réellement suivis en base
 * (inazuma_project, inazuma_cross, InazumaSeries, InazumaNational, Level5Hub,
 * LEVEL5_times, Azalee_IE, rose_griffon, relevé du 13/8/2026) disparaissent
 * sans un mot. La forme est donc vérifiée AVANT l'écriture, pas signalée après.
 */
export function refusValeurReglage(cle: string, valeur: unknown): string | null {
  if (cle !== CLE_REGLAGE_TWEETS) {
    return null;
  }
  if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) {
    return (
      `\`${CLE_REGLAGE_TWEETS}\` doit rester un OBJET JSON : le lecteur ` +
      "(`lireFiltreTweets`) ignore silencieusement toute autre forme et retombe sur les valeurs " +
      "par défaut du code — la liste des comptes suivis serait perdue sans le moindre message. " +
      "Pour couper la notification, utilise `/administration veille regler actif:false`."
    );
  }
  return null;
}

// ─── Annonce d'un article ───────────────────────────────────────────────────

/**
 * Rend absolue une URL d'illustration d'article.
 *
 * `articles.featured_image_url` porte les DEUX formes en base (relevé le
 * 13/8/2026) : une URL complète (`https://cdn.rosegriffon.fr/dx11/menu/…`,
 * `https://pbs.twimg.com/…`) ET un chemin relatif (`/rgtv/jude.webp`). Discord
 * va chercher l'image lui-même : un chemin relatif n'est jamais résolu, et
 * l'ancien `/cron annonce` le jetait en silence (`image?.startsWith("https://")`),
 * ce qui produisait une annonce sans visuel sans jamais dire pourquoi.
 *
 * Tout ce qui n'est ni `https://` ni un chemin absolu est refusé : une URL en
 * clair (`http://`) fait rejeter l'embed ENTIER par l'API, donc une annonce
 * perdue plutôt qu'une image manquante.
 */
export function urlIllustrationAbsolue(url: string | null | undefined, origine: string): string | null {
  const propre = url?.trim() ?? "";
  if (propre.length === 0) {
    return null;
  }
  if (propre.startsWith("https://")) {
    return propre;
  }
  if (propre.startsWith("/")) {
    return `${origine}${propre}`;
  }
  return null;
}

// ─── Réglage de la veille X ─────────────────────────────────────────────────

/** Modifications demandées à `/administration veille regler`. */
export interface ModificationsVeille {
  actif?: boolean;
  salon?: string;
  maxParLot?: number;
  ajouter?: string;
  retirer?: string;
  exclure?: string;
  inclure?: string;
}

export interface PatchVeille {
  /** Champs à fusionner dans `settings['tweets.notification']`. Vide si rien ne change. */
  patch: Partial<FiltreTweets>;
  /** Une ligne « avant → après » par changement, pour l'accusé ET pour l'audit. */
  changements: string[];
}

/** Pseudo X comparable : X ignore la casse et le `@` (`@Level5Hub` = `level5hub`). */
function clefCompte(valeur: string): string {
  return valeur.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Compose le patch du réglage de veille à partir des options de la commande.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ─────────────────────────────────────────
 * L'ancien `/tweets regler` réécrivait `comptes` À CHAQUE APPEL, même quand ni
 * `ajouter` ni `retirer` n'était fourni : régler le seul salon renvoyait donc la
 * liste entière en base. Inoffensif tant que la lecture précède l'écriture d'une
 * milliseconde, destructeur dès que deux personnes règlent en même temps (le
 * second écrase l'ajout du premier avec la liste qu'il avait lue avant). Ici,
 * `comptes` n'entre dans le patch que s'il change VRAIMENT.
 *
 * Elle refuse aussi silencieusement les doublons : ajouter `@Level5Hub` quand
 * `level5hub` est déjà suivi ne produit aucun changement, donc aucune écriture.
 */
export function construirePatchVeille(avant: FiltreTweets, modifications: ModificationsVeille): PatchVeille {
  const patch: Partial<FiltreTweets> = {};
  const changements: string[] = [];

  if (modifications.actif !== undefined && modifications.actif !== avant.actif) {
    patch.actif = modifications.actif;
    changements.push(
      `État : ${decrireChangement(avant.actif ? "active" : "coupée", modifications.actif ? "active" : "coupée")}`,
    );
  }

  if (modifications.salon !== undefined && modifications.salon !== avant.salon) {
    patch.salon = modifications.salon;
    changements.push(`Salon : ${decrireChangement(avant.salon, modifications.salon)}`);
  }

  if (modifications.maxParLot !== undefined && modifications.maxParLot !== avant.max_par_lot) {
    patch.max_par_lot = modifications.maxParLot;
    changements.push(`Seuil de détail : ${decrireChangement(avant.max_par_lot, modifications.maxParLot)}`);
  }

  let comptes = [...avant.comptes];
  if (modifications.ajouter) {
    const propre = modifications.ajouter.trim().replace(/^@/, "");
    if (propre.length > 0 && !comptes.some(compte => clefCompte(compte) === clefCompte(propre))) {
      comptes.push(propre);
      changements.push(`Compte suivi en plus : \`@${propre}\``);
    }
  }
  if (modifications.retirer) {
    const cible = clefCompte(modifications.retirer);
    const restants = comptes.filter(compte => clefCompte(compte) !== cible);
    if (restants.length !== comptes.length) {
      comptes = restants;
      changements.push(`Compte retiré du suivi : \`@${modifications.retirer.trim().replace(/^@/, "")}\``);
    }
  }
  if (comptes.length !== avant.comptes.length || comptes.some((c, i) => c !== avant.comptes[i])) {
    patch.comptes = comptes;
  }

  let exclues = [...avant.categories_exclues];
  if (modifications.exclure) {
    const propre = modifications.exclure.trim();
    if (propre.length > 0 && !exclues.some(categorie => categorie.toLowerCase() === propre.toLowerCase())) {
      exclues.push(propre);
      changements.push(`Catégorie exclue en plus : \`${propre}\``);
    }
  }
  if (modifications.inclure) {
    const cible = modifications.inclure.trim().toLowerCase();
    const restantes = exclues.filter(categorie => categorie.toLowerCase() !== cible);
    if (restantes.length !== exclues.length) {
      exclues = restantes;
      changements.push(`Catégorie de nouveau annoncée : \`${modifications.inclure.trim()}\``);
    }
  }
  if (exclues.length !== avant.categories_exclues.length || exclues.some((c, i) => c !== avant.categories_exclues[i])) {
    patch.categories_exclues = exclues;
  }

  return { patch, changements };
}

// ─── Synchronisation des membres Discord ────────────────────────────────────

/** Ce que la base sait d'un membre AVANT la synchronisation. */
export interface EtatMembreEnBase {
  discordId: string;
  /** Vrai si `discord_members.left_at` est renseigné (membre marqué parti). */
  parti: boolean;
}

export interface ResumeSynchronisation {
  /** Présents sur le serveur et absents de la table : lignes créées. */
  ajoutes: string[];
  /** Présents des deux côtés et déjà comptés présents : lignes rafraîchies. */
  misAJour: number;
  /** Marqués partis mais de retour sur le serveur : `left_at` remis à `NULL`. */
  revenus: string[];
  /** Comptés présents en base mais absents du serveur : ils sont partis. */
  partis: string[];
}

/**
 * Compare l'état de `discord_members` et la liste réelle du serveur Discord.
 *
 * ── CE QUE L'ANCIEN `/sync` NE DISAIT PAS ──────────────────────────────────
 * Il annonçait « Synced 1849/1849 members » : un seul chiffre, qui ne
 * distinguait ni une arrivée d'une simple mise à jour d'avatar, ni surtout les
 * DÉPARTS — un membre parti restait compté présent tant que la tâche `discord`
 * du cron ne passait pas. Sur la vraie base (13/8/2026) : 1 849 présents,
 * 226 partis, 2 075 lignes.
 *
 * La comparaison se fait par ENSEMBLES, pas sur `updated_at < début` comme la
 * réconciliation du cron : si l'écriture d'un membre échoue (la synchronisation
 * ramène ses erreurs ligne à ligne), l'heuristique du cron le déclarerait parti
 * alors qu'il est là. La différence d'ensembles ne dépend, elle, que de ce que
 * la passerelle Discord a rendu.
 */
/**
 * Une vague de départs est-elle assez grosse pour être suspecte ?
 *
 * La liste des membres vient de la passerelle Discord. Si elle revient
 * incomplète — coupure au milieu de la pagination, intent `GUILD_MEMBERS`
 * retiré, cache partiel — la différence d'ensembles déclare partis des
 * centaines de personnes présentes, et `left_at` les retire des statistiques du
 * site. Au-delà de ce seuil, la commande refuse d'écrire et demande une
 * confirmation explicite : sur 1 849 présents (relevé du 13/8/2026), 185 départs
 * en une fois n'est pas un mardi ordinaire.
 *
 * Le plancher de 20 évite qu'un serveur minuscule ne déclenche l'alerte au
 * moindre départ réel.
 */
export function departSuspect(nbPartis: number, nbPresentsEnBase: number): boolean {
  if (nbPartis <= 0) {
    return false;
  }
  return nbPartis >= Math.max(20, Math.ceil(nbPresentsEnBase * 0.1));
}

export function comparerMembres(
  enBase: readonly EtatMembreEnBase[],
  presents: Iterable<string>,
): ResumeSynchronisation {
  const connus = new Map(enBase.map(ligne => [ligne.discordId, ligne.parti]));
  const surLeServeur = new Set(presents);

  const ajoutes: string[] = [];
  const revenus: string[] = [];
  let misAJour = 0;
  for (const identifiant of surLeServeur) {
    const parti = connus.get(identifiant);
    if (parti === undefined) {
      ajoutes.push(identifiant);
    } else if (parti) {
      revenus.push(identifiant);
    } else {
      misAJour += 1;
    }
  }

  const partis: string[] = [];
  for (const [identifiant, parti] of connus) {
    if (!parti && !surLeServeur.has(identifiant)) {
      partis.push(identifiant);
    }
  }

  return { ajoutes, misAJour, revenus, partis };
}

// ─── Articles : libellés d'état ─────────────────────────────────────────────

/**
 * Les trois états d'un article, en français.
 *
 * La colonne `articles.status` porte des valeurs anglaises imposées par la
 * contrainte `articles_status_check` (`draft`/`published`/`archived`) : on écrit
 * donc l'anglais en base et on n'affiche que du français, au lieu de rendre
 * « draft » brut dans un salon comme le faisait `/rg-chronique-admin list`.
 */
export const LIBELLES_STATUT_ARTICLE: Readonly<Record<StatutArticle, string>> = Object.freeze({
  published: "publié",
  draft: "brouillon",
  archived: "archivé",
});

/** Pastille de l'état d'un article. Le libellé reste lisible sans la couleur. */
export const BADGES_STATUT_ARTICLE: Readonly<Record<StatutArticle, string>> = Object.freeze({
  published: "🟢",
  draft: "📝",
  archived: "📦",
});

export function libelleStatutArticle(statut: string | null | undefined): string {
  return estStatutArticle(statut) ? LIBELLES_STATUT_ARTICLE[statut] : "état inconnu";
}

export function badgeStatutArticle(statut: string | null | undefined): string {
  return estStatutArticle(statut) ? BADGES_STATUT_ARTICLE[statut] : "❔";
}

/** Propositions Discord pour l'option `statut`, dérivées de la contrainte SQL. */
export const CHOIX_STATUT_ARTICLE = [
  { name: "Publié", value: "published" },
  { name: "Brouillon", value: "draft" },
  { name: "Archivé", value: "archived" },
] as const;

// ─── Créneaux de stream : libellés d'état ───────────────────────────────────

/**
 * Les trois états d'un créneau de `stream_schedules.status`.
 *
 * ⚠ Il n'y a AUCUNE contrainte `CHECK` sur cette colonne : la seule source de
 * vérité est le formulaire d'administration du site
 * (`apps/website/src/app/admin/stream-schedule/actions.ts`,
 * `z.enum(["active", "inactive", "coming_soon"])`). Les sept lignes existantes
 * sont toutes `active` (relevé le 13/8/2026). Écrire une quatrième valeur depuis
 * Discord produirait un créneau que le site ne saurait pas afficher — d'où cette
 * liste fermée, et non un champ de texte libre.
 */
export const STATUTS_CRENEAU = ["active", "inactive", "coming_soon"] as const;
export type StatutCreneau = (typeof STATUTS_CRENEAU)[number];

export function estStatutCreneau(valeur: unknown): valeur is StatutCreneau {
  return typeof valeur === "string" && (STATUTS_CRENEAU as readonly string[]).includes(valeur);
}

/** Libellés repris tels quels de l'écran d'administration du site. */
export const LIBELLES_STATUT_CRENEAU: Readonly<Record<StatutCreneau, string>> = Object.freeze({
  active: "Actif",
  inactive: "Inactif",
  coming_soon: "À venir",
});

export function libelleStatutCreneau(statut: string | null | undefined): string {
  return estStatutCreneau(statut) ? LIBELLES_STATUT_CRENEAU[statut] : "état inconnu";
}

/**
 * Vrai si le créneau est réellement visible du public.
 *
 * Le planning public et l'API Twitch filtrent tous deux sur `status = 'active'`
 * (`rose-griffon-tv/stream-schedule-actions.ts`, `api/twitch/schedule/route.ts`).
 * Un créneau `inactive` existe en base sans que personne ne le voie : l'écrire
 * évite qu'on cherche pourquoi « le créneau ajouté n'apparaît pas ».
 */
export function estCreneauPublic(statut: string | null | undefined): boolean {
  return statut === "active";
}

export const CHOIX_STATUT_CRENEAU = [
  { name: "Actif (visible sur le site)", value: "active" },
  { name: "Inactif (masqué du planning public)", value: "inactive" },
  { name: "À venir", value: "coming_soon" },
] as const;

// ─── Jours de la semaine ────────────────────────────────────────────────────

/** Vrai si la valeur est un index de jour exploitable par `day_of_week`. */
export function estJourSemaine(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 0 && valeur <= 6;
}

export function libelleJourSemaine(jour: unknown): string {
  return estJourSemaine(jour) ? JOURS_SEMAINE[jour]! : "jour inconnu";
}

/**
 * Rang d'affichage d'un jour dans une semaine française, qui commence LUNDI.
 *
 * `day_of_week` suit la convention Postgres (0 = dimanche) : trier brut plaçait
 * dimanche en tête du planning, ce que ne fait ni le site ni le calendrier de
 * personne. On décale l'AFFICHAGE, jamais la valeur stockée.
 */
export function ordreAffichageJour(jour: number): number {
  return (jour + 6) % 7;
}

/** Les sept jours proposés dans Discord, déjà ordonnés du lundi au dimanche. */
export const CHOIX_JOUR_SEMAINE = [
  { name: "Lundi", value: 1 },
  { name: "Mardi", value: 2 },
  { name: "Mercredi", value: 3 },
  { name: "Jeudi", value: 4 },
  { name: "Vendredi", value: 5 },
  { name: "Samedi", value: 6 },
  { name: "Dimanche", value: 0 },
] as const;

// ─── Saisie d'un champ facultatif ───────────────────────────────────────────

/**
 * Ce qu'on tape pour VIDER un champ plutôt que pour le laisser tel quel.
 *
 * L'ancien `/rg-event-admin edit` écrivait `COALESCE(${valeur}, colonne)` : une
 * option non fournie et une option volontairement vidée arrivaient toutes deux
 * en `null`, donc effacer un lieu était strictement IMPOSSIBLE depuis Discord.
 * Discord n'accepte pas non plus une chaîne vide comme valeur d'option. Il faut
 * donc un marqueur explicite, et le distinguer de « absent » au niveau du type.
 */
export const MARQUEURS_EFFACEMENT: readonly string[] = Object.freeze([
  "-",
  "—",
  "vide",
  "aucun",
  "aucune",
  "neant",
  "néant",
  "rien",
]);

export interface ChampTextuel {
  /** L'option a-t-elle été fournie ? Si non, la colonne ne doit PAS être touchée. */
  readonly fourni: boolean;
  /** Valeur à écrire : `null` signifie « vider la colonne ». */
  readonly valeur: string | null;
}

/** Lit une option textuelle facultative en distinguant « absente » de « à vider ». */
export function lireChampTextuel(saisie: string | null | undefined): ChampTextuel {
  if (typeof saisie !== "string") {
    return { fourni: false, valeur: null };
  }
  const propre = saisie.trim();
  if (propre.length === 0) {
    return { fourni: false, valeur: null };
  }
  if (MARQUEURS_EFFACEMENT.includes(propre.toLowerCase())) {
    return { fourni: true, valeur: null };
  }
  return { fourni: true, valeur: propre };
}

/**
 * Vérifie qu'une plage temporelle a un sens, et rend la phrase à afficher
 * quand ce n'est pas le cas — `null` signifie « rien à redire ».
 *
 * `events.end_time` est `NOT NULL` : une fin avant le début passe la contrainte
 * de la base sans broncher, et l'événement devient invisible côté site (les
 * requêtes publiques filtrent sur `end_time >= NOW()`).
 */
export function verifierPlageTemporelle(debut: Date, fin: Date): string | null {
  if (fin.getTime() === debut.getTime()) {
    return "La fin est identique au début : l'événement durerait zéro seconde.";
  }
  if (fin.getTime() < debut.getTime()) {
    return "La fin est ANTÉRIEURE au début. Inverse les deux dates.";
  }
  return null;
}

/** Confirmation d'une action destructrice : seul « oui » vaut accord. */
export function estConfirme(saisie: unknown): boolean {
  if (typeof saisie !== "string") {
    return false;
  }
  // NFD sépare la lettre de son accent, la plage U+0300–U+036F retire les
  // diacritiques : « OUI », « oui » et un « oùi » malheureux valent tous accord.
  return (
    saisie
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "") === "oui"
  );
}

// ─── Ce qu'un salon Discord n'a PAS le droit de voir ────────────────────────

/**
 * Colonnes de `profiles` qui ne sortent JAMAIS dans un embed, même pour un
 * administrateur.
 *
 * L'ancienne `/rg-user info` affichait `profile.email` en clair, et son
 * `/rg-user list` répétait l'adresse de chaque ligne. Un salon Discord n'est
 * pas un espace privé : le message reste dans l'historique, il est copiable,
 * indexé par le client de chacun, et une réponse éphémère finit quand même
 * dans les journaux de Discord. Le relevé du 13/8/2026 confirme que la table
 * porte bien ces données pour de vrai (adresses postales des acheteurs de la
 * boutique), donc que la fuite était réelle et pas théorique.
 *
 * Un identifiant technique (uuid de profil, flocon Discord) reste affichable :
 * il ne dit rien de la personne hors de nos propres bases.
 */
export const COLONNES_PROFIL_PRIVEES: readonly string[] = Object.freeze([
  "email",
  "address_line1",
  "address_line2",
  "city",
  "postal_code",
  "country",
]);

/**
 * Colonnes de `profiles` que le bot a le droit de lire ET de montrer.
 *
 * Les requêtes de `/administration utilisateur` énumèrent ces colonnes une par
 * une : jamais de `SELECT *`. Un `*` recolle silencieusement l'e-mail dès
 * qu'une lecture est réutilisée ailleurs, et c'est exactement comme ça que
 * l'ancienne commande fuitait.
 */
export const COLONNES_PROFIL_AFFICHABLES: readonly string[] = Object.freeze([
  "id",
  "username",
  "full_name",
  "role",
  "discord_id",
  "avatar_url",
  "banner_url",
  "bio",
  "website",
  "twitter_handle",
  "patreon_id",
  "badges",
  "claimed_at",
  "updated_at",
]);

/** Vrai si cette colonne de `profiles` relève de la vie privée. */
export function estColonneProfilPrivee(nom: unknown): boolean {
  return typeof nom === "string" && COLONNES_PROFIL_PRIVEES.includes(nom.trim().toLowerCase());
}

/** Le strict nécessaire pour nommer un profil dans une liste. */
export interface ProfilAffichable {
  readonly id: string;
  readonly username?: string | null;
  readonly full_name?: string | null;
  readonly role?: string | null;
  readonly discord_id?: string | null;
}

/**
 * Comment nommer quelqu'un quand on n'a pas le droit d'écrire son e-mail.
 *
 * L'ancienne liste retombait sur `u.email` quand ni le nom ni le pseudo
 * n'étaient renseignés : la ligne la plus pauvre était donc celle qui exposait
 * le plus. On retombe ici sur l'uuid abrégé, qui identifie sans révéler.
 */
export function nomAffichable(profil: ProfilAffichable): string {
  const nom = profil.full_name?.trim() || profil.username?.trim() || "";
  return nom.length > 0 ? nom : abregerIdentifiant(profil.id);
}

/**
 * Une ligne de liste de profils : rôle, nom, pseudo, mention. Rien d'autre.
 *
 * Les pseudos Discord contiennent très souvent des `_` (`yoyo__goat`) : sans
 * échappement, `__goat__` passe en souligné et le pseudo affiché n'est plus
 * celui de la base. On réutilise l'échappement déjà testé de `/staff`.
 */
export function ligneProfil(profil: ProfilAffichable): string {
  const morceaux = [`\`${profil.role ?? "user"}\``, `**${echapperMarkdown(bornerValeur(nomAffichable(profil), 40))}**`];
  if (profil.username) {
    morceaux.push(`@${echapperMarkdown(bornerValeur(profil.username, 32))}`);
  }
  if (profil.discord_id) {
    morceaux.push(`<@${profil.discord_id}>`);
  }
  return `${morceaux.join(" ")}\n   └ \`${profil.id}\``;
}

// ─── Garde-fous des actions sur un profil ───────────────────────────────────

/**
 * Rôles auxquels le bot ne touche pas, et qu'il n'accorde pas.
 *
 * `superadmin` est le seul rôle qui peut promouvoir d'autres administrateurs
 * (cf. `USER_MANAGEMENT_ROLES` dans `@rosegriffon/types/roles`). Le laisser
 * s'accorder ou se retirer depuis un salon Discord ferait du jeton du bot un
 * chemin d'escalade de privilèges : celui qui obtient un accès admin Discord
 * obtiendrait le contrôle du site. Deux comptes le portent en production ;
 * ils se gèrent à la main, en base.
 */
export const ROLES_INTOUCHABLES: readonly string[] = Object.freeze(["superadmin"]);

export function estRoleIntouchable(role: unknown): boolean {
  return typeof role === "string" && ROLES_INTOUCHABLES.includes(role);
}

/**
 * Rôles réellement proposables dans la liste déroulante d'un CHANGEMENT de rôle.
 *
 * `ROLES_ASSIGNABLES` sert de vocabulaire de LECTURE : filtrer une liste sur
 * `superadmin` est légitime. Le proposer à l'écriture ne l'est pas —
 * `verifierActionSurProfil` le refuse toujours, et une option Discord qu'on ne
 * peut jamais appliquer fait taper la commande entière, cible comprise, pour ne
 * récolter qu'un refus. Retirer l'option ne remplace PAS le garde-fou : une
 * liste de choix est une suggestion côté client, la vérification reste faite au
 * moment d'écrire.
 */
export const ROLES_ATTRIBUABLES: readonly string[] = Object.freeze(
  ROLES_ASSIGNABLES.filter(role => !estRoleIntouchable(role)),
);

/** Autorisation accordée, ou refusée avec sa raison — jamais un simple booléen. */
export type Verdict = { readonly autorise: true } | { readonly autorise: false; readonly raison: string };

/**
 * Décide si une action d'administration sur un profil est recevable.
 *
 * Trois interdits, dans cet ordre :
 *   1. se modifier soi-même — se retirer son propre rôle ferme la porte de
 *      l'intérieur, et personne ne peut plus rien réparer depuis Discord ;
 *   2. toucher à un `superadmin` — voir `ROLES_INTOUCHABLES` ;
 *   3. accorder un `superadmin` — même raison, dans l'autre sens.
 * Puis deux vérifications de bon sens : le rôle doit exister en base, et
 * l'action ne doit pas être un coup dans l'eau.
 */
export function verifierActionSurProfil(params: {
  readonly acteurProfileId: string;
  readonly cibleProfileId: string;
  readonly roleCible: string | null | undefined;
  readonly nouveauRole?: string | null;
}): Verdict {
  if (params.acteurProfileId === params.cibleProfileId) {
    return {
      autorise: false,
      raison:
        "Tu ne peux pas agir sur ton propre profil depuis Discord : retirer son propre rôle " +
        "ferme la porte de l'intérieur. Demande à un autre administrateur.",
    };
  }
  if (estRoleIntouchable(params.roleCible)) {
    return {
      autorise: false,
      raison:
        `Ce profil est \`${params.roleCible}\` : le bot n'y touche pas. Ce rôle est le seul ` +
        "à pouvoir promouvoir d'autres administrateurs, il se gère à la main en base.",
    };
  }
  if (params.nouveauRole === undefined) {
    return { autorise: true };
  }
  if (estRoleIntouchable(params.nouveauRole)) {
    return {
      autorise: false,
      raison:
        "Le rôle `superadmin` ne s'accorde pas depuis Discord : ce serait faire du jeton du " +
        "bot un chemin d'escalade de privilèges vers le site.",
    };
  }
  if (!estRoleAssignable(params.nouveauRole)) {
    return {
      autorise: false,
      raison: `Rôle inconnu. Les rôles acceptés : ${ROLES_ASSIGNABLES.join(", ")}.`,
    };
  }
  if ((params.roleCible ?? "user") === params.nouveauRole) {
    return {
      autorise: false,
      raison: `Ce profil est déjà \`${params.nouveauRole}\` : il n'y a rien à changer.`,
    };
  }
  return { autorise: true };
}

// ─── Équipes : le libellé qui est VRAIMENT en base ──────────────────────────

/**
 * `team_members.team_name`, tel que la production le porte (relevé du
 * 13/8/2026, 127 lignes, un seul libellé par `team_id`).
 *
 * ⚠ Ce n'est PAS toujours le `nom` de `EQUIPES_RG` : pour `assoteam`, la base
 * et le site (`apps/website/src/app/admin/staff/teams.ts`) écrivent « Membres
 * de l'Association » là où l'ancien `/rg-team-admin` proposait « Association ».
 * Le bot insérait donc une ligne dont le `team_name` divergeait de ses dix
 * voisines. On écrit la valeur de la base, et on affiche la même partout.
 */
export const NOM_EQUIPE_EN_BASE: Readonly<Record<string, string>> = Object.freeze({
  bureauteam: "Bureau de l'Association",
  assoteam: "Membres de l'Association",
  loreteam: "Équipe Lore",
  dessinateurteam: "Équipe Dessinateur",
  productionteam: "Équipe Production",
  socialteam: "Équipe Réseaux",
  achilleateam: "Équipe Achilléa",
  azaleeteam: "Équipe Azalée",
  mediationteam: "Cellule de Médiation",
  collabteam: "Partenaires & Collaborateurs",
});

/** Libellé d'une équipe ; on retombe sur l'identifiant brut si on ne le connaît pas. */
export function libelleEquipeRg(valeur: unknown): string {
  if (typeof valeur !== "string") {
    return "équipe inconnue";
  }
  return NOM_EQUIPE_EN_BASE[valeur] ?? valeur;
}

/** Vrai si l'identifiant correspond à l'une des dix équipes. */
export function estEquipeRg(valeur: unknown): boolean {
  return typeof valeur === "string" && Object.hasOwn(NOM_EQUIPE_EN_BASE, valeur);
}

// ─── Validation des champs d'un membre d'équipe ─────────────────────────────

/**
 * Bornes reprises du formulaire du site (`apps/website/src/app/admin/staff/
 * staff-schema.ts`) : le bot et l'administration web écrivent dans la MÊME
 * table, une saisie acceptée d'un côté et refusée de l'autre est un bug.
 * `display_index` est un `smallint` : au-delà de 32 767, Postgres refuse
 * l'écriture et l'erreur remonte en pile d'appels dans le salon.
 */
export const LIMITES_MEMBRE_EQUIPE = Object.freeze({
  nom: 80,
  role: 80,
  lien: 500,
  image: 1_000,
  ordreMax: 32_767,
});

/** Valeur validée, ou refus motivé. */
export type ResultatValidation<T> =
  { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly raison: string };

/** Nom ou rôle affiché d'un membre : obligatoire, borné, sans espaces parasites. */
export function validerTexteMembre(champ: "nom" | "role", saisie: unknown): ResultatValidation<string> {
  const propre = typeof saisie === "string" ? saisie.trim() : "";
  const limite = champ === "nom" ? LIMITES_MEMBRE_EQUIPE.nom : LIMITES_MEMBRE_EQUIPE.role;
  if (propre.length === 0) {
    return { ok: false, raison: `Le ${champ} est obligatoire.` };
  }
  if (propre.length > limite) {
    return { ok: false, raison: `Le ${champ} ne doit pas dépasser ${limite} caractères.` };
  }
  return { ok: true, valeur: propre };
}

/**
 * URL facultative. Une chaîne vide vaut « efface la valeur », donc `null` —
 * c'est la convention du formulaire du site, et sans elle on ne peut jamais
 * retirer un lien devenu mort.
 */
export function validerUrlMembre(champ: "image" | "lien", saisie: unknown): ResultatValidation<string | null> {
  if (saisie === null || saisie === undefined) {
    return { ok: true, valeur: null };
  }
  const propre = typeof saisie === "string" ? saisie.trim() : "";
  if (propre.length === 0) {
    return { ok: true, valeur: null };
  }
  const limite = champ === "image" ? LIMITES_MEMBRE_EQUIPE.image : LIMITES_MEMBRE_EQUIPE.lien;
  if (propre.length > limite) {
    return { ok: false, raison: `L'URL (${champ}) ne doit pas dépasser ${limite} caractères.` };
  }
  if (!propre.startsWith("https://") && !propre.startsWith("http://")) {
    return { ok: false, raison: `L'URL (${champ}) doit commencer par http:// ou https://.` };
  }
  return { ok: true, valeur: propre };
}

/** Ordre d'affichage (`display_index`, smallint). Vide = « laisse la base décider ». */
export function validerOrdreAffichage(saisie: unknown): ResultatValidation<number | null> {
  if (saisie === null || saisie === undefined || saisie === "") {
    return { ok: true, valeur: null };
  }
  const nombre = typeof saisie === "number" ? saisie : Number(String(saisie).trim());
  if (!Number.isInteger(nombre)) {
    return { ok: false, raison: "L'ordre d'affichage doit être un nombre entier." };
  }
  if (nombre < 0 || nombre > LIMITES_MEMBRE_EQUIPE.ordreMax) {
    return {
      ok: false,
      raison: `L'ordre d'affichage doit tenir entre 0 et ${LIMITES_MEMBRE_EQUIPE.ordreMax}.`,
    };
  }
  return { ok: true, valeur: nombre };
}

/** Identifiant Discord facultatif : soit un flocon, soit rien. */
export function validerIdentifiantDiscordFacultatif(saisie: unknown): ResultatValidation<string | null> {
  if (saisie === null || saisie === undefined) {
    return { ok: true, valeur: null };
  }
  const propre = typeof saisie === "string" ? saisie.trim() : "";
  if (propre.length === 0) {
    return { ok: true, valeur: null };
  }
  if (!estIdentifiantDiscord(propre)) {
    return {
      ok: false,
      raison: "L'identifiant Discord doit être composé de 17 à 20 chiffres (clic droit › Copier l'identifiant).",
    };
  }
  return { ok: true, valeur: propre };
}

// ─── État porté par un bouton ───────────────────────────────────────────────

/** Longueur maximale d'un `custom_id` Discord. Au-delà, l'envoi ÉCHOUE. */
export const LIMITE_CUSTOM_ID = 100;

/**
 * Sérialise l'état d'une pagination dans le `custom_id` d'un bouton.
 *
 * Tout l'état tient dans l'identifiant : aucune mémoire de processus, donc un
 * redémarrage du bot ne laisse jamais de bouton mort. Les valeurs passent par
 * `encodeURIComponent` — une recherche contenant `|` ou `=` casserait sinon le
 * découpage et renverrait sur une page arbitraire.
 *
 * Rend `null` quand le résultat dépasserait les 100 caractères de Discord :
 * l'appelant affiche alors la page sans boutons plutôt que de voir tout son
 * message refusé par l'API.
 */
export function encoderEtatBouton(prefixe: string, champs: Readonly<Record<string, string | number>>): string | null {
  const morceaux = Object.entries(champs)
    .filter(([, valeur]) => valeur !== "" && valeur !== null && valeur !== undefined)
    .map(([clef, valeur]) => `${clef}=${encodeURIComponent(String(valeur))}`);
  const id = [prefixe, ...morceaux].join("|");
  return id.length > LIMITE_CUSTOM_ID ? null : id;
}

/** Relit un `custom_id` produit par `encoderEtatBouton`. `null` = pas à nous. */
export function decoderEtatBouton(prefixe: string, id: unknown): Record<string, string> | null {
  if (typeof id !== "string") {
    return null;
  }
  const morceaux = id.split("|");
  if (morceaux.shift() !== prefixe) {
    return null;
  }
  const champs: Record<string, string> = {};
  for (const morceau of morceaux) {
    const separation = morceau.indexOf("=");
    if (separation <= 0) {
      return null;
    }
    try {
      champs[morceau.slice(0, separation)] = decodeURIComponent(morceau.slice(separation + 1));
    } catch {
      // `decodeURIComponent` lève sur un `%` isolé : un identifiant forgé ne
      // doit pas faire tomber la commande.
      return null;
    }
  }
  return champs;
}
