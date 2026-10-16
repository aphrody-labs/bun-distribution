/**
 * Recherche unifiée sur les trois domaines du réseau Rose Griffon.
 *
 * ── POURQUOI CE PAQUET EXISTE ───────────────────────────────────────────────
 * Le site portait quatre recherches qui s'ignoraient : la barre globale
 * (`/search`) ne lisait QUE la table `articles` du portail — trois résultats
 * maximum, aucun personnage du wiki, aucun clan Achilléa. Les autres barres
 * (wiki, dialogue de personnages, actualités) vivaient chacune dans son app,
 * avec sa requête et son format de résultat. Chercher « Axel » depuis l'accueil
 * ne trouvait rien alors que le wiki a la fiche.
 *
 * RG and Achillea share Supabase PostgreSQL; gameplay lives in Neon.
 * Each store receives its own SQL union, then results share one presentation sort.
 *
 * ── MODULE PUR ──────────────────────────────────────────────────────────────
 * Aucune dépendance, aucune E/S : l'exécuteur SQL est INJECTÉ. Le paquet ne
 * connaît ni `pg`, ni Bun, ni Next — il construit une requête et met en forme
 * des lignes. C'est ce qui permet de le couvrir par `bun test` sans base, et de
 * l'appeler aussi bien depuis un Server Component que depuis une route.
 */

/** Domaines interrogeables, dans l'ordre de priorité d'affichage. */
export const DOMAINES_RECHERCHE = ["association", "wiki", "esport"] as const;

export type DomaineRecherche = (typeof DOMAINES_RECHERCHE)[number];

export type TypeResultat =
  | "article"
  | "personnage"
  | "basara"
  | "technique"
  | "objet"
  | "tactique"
  | "keshin"
  | "totem"
  | "miximax"
  | "eveil"
  | "changement-mode"
  | "aura"
  | "equipe"
  | "patchnote"
  | "clan"
  | "joueur"
  | "evenement";

/** Libellés communs aux cartes de recherche et à la palette rapide. */
export const LIBELLES_TYPES_RECHERCHE: Record<TypeResultat, string> = {
  article: "Actualité",
  aura: "Aura",
  basara: "Joueur BASARA",
  "changement-mode": "Changement de mode",
  clan: "Clan",
  equipe: "Équipe",
  evenement: "Tournoi",
  eveil: "Éveil",
  joueur: "Joueur",
  keshin: "Esprit guerrier",
  miximax: "Miximax",
  objet: "Objet",
  patchnote: "Note de mise à jour",
  personnage: "Personnage",
  tactique: "Tactique",
  technique: "Technique",
  totem: "Totem",
};

export interface ResultatRecherche {
  id: string;
  titre: string;
  /** URL absolue dans le site unifié, déjà préfixée par le domaine. */
  href: string;
  type: TypeResultat;
  domaine: DomaineRecherche;
  /** Second niveau d'information (tag de clan, catégorie…). */
  detail?: string;
}

/** Une source = une table, sa colonne de libellé, et comment en faire une URL. */
interface Source {
  store?: "inagle";
  domaine: DomaineRecherche;
  type: TypeResultat;
  /** Expression SQL de la table, schéma compris. */
  table: string;
  /** Colonne portant le libellé cherché. */
  colonneTitre: string;
  /** Colonnes cherchées ensemble, sans dupliquer la branche SQL de la table. */
  colonnesRecherche?: readonly string[];
  /** Colonne servant à bâtir l'URL (souvent `slug`, parfois `id`). */
  colonneCle: string;
  /** Colonne facultative de détail. */
  colonneDetail?: string;
  /** Filtre SQL additionnel, sans le `AND` initial. */
  filtre?: string;
  /** Classe les lignes d'une table partagée dans le domaine réel de l'article. */
  domainePourLigne?: (detail: string | null) => DomaineRecherche;
  /** Certaines tables portent plusieurs types dans une colonne de catégorie. */
  typePourLigne?: (detail: string | null) => TypeResultat;
  /** Construit l'URL depuis la clé. */
  href: (cle: string, bases: BasesRecherche, detail: string | null) => string;
}

/** Points de montage des domaines, pour préfixer les URL. */
export interface BasesRecherche {
  wiki: string;
  esport: string;
  association: string;
}

export const BASES_PAR_DEFAUT: BasesRecherche = {
  association: "",
  esport: "/achillea",
  wiki: "/wiki",
};

/**
 * Les sources interrogées.
 *
 * L'e-sport lit le schéma `achillea` de la MÊME base : depuis la fusion, ce ne
 * sont plus des tables étrangères mais les tables réelles où le bot écrit.
 */
const SOURCES: readonly Source[] = [
  {
    colonneCle: "slug",
    colonneDetail: "app",
    colonneTitre: "title",
    colonnesRecherche: ["title", "content", "excerpt"],
    domaine: "association",
    domainePourLigne: detail => (detail === "azalee" ? "wiki" : "association"),
    filtre: "status = 'published'",
    href: cle => `/news/${cle}`,
    table: "public.articles",
    type: "article",
  },
  {
    colonneCle: "slug",
    colonneTitre: "COALESCE(name_fr, name_en, name_ja)",
    colonnesRecherche: ["name_fr", "name_en", "name_ja"],
    colonneDetail: "rarity_label",
    domaine: "wiki",
    href: (cle, bases) => `${bases.wiki}/chara/${cle}`,
    table: "public.inagle_characters",
    store: "inagle",
    type: "personnage",
    typePourLigne: detail => (detail === "BASARA" ? "basara" : "personnage"),
  },
  {
    colonneCle: "id",
    colonneTitre: "COALESCE(name_fr, name_en, name_ja)",
    colonnesRecherche: ["name_fr", "name_en", "name_ja"],
    domaine: "wiki",
    href: (cle, bases) => `${bases.wiki}/skill/${cle}`,
    table: "public.inagle_skills",
    store: "inagle",
    type: "technique",
  },
  {
    colonneCle: "CASE WHEN category = 'special_tactics' THEN COALESCE(internal_code, id) ELSE id END",
    colonneTitre: "COALESCE(name_fr, name_en, name_ja)",
    colonnesRecherche: ["name_fr", "name_en", "name_ja"],
    colonneDetail: "category",
    domaine: "wiki",
    href: (cle, bases, detail) =>
      detail === "special_tactics" ? `${bases.wiki}/tactic/${cle}` : `${bases.wiki}/item/${cle}`,
    table: "public.inagle_items",
    store: "inagle",
    type: "objet",
    typePourLigne: detail => (detail === "special_tactics" ? "tactique" : "objet"),
  },
  {
    colonneCle: "id",
    colonneTitre: "name",
    domaine: "esport",
    href: (cle, bases) => `${bases.esport}/clans/${cle}`,
    table: "achillea.clan",
    type: "clan",
  },
  {
    colonneCle: "id",
    colonneDetail: "display_name",
    colonneTitre: "username",
    domaine: "esport",
    href: (cle, bases) => `${bases.esport}/users/${cle}`,
    table: 'achillea."user"',
    type: "joueur",
  },
  {
    colonneCle: "id",
    colonneDetail: "status",
    colonneTitre: "name",
    domaine: "esport",
    href: (cle, bases) => `${bases.esport}/tournaments/${cle}`,
    table: "achillea.event",
    type: "evenement",
  },
  ...(
    [
      ["inagle_keshins_clean", "keshin", "esprits-guerriers"],
      ["inagle_souls_clean", "totem", "totems"],
      ["inagle_miximax_clean", "miximax", "miximax"],
      ["inagle_awakenings_clean", "eveil", "eveil"],
      ["inagle_mode_changes_clean", "changement-mode", "changement-mode"],
      ["inagle_auras", "aura", "autres"],
    ] as const
  ).map(([table, type, categorie]) => ({
    colonneCle: "id",
    colonneTitre: "COALESCE(name_fr, name_en, name_ja)",
    colonnesRecherche: ["name_fr", "name_en", "name_ja"],
    domaine: "wiki" as const,
    href: (cle: string, bases: BasesRecherche) => `${bases.wiki}/aura/${categorie}/${cle}`,
    table: `public.${table}`,
    store: "inagle" as const,
    type,
  })),
  {
    colonneCle: "id",
    colonneTitre: "COALESCE(name_fr, name_en, name_ja)",
    colonnesRecherche: ["name_fr", "name_en", "name_ja"],
    domaine: "wiki",
    href: (cle, bases) => `${bases.wiki}/equipe/${cle}`,
    table: "public.inagle_teams",
    store: "inagle",
    type: "equipe",
  },
  {
    colonneCle: "id",
    colonneTitre: "COALESCE(title_fr, title)",
    colonnesRecherche: ["title_fr", "title"],
    domaine: "wiki",
    href: (cle, bases) => `${bases.wiki}/patch-notes/${cle}`,
    table: "public.patch_notes",
    type: "patchnote",
  },
] as const;

/** Longueur minimale d'une requête. En deçà, `%a%` ramène la base entière. */
export const LONGUEUR_MINIMALE = 2;

export interface LigneBrute {
  id: string;
  titre: string;
  detail: string | null;
  source: string;
}

/**
 * Construit la requête d'union.
 *
 * UNE SEULE requête : des allers-retours séparés coûteraient plusieurs latences
 * réseau là où Postgres trie et limite en une passe. Chaque branche porte son
 * index de source, ce qui évite de deviner la provenance d'une ligne au retour.
 *
 * `$1` est le motif `ILIKE`, `$2` la limite par source. Les valeurs ne sont
 * jamais interpolées : seuls des noms de tables et de colonnes constants, issus
 * de `SOURCES`, entrent dans le texte.
 */
export function construireRequete(store: "rg" | "inagle" = "rg"): string {
  const branches = SOURCES.flatMap((source, index) => {
    if ((source.store ?? "rg") !== store) return [];
    const detail = source.colonneDetail ? `${source.colonneDetail}::text` : "NULL::text";
    const filtre = source.filtre ? ` AND ${source.filtre}` : "";
    const recherche = (source.colonnesRecherche ?? [source.colonneTitre])
      .map(colonne => `${colonne} ILIKE $1`)
      .join(" OR ");
    return `(SELECT ${source.colonneCle}::text AS id, ${source.colonneTitre}::text AS titre, ${detail} AS detail, ${index}::int AS source
			FROM ${source.table}
			WHERE (${recherche})${filtre}
			ORDER BY length(${source.colonneTitre}::text) ASC
			LIMIT $2)`;
  });

  return branches.join("\nUNION ALL\n");
}

/** Motif `ILIKE` échappé : `%` et `_` saisis par l'utilisateur sont littéraux. */
export function motifIlike(requete: string): string {
  return `%${requete.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/** Met en forme une ligne brute. Rend `null` si la source est inconnue. */
export function formaterLigne(
  ligne: LigneBrute,
  bases: BasesRecherche,
  sources: readonly Source[] = SOURCES,
): ResultatRecherche | null {
  const source = sources[Number(ligne.source)];
  if (!source) return null;
  const type = source.typePourLigne?.(ligne.detail) ?? source.type;
  const domaine = source.domainePourLigne?.(ligne.detail) ?? source.domaine;

  return {
    domaine,
    href: source.href(ligne.id, bases, ligne.detail),
    id: `${type}:${ligne.id}`,
    titre: ligne.titre,
    type,
    ...(ligne.detail && ligne.detail !== "special_tactics" && source.type !== "article"
      ? { detail: ligne.detail }
      : {}),
  };
}

/** Exécuteur SQL injecté : c'est l'appelant qui fournit sa connexion. */
export type ExecuteurSql = (sql: string, params: unknown[]) => Promise<LigneBrute[]>;
export interface ExecuteursSql {
  rg: ExecuteurSql;
  inagle: ExecuteurSql;
}

export interface OptionsRecherche {
  bases?: BasesRecherche;
  /** Résultats maximum PAR source. */
  limiteParSource?: number;
  /** Résultats maximum rendus, toutes sources confondues. */
  limiteTotale?: number;
}

/**
 * Cherche dans les trois domaines.
 *
 * Une erreur SQL remonte à l'appelant pour distinguer une panne d'une
 * recherche sans résultat. La route HTTP peut alors répondre 503.
 */
export async function rechercherPartout(
  executer: ExecuteursSql,
  requete: string,
  options: OptionsRecherche = {},
): Promise<ResultatRecherche[]> {
  const terme = requete.trim();
  if (terme.length < LONGUEUR_MINIMALE) return [];

  const bases = options.bases ?? BASES_PAR_DEFAUT;
  const limiteParSource = options.limiteParSource ?? 5;
  const limiteTotale = options.limiteTotale ?? 20;

  const lignes = (
    await Promise.all([
      executer.rg(construireRequete("rg"), [motifIlike(terme), limiteParSource]),
      executer.inagle(construireRequete("inagle"), [motifIlike(terme), limiteParSource]),
    ])
  ).flat();

  const resultats = lignes.map(ligne => formaterLigne(ligne, bases)).filter((r): r is ResultatRecherche => r !== null);

  // Tri d'affichage : par domaine (ordre du menu), puis titre le plus court —
  // une correspondance courte est presque toujours la plus pertinente
  // (« Axel » avant « Axel Blaze édition limitée »).
  const rang = new Map(DOMAINES_RECHERCHE.map((d, i) => [d, i]));
  resultats.sort((a, b) => {
    const parDomaine = (rang.get(a.domaine) ?? 9) - (rang.get(b.domaine) ?? 9);
    return parDomaine !== 0 ? parDomaine : a.titre.length - b.titre.length;
  });

  return resultats.slice(0, limiteTotale);
}

/** Regroupe par domaine, pour un rendu en sections. */
export function grouperParDomaine(
  resultats: ResultatRecherche[],
): { domaine: DomaineRecherche; resultats: ResultatRecherche[] }[] {
  return DOMAINES_RECHERCHE.map(domaine => ({
    domaine,
    resultats: resultats.filter(r => r.domaine === domaine),
  })).filter(groupe => groupe.resultats.length > 0);
}
