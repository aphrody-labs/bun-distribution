/**
 * Registre canonique des routes du chrome applicatif.
 *
 * SOURCE UNIQUE, NON PARAMÉTRÉE. Ce module a longtemps exposé un objet
 * `NavBases` décrivant « où chaque app monte chaque domaine » : le wiki à la
 * racine d'azalee.rosegriffon.fr ou sous `/wiki` de rosegriffon.fr,
 * l'administration sous `/dashboard` ou `/admin`. L'app azalee autonome a été
 * supprimée ; il ne reste qu'un montage possible, et le paramétrage ne
 * produisait plus que des branches mortes — `if (bases.esport === undefined)`,
 * `bases.wiki ? … : []`, `surfacesNiers` toujours vrai — que personne ne
 * pouvait ni atteindre ni tester.
 *
 * Les points de montage sont donc des constantes, et les chemins du wiki et de
 * l'e-sport restent exprimés SANS préfixe (les composer reste un appel de
 * fonction, pas une concaténation recopiée à quinze endroits).
 */

/** Préfixe du wiki Azalée. */
export const BASE_WIKI = "/wiki";

/** Préfixe de l'e-sport Achilléa. */
export const BASE_ESPORT = "/achillea";

/** Racine de l'administration. */
export const BASE_ADMIN = "/admin";

/**
 * Compose un chemin du wiki avec son préfixe.
 *
 * `wiki("/")` doit rendre `/wiki` et jamais `""` : une chaîne vide n'est pas
 * une URL valide pour `next/link` et cassait silencieusement le lien d'accueil.
 */
export function wiki(chemin: string): string {
  return chemin === "/" ? BASE_WIKI : `${BASE_WIKI}${chemin}`;
}

/** Compose un chemin de l'e-sport avec son préfixe. */
export function esport(chemin: string): string {
  return chemin === "/" ? BASE_ESPORT : `${BASE_ESPORT}${chemin}`;
}

/**
 * Routes du wiki, exprimées SANS préfixe. Source unique pour la navigation, les
 * `activePaths` mobiles et les tests de non-régression des liens.
 */
export const CHEMINS_WIKI = [
  "/",
  "/cross",
  "/patch-notes",
  "/chara",
  "/skill",
  "/tactic",
  "/passive",
  "/aura",
  "/aura/esprits-guerriers",
  "/aura/totems",
  "/aura/miximax",
  "/aura/eveil",
  "/aura/changement-mode",
  "/equipe",
  "/entraineur",
  "/stade",
  "/item",
  "/boutique",
  "/capsule",
  "/invocation",
  "/drops",
  "/quete",
  "/niveau",
  "/succes",
  "/gallery",
  "/textures",
  "/sons",
  "/videos",
  "/modeles",
  "/keshin",
  "/mode",
  "/tools",
  "/tools/stats",
  "/tools/compare",
  "/tools/random-team",
  "/tools/my-team",
  "/tools/translator",
  "/save",
  "/demo",
] as const;

/**
 * Routes servies à la racine : elles ne prennent JAMAIS le préfixe du wiki.
 * Les préfixer était la cause des 404 sur `/wiki/news` et `/wiki/settings`.
 */
export const CHEMINS_RACINE = ["/news", "/settings", "/search", "/login"] as const;

/**
 * Routes de l'e-sport (Achilléa), exprimées SANS préfixe.
 *
 * Même raison d'être que `CHEMINS_WIKI` : la structure ne bouge pas, seul le
 * point de montage varie. Achilléa a vécu à la racine d'`achillea.rosegriffon.fr`
 * avant d'être monté sous `/achillea` ; exprimer les chemins relativement évite
 * de figer le second dans le menu.
 *
 * Seules les routes RÉELLEMENT servies figurent ici : `liens.test.ts` confronte
 * chaque entrée aux pages présentes sous `app/**`, et un lien sans page fait
 * échouer les tests plutôt que la production.
 */
export const CHEMINS_ESPORT = [
  "/",
  "/clans",
  "/clans/create",
  "/clans/dashboard",
  "/ranked",
  "/ranked/leaderboard",
  "/ranked/tiers",
  "/ranked/history",
  "/ranked/match",
  "/tournaments",
  "/tournaments/create",
  "/tournaments/circuit/ranking",
  "/leagues/astral",
  "/casts",
  "/licence",
  "/wallet",
  "/organizations/create",
  "/guide",
  "/guide/brand",
] as const;

/** Routes de l'espace association (portail Rose Griffon), montées à la racine. */
export const CHEMINS_ASSOCIATION = [
  "/",
  "/chroniques",
  "/news",
  "/evenements",
  "/shop",
  "/community",
  "/sondages",
  "/iergday",
  "/rose-griffon-tv",
  "/projets",
  "/a-propos",
  "/nous-soutenir",
  "/charte-engagements",
  "/cellule-de-mediation",
  "/emotes-showcase",
  "/epita-map",
] as const;

export type CheminWiki = (typeof CHEMINS_WIKI)[number];
export type CheminRacine = (typeof CHEMINS_RACINE)[number];
export type CheminEsport = (typeof CHEMINS_ESPORT)[number];
export type CheminAssociation = (typeof CHEMINS_ASSOCIATION)[number];

/** Le chemin est-il dans l'espace d'administration ? */
export function estSousAdministration(pathname: string): boolean {
  return pathname === BASE_ADMIN || pathname.startsWith(`${BASE_ADMIN}/`);
}
