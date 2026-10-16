/**
 * Client de l'API Noctaly — la partie PURE, celle qui décide.
 *
 * ── POURQUOI CE MODULE EXISTE SÉPARÉMENT DU SCRIPT D'IMPORT ────────────────
 * L'import parcourt ~1 834 membres en réseau : impossible à tester en vrai, et
 * hors de question de le lancer « pour voir ». Tout ce qui peut se tromper sans
 * réseau vit donc ici — lecture d'une réponse, lecture d'un quota, calcul de
 * l'attente, décision d'écrire ou non — et se teste en une milliseconde. Le
 * script (`scripts/import-noctaly.ts`) ne garde que la boucle et les `fetch`.
 *
 * ── LE 429 COÛTE UNE HEURE, PAS UNE SECONDE ────────────────────────────────
 * C'est LA contrainte qui dicte tout le reste. La documentation de Noctaly
 * (resources/rate-limits) annonce 50 requêtes/seconde, mais surtout :
 * « Applications that abuse the API or get too many 429s may be blacklisted »,
 * et le `retryAfter` de l'exemple vaut **3600**. Un dépassement ne coûte pas
 * une pause, il coûte l'après-midi — et potentiellement l'accès.
 *
 * ⚠ LA DOCUMENTATION EST FAUSSE, ET DANS LE MAUVAIS SENS. Mesuré le 14/8/2026
 * avec une vraie clé sur `level-profile` : les en-têtes annoncent
 * `X-RateLimit-Limit: 120` et `X-RateLimit-Reset-After: 60`, et le compteur
 * décroît d'une unité par requête. Le plafond réel est donc de **120 requêtes
 * par fenêtre de 60 secondes — 2 par seconde soutenues**, vingt-cinq fois moins
 * que les 50/s annoncés. Une cadence réglée sur la documentation vide le quota
 * en douze secondes puis passe le reste de l'import à attendre, en frôlant le
 * 429 à chaque redémarrage de fenêtre.
 *
 * D'où trois choix délibérément timides :
 *   1. la cadence par défaut suit la fenêtre MESURÉE, pas la documentation ;
 *   2. on s'arrête à `MARGE_QUOTA` requêtes de la limite au lieu d'aller la
 *      toucher, et on attend le `X-RateLimit-Reset-After` annoncé ;
 *   3. un 429 reçu malgré tout **interrompt l'import** au lieu de réessayer.
 *      Réessayer, c'est exactement le comportement qui fait blacklister ; et
 *      l'import est idempotent, donc reprendre plus tard ne coûte rien.
 *
 * ── AUCUNE E/S ICI ─────────────────────────────────────────────────────────
 * Pas de `fetch`, pas de `sql`, pas d'horloge implicite : `maintenant` est
 * toujours un paramètre. C'est ce qui rend le comportement de quota vérifiable.
 */

/** Base documentée de l'API (getting-started/quickstart). */
export const BASE_API_NOCTALY = "https://noctaly.com/api/v1";

/**
 * Plafond ANNONCÉ par la documentation, en requêtes par seconde.
 *
 * Conservé pour mémoire et comme borne haute d'une option `--cadence=` : il ne
 * décrit PAS le comportement réel du service. Voir `FENETRE_OBSERVEE`.
 */
export const PLAFOND_DOCUMENTE = 50;

/**
 * La fenêtre de quota réellement appliquée, relevée dans les en-têtes.
 *
 * 120 requêtes par 60 secondes, mesuré le 14/8/2026 sur la guilde Rose Griffon
 * (`X-RateLimit-Limit: 120`, `X-RateLimit-Reset-After: 60`, `Remaining` qui
 * décroît de 1 par appel). C'est cette valeur-là qui dicte la durée d'un
 * import : 1 834 membres ne peuvent pas descendre sous ~15 minutes.
 */
export const FENETRE_OBSERVEE = Object.freeze({ requetes: 120, secondes: 60 });

/**
 * Cadence retenue par défaut : 2 requêtes/seconde.
 *
 * C'est exactement le régime permanent de la fenêtre mesurée (120 / 60 s).
 * Aller plus vite ne fait pas gagner une seconde sur un import long — le quota
 * reprend tout ce qui a été gagné — mais transforme un débit régulier en dents
 * de scie qui frôlent le 429 à chaque fenêtre. Aller moins vite est possible
 * (`--cadence=1`) et ne coûte que du temps.
 */
export const CADENCE_DEFAUT = FENETRE_OBSERVEE.requetes / FENETRE_OBSERVEE.secondes;

/**
 * Combien de requêtes on se garde en réserve avant de considérer le quota
 * épuisé. À 0 on tape la limite au coup suivant ; à 2 on a de la marge pour
 * une requête en vol dont l'en-tête n'est pas encore revenu.
 */
export const MARGE_QUOTA = 2;

/** Marge ajoutée à l'attente annoncée par l'API, en millisecondes. */
export const MARGE_ATTENTE_MS = 250;

/** Le profil de niveau d'un membre, tel que le rend `GET …/level-profile`. */
export interface ProfilNoctaly {
  /** Niveau atteint sur la courbe de Noctaly (jamais écrit tel quel chez nous). */
  niveau: number;
  /** XP à l'intérieur du niveau courant. */
  xp: number;
  /** XP encore nécessaire pour monter. */
  xpRestante: number;
  /** XP cumulée depuis le début — la SEULE valeur qu'on importe. */
  xpTotale: number;
  messages: number;
  minutesVocal: number;
  reactions: number;
}

/**
 * Ce qu'une réponse HTTP veut dire pour la boucle d'import.
 *
 * `absent` est un cas NORMAL et fréquent : un membre qui n'a jamais parlé
 * depuis l'activation de Noctaly (11/3/2026) n'a pas de profil. Le distinguer
 * d'une panne évite de compter 1 700 « erreurs » là où il n'y a que des
 * silences.
 *
 * `module-desactive` est le cas qui fait gagner le plus de temps : il ne dit
 * pas « ce membre n'a rien », il dit « CE MODULE n'existe pas sur ce serveur ».
 * Une seule réponse suffit alors à abandonner toute une passe. Voir
 * `CODE_MODULE_DESACTIVE`.
 */
export type Issue = "ok" | "absent" | "module-desactive" | "refuse" | "quota" | "panne";

/**
 * Le code d'erreur applicatif que rend Noctaly quand un module est éteint.
 *
 * Relevé le 14/8/2026 sur la guilde Rose Griffon :
 *   GET /guilds/<id>/items   → 400 {"code":"module_disabled","message":"This module is disabled."}
 *
 * Le statut HTTP seul (400) ne se distingue pas d'une requête malformée : c'est
 * le corps qui porte l'information, d'où le second paramètre de
 * `classerReponse`.
 */
export const CODE_MODULE_DESACTIVE = "module_disabled";

/**
 * Lit le code d'erreur applicatif d'un corps de réponse, s'il y en a un.
 * Rend `null` pour un corps absent, illisible ou sans code.
 */
export function codeErreur(corps: unknown): string | null {
  if (typeof corps !== "object" || corps === null) {
    return null;
  }
  const code = (corps as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

export function classerReponse(statut: number, corps?: unknown): Issue {
  if (statut === 200) {
    return "ok";
  }
  if (statut === 404) {
    return "absent";
  }
  if (statut === 401 || statut === 403) {
    return "refuse";
  }
  if (statut === 429) {
    return "quota";
  }
  if (statut === 400 && codeErreur(corps) === CODE_MODULE_DESACTIVE) {
    return "module-desactive";
  }
  return "panne";
}

/** L'URL du profil de niveau d'un membre. */
export function urlProfilNiveau(guildId: string, discordId: string): string {
  return `${BASE_API_NOCTALY}/guilds/${guildId}/users/${discordId}/level-profile`;
}

/**
 * Lit le corps JSON d'un profil.
 *
 * Rend `null` plutôt que de lever : une réponse inattendue sur UN membre ne
 * doit pas faire tomber un import de 1 834 membres. Le membre est compté comme
 * illisible, la boucle continue.
 *
 * La validation est délibérément stricte sur `totalXp` (c'est la seule valeur
 * qu'on écrit) et tolérante sur le reste : Noctaly peut ajouter un champ, ou
 * en omettre un sur un profil neuf, sans que ça nous regarde.
 */
/** Un entier positif, ou zéro — pour les champs annexes qu'on n'écrit pas. */
function entier(valeur: unknown): number {
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= 0 ? Math.floor(valeur) : 0;
}

export function lireProfil(brut: unknown): ProfilNoctaly | null {
  if (typeof brut !== "object" || brut === null) {
    return null;
  }
  const objet = brut as Record<string, unknown>;
  const xpTotale = objet.totalXp;
  if (typeof xpTotale !== "number" || !Number.isFinite(xpTotale) || xpTotale < 0) {
    return null;
  }
  return {
    messages: entier(objet.messages),
    minutesVocal: entier(objet.voiceMinutes),
    niveau: entier(objet.level),
    reactions: entier(objet.reactions),
    xp: entier(objet.xp),
    xpRestante: entier(objet.neededXp),
    xpTotale: Math.floor(xpTotale),
  };
}

/**
 * Le profil d'économie d'un membre (`GET …/eco-profile`).
 *
 * Par défaut l'API ne rend que `money` ; les trois relations optionnelles se
 * demandent en query (`?items=true&chests=true&dailyStreak=true`). On les
 * demande TOUTES : c'est la même requête, et ce qu'on ne demande pas est
 * perdu — un import ne se rejoue pas quand le bot tiers a été retiré.
 */
export interface ProfilEconomieNoctaly {
  monnaie: number;
  /** Série de récupérations quotidiennes, `null` si jamais réclamée. */
  serieQuotidienne: number | null;
  /** Nombre d'objets distincts détenus (le détail vit dans l'archive brute). */
  objets: number;
  /** Nombre de coffres distincts détenus. */
  coffres: number;
}

/** L'URL du profil d'économie, avec les trois relations optionnelles. */
export function urlProfilEconomie(guildId: string, discordId: string): string {
  return (
    `${BASE_API_NOCTALY}/guilds/${guildId}/users/${discordId}/eco-profile` + `?items=true&chests=true&dailyStreak=true`
  );
}

/** L'URL du catalogue d'objets de la guilde — une seule requête pour tout. */
export function urlObjetsGuilde(guildId: string): string {
  return `${BASE_API_NOCTALY}/guilds/${guildId}/items`;
}

/** L'URL du catalogue de coffres de la guilde. */
export function urlCoffresGuilde(guildId: string): string {
  return `${BASE_API_NOCTALY}/guilds/${guildId}/chests`;
}

/**
 * Lit un profil d'économie.
 *
 * `money` est le seul champ garanti par la documentation ; les trois autres
 * n'apparaissent que si la query les demande, et `dailyStreak` peut valoir
 * `null` (membre qui n'a jamais réclamé). Un profil à zéro reste un profil
 * valide — c'est `meriteEcritureEconomie` qui décide s'il vaut une ligne.
 */
export function lireProfilEconomie(brut: unknown): ProfilEconomieNoctaly | null {
  if (typeof brut !== "object" || brut === null) {
    return null;
  }
  const objet = brut as Record<string, unknown>;
  const monnaie = objet.money;
  if (typeof monnaie !== "number" || !Number.isFinite(monnaie)) {
    return null;
  }
  const serie = objet.dailyStreak;
  return {
    coffres: Array.isArray(objet.chests) ? objet.chests.length : 0,
    monnaie: Math.max(0, Math.floor(monnaie)),
    objets: Array.isArray(objet.items) ? objet.items.length : 0,
    serieQuotidienne:
      typeof serie === "object" && serie !== null
        ? entier((serie as Record<string, unknown>).streak ?? (serie as Record<string, unknown>).count)
        : null,
  };
}

/**
 * Convertit une monnaie Noctaly en jetons Kizuna.
 *
 * ── POURQUOI UN TAUX EXPLICITE, ET PAS UN 1:1 IMPLICITE ────────────────────
 * Les deux monnaies n'ont RIEN en commun : un jeton Kizuna se gagne à 25/jour
 * (+5 par jour de série, plafonné à +50) et un recrutement en coûte 150 ; la
 * monnaie Noctaly suit une configuration de serveur qu'on ne connaît pas avant
 * de l'avoir lue. Reporter un solde 1:1 sans regarder, c'est risquer d'offrir
 * cent recrutements à quelqu'un — ou trois.
 *
 * Le taux est donc un paramètre, le défaut est 1, et l'import se lance
 * d'abord en `--essai` pour voir la distribution réelle avant d'écrire.
 */
export function convertirMonnaie(monnaie: number, taux: number): number {
  if (!Number.isFinite(monnaie) || monnaie <= 0 || !Number.isFinite(taux) || taux <= 0) {
    return 0;
  }
  return Math.floor(monnaie * taux);
}

/** Un profil d'économie vaut une écriture s'il porte quelque chose. */
export function meriteEcritureEconomie(profil: ProfilEconomieNoctaly): boolean {
  return profil.monnaie > 0 || (profil.serieQuotidienne ?? 0) > 0;
}

/**
 * Résume une distribution de soldes, pour décider du taux en connaissance de
 * cause. La médiane compte plus que la moyenne : un seul gros solde tire la
 * moyenne, pas la médiane.
 */
export function distribution(valeurs: readonly number[]): {
  compte: number;
  total: number;
  median: number;
  maximum: number;
} {
  const triees = valeurs.filter(valeur => valeur > 0).toSorted((a, b) => a - b);
  if (triees.length === 0) {
    return { compte: 0, maximum: 0, median: 0, total: 0 };
  }
  const milieu = Math.floor(triees.length / 2);
  const median =
    triees.length % 2 === 0
      ? Math.floor(((triees[milieu - 1] ?? 0) + (triees[milieu] ?? 0)) / 2)
      : (triees[milieu] ?? 0);
  return {
    compte: triees.length,
    maximum: triees.at(-1) ?? 0,
    median,
    total: triees.reduce((somme, valeur) => somme + valeur, 0),
  };
}

/** L'état du quota tel qu'annoncé par les en-têtes de la dernière réponse. */
export interface Quota {
  limite: number | null;
  restant: number | null;
  /** Secondes avant remise à zéro, d'après `X-RateLimit-Reset-After`. */
  dansSecondes: number | null;
}

/** Une source d'en-têtes — `Headers` en vrai, un objet simple dans les tests. */
export interface SourceEnTetes {
  get(nom: string): string | null;
}

export function lireQuota(entetes: SourceEnTetes): Quota {
  const nombre = (nom: string): number | null => {
    const brut = entetes.get(nom);
    if (brut === null || brut.trim() === "") {
      return null;
    }
    const valeur = Number(brut);
    return Number.isFinite(valeur) ? valeur : null;
  };
  return {
    dansSecondes: nombre("X-RateLimit-Reset-After"),
    limite: nombre("X-RateLimit-Limit"),
    restant: nombre("X-RateLimit-Remaining"),
  };
}

/**
 * Combien de millisecondes attendre avant la requête suivante.
 *
 * Deux régimes, et le second l'emporte :
 *   - régime normal : l'intervalle de la cadence choisie ;
 *   - quota au plancher : l'attente annoncée par l'API, plus une marge.
 *
 * On prend le MAXIMUM des deux et non le premier venu : si l'API dit d'attendre
 * 40 s alors que la cadence dirait 100 ms, c'est l'API qui a raison.
 */
export function attenteAvantSuivante(quota: Quota, cadence: number = CADENCE_DEFAUT): number {
  const parCadence = Math.ceil(1_000 / Math.max(1, Math.min(PLAFOND_DOCUMENTE, cadence)));
  if (quota.restant !== null && quota.restant <= MARGE_QUOTA && quota.dansSecondes !== null) {
    return Math.max(parCadence, Math.ceil(quota.dansSecondes * 1_000) + MARGE_ATTENTE_MS);
  }
  return parCadence;
}

/**
 * Faut-il écrire une ligne pour ce profil ?
 *
 * Non si l'XP totale est nulle : un membre qui n'a jamais rien gagné chez
 * Noctaly n'a rien à importer, et créer sa ligne à zéro ne ferait qu'ajouter
 * 1 500 lignes vides au classement. Le profil se créera tout seul à son premier
 * message chez nous (`ajouterExperience`), avec la bonne date.
 */
export function meriteEcriture(profil: ProfilNoctaly): boolean {
  return profil.xpTotale > 0;
}

/** Le décompte d'un import, tel qu'on le rend à la fin. */
export interface Bilan {
  interroges: number;
  ecrits: number;
  vides: number;
  absents: number;
  illisibles: number;
  pannes: number;
  /** Profils d'économie porteurs de quelque chose (monnaie ou série). */
  economies: number;
  /** Lignes d'archive brute écrites — une par membre ayant répondu. */
  archives: number;
  /**
   * Profils repris du classement public faute de réponse d'API.
   *
   * Compté à part parce que ce n'est pas la même qualité de donnée : le
   * classement ne porte pas l'XP intra-niveau, et il date du dernier rendu de
   * la page. Savoir combien de lignes en viennent, c'est savoir ce qu'un import
   * ultérieur avec clé aurait encore à affiner.
   */
  classes: number;
}

export function bilanVide(): Bilan {
  return {
    absents: 0,
    archives: 0,
    classes: 0,
    economies: 0,
    ecrits: 0,
    illisibles: 0,
    interroges: 0,
    pannes: 0,
    vides: 0,
  };
}

/**
 * Le message de fin, en une phrase lisible.
 *
 * Rendu par une fonction pure plutôt qu'assemblé dans le script : c'est le
 * seul résultat que l'opérateur va lire, et il doit rester juste même quand
 * une catégorie est à zéro.
 */
export function resumerBilan(bilan: Bilan): string {
  const morceaux = [
    `${bilan.interroges} membre(s) interrogé(s)`,
    `${bilan.ecrits} profil(s) importé(s)`,
    `${bilan.vides} sans XP`,
    `${bilan.absents} inconnu(s) de Noctaly`,
  ];
  if (bilan.classes > 0) {
    morceaux.push(`${bilan.classes} repris du classement public`);
  }
  if (bilan.economies > 0) {
    morceaux.push(`${bilan.economies} économie(s)`);
  }
  if (bilan.archives > 0) {
    morceaux.push(`${bilan.archives} archive(s) brute(s)`);
  }
  if (bilan.illisibles > 0) {
    morceaux.push(`${bilan.illisibles} réponse(s) illisible(s)`);
  }
  if (bilan.pannes > 0) {
    morceaux.push(`${bilan.pannes} erreur(s) réseau`);
  }
  return morceaux.join(" · ");
}

/**
 * Le message d'aide quand la clé manque.
 *
 * Une clé Noctaly s'obtient par une connexion humaine au tableau de bord, cet
 * agent ne peut pas la générer. Autant dire précisément où cliquer plutôt que
 * « clé manquante ».
 *
 * ⚠ Une clé déjà créée n'est PLUS lisible : le tableau de bord la rend masquée
 * (`"key":"DNKt***…"`, relevé le 14/8/2026 dans la charge serveur de
 * `/fr/dashboard/<guilde>/settings`). Voir une clé dans la liste ne dispense
 * donc pas d'en créer une nouvelle — la valeur complète n'est affichée qu'une
 * fois, à la création.
 */
export const AIDE_CLE_MANQUANTE = [
  "NOCTALY_API_KEY manquante.",
  "  1. https://noctaly.com/dashboard?next=/settings (compte avec « Gérer le serveur »)",
  "  2. sélectionner Rose Griffon → Paramètres → « Développeurs (Avancé) » → « Créer une clé API »",
  "  3. copier la valeur AU MOMENT DE LA CRÉATION (elle n'est plus jamais affichée en clair)",
  "  4. la poser dans apps/bot/.env :  NOCTALY_API_KEY=…",
  "Sans clé, l'import se rabat sur le classement public : voir SOURCE_CLASSEMENT.",
].join("\n");

// ─────────────────────────────────────────────────────────────────────────────
// SECONDE SOURCE : LE CLASSEMENT PUBLIC
// ─────────────────────────────────────────────────────────────────────────────
//
// ── POURQUOI UNE SECONDE SOURCE ────────────────────────────────────────────
// L'API officielle exige une clé, et une clé exige une connexion humaine au
// tableau de bord. Tant qu'elle manque, l'import ne pouvait RIEN faire : le
// script sortait en erreur. C'était dommage, parce que Noctaly publie déjà
// l'essentiel sans authentification.
//
// La page `/{locale}/leaderboard/{guildId}` est publique, et son rendu serveur
// embarque les CENT premiers profils dans sa charge React (prop `initProfiles`)
// avec exactement les champs que la route `level-profile` rend par membre :
//
//   {"userID":"…","username":"…","avatarID":"…",
//    "level":26,"xp":44480,"messages":4977,"reactions":231,"voiceMinutes":298}
//
// ── CENT PROFILS SUFFISENT, ET CE N'EST PAS UN COMPROMIS ───────────────────
// Relevé le 14/8/2026 sur la guilde Rose Griffon : le 1er a 44 480 XP, le 51e
// en a 500, et le CENTIÈME en a 120 — soit le niveau 0. Au-delà du centième il
// n'y a donc rien de significatif à importer, et `meriteEcriture()` refuserait
// de toute façon d'écrire une ligne pour un profil sans XP. Cette source ne
// couvre pas « les 100 premiers sur 1 902 » : elle couvre **tout le monde qui a
// jamais gagné quelque chose**.
//
// ── LE TRI ÉLARGIT LA COUVERTURE ───────────────────────────────────────────
// La page accepte un paramètre de tri (`?sort=`). Un membre très bavard mais
// peu gradé peut sortir du top 100 par XP tout en figurant dans le top 100 par
// messages. Interroger les quatre tris et fusionner coûte quatre requêtes et ne
// peut que compléter — jamais dégrader, puisque la fusion garde le maximum.
//
// ── CE QUE CETTE SOURCE NE DONNE PAS ───────────────────────────────────────
// L'XP À L'INTÉRIEUR du niveau courant (`xp`) et le reste à parcourir
// (`neededXp`). Ces deux valeurs ne sont ni écrites ni lues par l'import : il
// ne reporte que `xpTotale`, relue ensuite sur la courbe DU JEU par
// `niveauPour()`. Leur absence ne coûte donc rien.

/** Les quatre tris acceptés par la page de classement. */
export const TRIS_CLASSEMENT = ["level", "messages", "voice", "reactions"] as const;

export type TriClassement = (typeof TRIS_CLASSEMENT)[number];

/** Marqueur de provenance, pour les journaux et les bilans. */
export const SOURCE_CLASSEMENT = "classement public";

/** URL de la page de classement d'une guilde. */
export function urlClassementPublic(guildId: string, tri?: TriClassement): string {
  const base = `https://noctaly.com/fr/leaderboard/${guildId}`;
  return tri === undefined ? base : `${base}?sort=${tri}`;
}

/** Un profil lu dans le classement, avec l'identité que la page publie. */
export interface ProfilClasse {
  discordId: string;
  pseudo: string;
  /** Empreinte d'avatar Discord, `null` si le membre n'en a pas. */
  avatarId: string | null;
  profil: ProfilNoctaly;
  /** L'entrée BRUTE, telle que la page l'a publiée — c'est elle qu'on archive. */
  brut: unknown;
}

/**
 * Reconstitue la charge React d'une page Next à partir de son HTML.
 *
 * Next dépose son rendu serveur par morceaux, en appels
 * `self.__next_f.push([1,"<fragment échappé>"])`. Un objet peut être coupé
 * entre deux fragments : on les concatène TOUS avant de chercher quoi que ce
 * soit, sinon une charge un peu longue se lit à moitié.
 *
 * Seuls les appels de type `1` portent du texte ; les autres transportent des
 * marqueurs de flux et casseraient la lecture s'ils étaient concaténés.
 */
export function extraireFluxRsc(html: string): string {
  const morceaux: string[] = [];
  for (const trouve of html.matchAll(/self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      morceaux.push(JSON.parse(`"${trouve[1]}"`) as string);
    } catch {
      // Un fragment illisible ne doit pas emporter les autres : la page reste
      // exploitable tant que celui qui porte `initProfiles` est intact.
    }
  }
  return morceaux.join("");
}

/**
 * Extrait le tableau JSON qui suit `"<clef>":[` dans un texte.
 *
 * Lecture À CROCHETS ÉQUILIBRÉS plutôt qu'expression régulière : les entrées
 * contiennent des pseudonymes arbitraires, donc potentiellement des crochets et
 * des accolades. Une regex gourmande avalerait la moitié de la page, une regex
 * paresseuse s'arrêterait au premier `]` venu.
 *
 * Les crochets à l'intérieur d'une CHAÎNE sont ignorés — sans quoi un pseudo
 * comme « [RG] Yoyo » ferait fermer le tableau trop tôt.
 */
export function extraireTableau(source: string, clef: string): string | null {
  const marque = `"${clef}":[`;
  const debut = source.indexOf(marque);
  if (debut < 0) {
    return null;
  }
  const ouvrant = debut + marque.length - 1;
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;
  for (let i = ouvrant; i < source.length; i++) {
    const caractere = source[i]!;
    if (dansChaine) {
      if (echappe) {
        echappe = false;
      } else if (caractere === "\\") {
        echappe = true;
      } else if (caractere === '"') {
        dansChaine = false;
      }
      continue;
    }
    if (caractere === '"') {
      dansChaine = true;
    } else if (caractere === "[") {
      profondeur++;
    } else if (caractere === "]") {
      profondeur--;
      if (profondeur === 0) {
        return source.slice(ouvrant, i + 1);
      }
    }
  }
  return null;
}

/**
 * Lit une entrée du classement.
 *
 * Même exigence que `lireProfil` : on est strict sur la seule valeur qu'on
 * écrira (`xp`, qui est ici l'XP TOTALE — 44 480 pour un niveau 26, donc pas
 * l'XP intra-niveau), tolérant sur le reste. Une entrée illisible est ignorée,
 * elle ne fait pas tomber les 99 autres.
 */
function lireEntreeClassement(brut: unknown): ProfilClasse | null {
  if (typeof brut !== "object" || brut === null) {
    return null;
  }
  const objet = brut as Record<string, unknown>;
  const discordId = objet.userID;
  const xpTotale = objet.xp;
  if (typeof discordId !== "string" || !/^\d{15,25}$/.test(discordId)) {
    return null;
  }
  if (typeof xpTotale !== "number" || !Number.isFinite(xpTotale) || xpTotale < 0) {
    return null;
  }
  return {
    avatarId: typeof objet.avatarID === "string" ? objet.avatarID : null,
    brut,
    discordId,
    profil: {
      messages: entier(objet.messages),
      minutesVocal: entier(objet.voiceMinutes),
      niveau: entier(objet.level),
      reactions: entier(objet.reactions),
      // Le classement ne publie ni l'XP intra-niveau ni le reste à parcourir.
      // L'import ne s'en sert pas : il ne reporte que `xpTotale`.
      xp: 0,
      xpRestante: 0,
      xpTotale: Math.floor(xpTotale),
    },
    pseudo: typeof objet.username === "string" ? objet.username : discordId,
  };
}

/**
 * Lit tous les profils d'une page de classement.
 *
 * Rend un tableau VIDE plutôt que de lever quand la page ne contient pas de
 * classement : une guilde sans module de niveaux, une page d'erreur ou un
 * défi Cloudflare rendent tous du HTML parfaitement valide, et l'appelant doit
 * pouvoir le distinguer d'une panne — c'est le nombre de profils qui le dit.
 */
export function lireClassement(html: string): ProfilClasse[] {
  const flux = extraireFluxRsc(html);
  const tableau = extraireTableau(flux, "initProfiles");
  if (tableau === null) {
    return [];
  }
  let entrees: unknown;
  try {
    entrees = JSON.parse(tableau);
  } catch {
    return [];
  }
  if (!Array.isArray(entrees)) {
    return [];
  }
  return entrees
    .map(entree => lireEntreeClassement(entree))
    .filter((entree): entree is ProfilClasse => entree !== null);
}

/**
 * Fusionne plusieurs classements en gardant, pour chaque membre, le MAXIMUM de
 * chaque compteur.
 *
 * Le maximum et non le dernier vu : les quatre tris sont quatre instantanés du
 * même état, pris à quelques secondes d'intervalle. Ils devraient coïncider —
 * mais si l'un d'eux est tronqué ou plus ancien, prendre le maximum garantit
 * qu'aucune valeur ne régresse. C'est la même règle que le `GREATEST` du SQL
 * d'import, appliquée un cran plus tôt.
 */
export function fusionnerClassements(listes: readonly (readonly ProfilClasse[])[]): ProfilClasse[] {
  const parMembre = new Map<string, ProfilClasse>();
  for (const liste of listes) {
    for (const entree of liste) {
      const connu = parMembre.get(entree.discordId);
      if (!connu) {
        parMembre.set(entree.discordId, entree);
        continue;
      }
      parMembre.set(entree.discordId, {
        avatarId: entree.avatarId ?? connu.avatarId,
        // On garde le brut de l'instantané le plus riche en XP : c'est celui
        // qui fera foi dans l'archive.
        brut: entree.profil.xpTotale >= connu.profil.xpTotale ? entree.brut : connu.brut,
        discordId: connu.discordId,
        profil: {
          messages: Math.max(connu.profil.messages, entree.profil.messages),
          minutesVocal: Math.max(connu.profil.minutesVocal, entree.profil.minutesVocal),
          niveau: Math.max(connu.profil.niveau, entree.profil.niveau),
          reactions: Math.max(connu.profil.reactions, entree.profil.reactions),
          xp: 0,
          xpRestante: 0,
          xpTotale: Math.max(connu.profil.xpTotale, entree.profil.xpTotale),
        },
        pseudo: entree.pseudo || connu.pseudo,
      });
    }
  }
  return [...parMembre.values()].toSorted((a, b) => b.profil.xpTotale - a.profil.xpTotale);
}
