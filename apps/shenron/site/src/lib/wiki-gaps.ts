/**
 * wiki-gaps — règles de la worklist « fiches à compléter » (`/admin/wiki/todo`)
 * et des signaux de complétude du tableau de bord CMS (`/admin/wiki`).
 *
 * Ni `server-only` ni connexion : ce module décide QUOI vérifier à partir d'une
 * simple liste de colonnes (camelCase, clés de l'objet Drizzle) et fabrique les
 * fragments SQL correspondants avec `drizzle-orm`, sans jamais les exécuter.
 * `wiki-admin.ts` les exécute. La sémantique se teste donc sans base, sur le
 * SQL réellement émis.
 *
 * Pourquoi ce module existe : la worklist listait 87 « fiches à compléter » dont
 * 80 techniques MASQUÉES du site public (826 techniques en base, 25 visibles —
 * toutes complètes). Pendant ce temps, les 20 lieux publics sans image, les
 * 114 personnages publics sans nom japonais ou les 6 épisodes sans synopsis
 * n'apparaissaient nulle part. Deux règles en découlent :
 *
 *   1. un manque ne compte comme travail que sur une ligne PUBLIQUE
 *      (`visible IS NOT FALSE` : NULL vaut visible, comme partout ailleurs) ;
 *   2. les lignes masquées ne disparaissent pas pour autant : elles sont
 *      comptées à part (« masquées, non publiques »).
 */
import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Nature d'un manque. `desc` = description / synopsis / résumé / biographie. */
export type GapKind = "image" | "desc" | "ja";

const GAP_KINDS: readonly GapKind[] = ["image", "desc", "ja"];

/**
 * Colonnes candidates par nature de manque, dans l'ordre de préférence. La
 * première présente dans la table est retenue ; une table sans aucune n'est
 * pas vérifiée pour ce manque (les races n'ont pas d'image, les dragons pas de
 * description, les transformations pas de nom japonais).
 *
 * `synopsisFr` passe AVANT `synopsis` : c'est le texte français que la page
 * publique affiche en premier (`toEpisode`/`toMovie` de `db-universe.ts`).
 * Tester `synopsis` signalait 6 épisodes de Kai Final Chapters dont le synopsis
 * original est vide mais dont le synopsis français (230 à 1 065 caractères)
 * est bien publié — de faux manques.
 */
const GAP_COLUMN_CANDIDATES: Readonly<Record<GapKind, readonly string[]>> = {
	image: ["image", "cover", "poster"],
	desc: ["description", "synopsisFr", "synopsis", "summary", "biography"],
	ja: ["nameJa", "titleJa"],
};

/** Libellés FR des manques (badges de la worklist). */
export const GAP_LABELS: Readonly<Record<GapKind, string>> = {
	image: "image",
	desc: "texte",
	ja: "japonais",
};

/**
 * Tables suivies par la worklist en plus des entités du tableau de bord CMS :
 * les rubriques d'expansion, éditées depuis `/admin/database/<table>` faute de
 * studio.
 */
export const WORKLIST_EXTRA_TABLES = [
	"db_items",
	"db_locations",
	"db_dragons",
	"db_voice_actors",
	"db_character_variants",
] as const;

/**
 * Tables où une colonne japonaise vide n'est PAS un manque public — la raison
 * est affichée à l'admin plutôt que de lui faire traquer un faux trou.
 */
export const JA_GAP_EXEMPT: Readonly<Record<string, string>> = {
	db_character_variants:
		"Le nom japonais d'une version retombe sur celui de la fiche personnage à l'affichage.",
	db_voice_actors: "Les comédiens de doublage français n'ont pas de nom japonais à renseigner.",
};

/**
 * Tables où le manque japonais ne vaut que pour les lignes dont une colonne
 * témoin est renseignée. Épisodes : sans date de diffusion japonaise, pas de
 * titre japonais à trouver — ce sont les épisodes internationaux de Kai Final
 * Chapters jamais diffusés au Japon, dont les faux `title_ja` ont été vidés
 * volontairement (rapport admin #15, `docs/ADMIN-REPORTS.md`). Mesuré le
 * 2026-09-23 : les 8 épisodes publics sans `air_date` sont exactement les 8
 * sans `title_ja`, et aucun épisode daté n'en manque.
 */
const JA_GAP_ONLY_WHEN: Readonly<Record<string, { key: string; reason: string }>> = {
	db_episodes: {
		key: "airDate",
		reason:
			"Seuls les épisodes diffusés au Japon (date de diffusion renseignée) attendent un titre japonais : les épisodes internationaux de Kai Final Chapters n'en ont pas (rapport admin #15).",
	},
};

/**
 * Précision affichée en tête d'un groupe quand un manque est atténué par un
 * repli public : c'est du travail de finition, pas une page cassée.
 */
const GAP_TABLE_NOTES: Readonly<Record<string, string>> = {
	db_character_variants:
		"Sans image propre, la version affiche l'image de la fiche personnage : manque de finition, pas de trou public.",
};

/** Colonnes libellé, par ordre de préférence (la première non vide est affichée). */
const LABEL_CANDIDATES = ["name", "title", "displayName", "label"];

/** Colonnes de contexte pour désambiguïser (série + numéro d'épisode, catégorie…). */
const CONTEXT_CANDIDATES = ["series", "numberInSeries", "volumeNumber", "category"];

/** Colonnes de tri « naturel » avant le libellé (un épisode se lit dans l'ordre). */
const ORDER_CANDIDATES = ["series", "numberInSeries", "volumeNumber"];

/** Ce que la worklist vérifie sur une table, déduit de ses colonnes. */
export interface GapPlan {
	table: string;
	/** Clé camelCase de la pk (lien d'édition, tri de départage). */
	pkKey: string;
	/** Colonnes libellé à coalescer, dans l'ordre (pk en dernier recours). */
	labelKeys: string[];
	/** `slug` si présent : terme de recherche dans `/admin/database/<table>`. */
	slugKey: string | null;
	contextKeys: string[];
	orderKeys: string[];
	/** Colonne vérifiée par nature de manque (null = non vérifié sur cette table). */
	checks: Record<GapKind, string | null>;
	/** `visible` si la table porte la visibilité éditoriale. */
	visibleKey: string | null;
	/** Raison d'exemption du manque japonais, si la table en a une. */
	jaExemptReason: string | null;
	/** Colonne témoin : le manque japonais ne compte que si elle est renseignée. */
	jaOnlyWhenKey: string | null;
	/** Pourquoi le manque japonais est restreint (affiché à l'admin). */
	jaScopeReason: string | null;
	note: string | null;
}

/** Construit le plan de vérification d'une table à partir de ses colonnes. */
export function planGaps(table: string, columns: readonly string[], pkKey: string): GapPlan {
	const has = new Set(columns);
	const first = (candidates: readonly string[]) => candidates.find((c) => has.has(c)) ?? null;
	const jaExemptReason = JA_GAP_EXEMPT[table] ?? null;
	const onlyWhen = JA_GAP_ONLY_WHEN[table];
	// Témoin absent de la table = restriction inapplicable : on ne restreint pas
	// sur une colonne qui n'existe pas (le SQL référencerait `undefined`).
	const jaOnlyWhen = onlyWhen && has.has(onlyWhen.key) ? onlyWhen : null;
	const labelKeys = LABEL_CANDIDATES.filter((c) => has.has(c));
	return {
		table,
		pkKey,
		labelKeys: labelKeys.length ? labelKeys : [pkKey],
		slugKey: has.has("slug") ? "slug" : null,
		contextKeys: CONTEXT_CANDIDATES.filter((c) => has.has(c)),
		orderKeys: ORDER_CANDIDATES.filter((c) => has.has(c)),
		checks: {
			image: first(GAP_COLUMN_CANDIDATES.image),
			desc: first(GAP_COLUMN_CANDIDATES.desc),
			ja: jaExemptReason ? null : first(GAP_COLUMN_CANDIDATES.ja),
		},
		visibleKey: has.has("visible") ? "visible" : null,
		jaExemptReason,
		jaOnlyWhenKey: jaOnlyWhen?.key ?? null,
		jaScopeReason: jaOnlyWhen?.reason ?? null,
		note: GAP_TABLE_NOTES[table] ?? null,
	};
}

/** Un prédicat de manque : `column` vide (et `onlyWhen` renseignée, si posée). */
export interface GapPredicate {
	kind: GapKind;
	column: string;
	onlyWhen: string | null;
}

/**
 * Liste des prédicats de manque d'un plan : une entrée par colonne vérifiée.
 * Une ligne est « à compléter » si AU MOINS UN de ces prédicats est vrai.
 * Vide = la table n'est pas suivie.
 */
export function gapPredicates(plan: GapPlan): GapPredicate[] {
	return GAP_KINDS.flatMap((kind) => {
		const column = plan.checks[kind];
		if (!column) return [];
		return [{ kind, column, onlyWhen: kind === "ja" ? plan.jaOnlyWhenKey : null }];
	});
}

/** Portée de visibilité d'une requête : lignes publiques ou masquées. */
export type VisibilityScope = "public" | "hidden";

/**
 * Filtre d'une portée :
 *   - `all`     : aucune condition (table sans `visible`, portée publique) ;
 *   - `none`    : aucune ligne (table sans `visible`, portée masquée) ;
 *   - `visible` : `visible IS NOT FALSE` (publique, NULL = visible) ou
 *                 `visible IS FALSE` (masquée).
 */
export type ScopeFilter =
	| { kind: "all" }
	| { kind: "none" }
	| { kind: "visible"; column: string; op: "is not false" | "is false" };

export function scopeFilter(plan: GapPlan, scope: VisibilityScope): ScopeFilter {
	if (!plan.visibleKey) return scope === "public" ? { kind: "all" } : { kind: "none" };
	return {
		kind: "visible",
		column: plan.visibleKey,
		op: scope === "public" ? "is not false" : "is false",
	};
}

/** Vide = NULL, chaîne vide ou uniquement des espaces (miroir du `btrim` SQL). */
export function isBlankValue(value: unknown): boolean {
	if (value == null) return true;
	return String(value).trim() === "";
}

/**
 * Une ligne est publique sauf `visible === false` explicite (NULL = visible) —
 * miroir exécutable de `scopeFilter(plan, "public")`.
 */
export function isPublicRow(plan: GapPlan, row: Record<string, unknown>): boolean {
	return plan.visibleKey ? row[plan.visibleKey] !== false : true;
}

/** Comptes d'une table, tels que la worklist les annonce (jamais plafonnés). */
export interface GapCounts {
	/** Lignes PUBLIQUES ayant au moins un manque. */
	total: number;
	image: number;
	desc: number;
	ja: number;
	/** Lignes MASQUÉES (non publiques) ayant au moins un manque. */
	hidden: number;
}

export function emptyGapCounts(): GapCounts {
	return { total: 0, image: 0, desc: 0, ja: 0, hidden: 0 };
}

/** Additionne des comptes (totaux de la page). */
export function sumGapCounts(list: readonly GapCounts[]): GapCounts {
	const out = emptyGapCounts();
	for (const c of list) {
		out.total += c.total;
		out.image += c.image;
		out.desc += c.desc;
		out.ja += c.ja;
		out.hidden += c.hidden;
	}
	return out;
}

/**
 * Clés Drizzle d'une table (colonnes camelCase exposées par l'objet). Règle
 * unique du registre de `wiki-admin.ts`, partagée avec les tests.
 */
export function drizzleColumnKeys(table: object): string[] {
	const record = table as Record<string, unknown>;
	return Object.keys(record).filter((k) => {
		const v = record[k];
		return v != null && typeof v === "object" && "name" in v;
	});
}

// ── Traduction SQL (fragments Drizzle, jamais exécutés ici) ────────────────

/** Objet table Drizzle vu comme dictionnaire de colonnes camelCase. */
export type GapTable = Record<string, AnyColumn>;

/** `col` vide : NULL, '' ou uniquement des blancs (miroir de `isBlankValue`). */
function blankSql(table: GapTable, key: string): SQL<boolean> {
	return sql<boolean>`(nullif(btrim(${table[key]}), '') is null)`;
}

/** Un prédicat de manque en SQL (colonne vide, témoin renseigné si posé). */
function gapPredicateSql(table: GapTable, p: GapPredicate): SQL<boolean> {
	return p.onlyWhen
		? sql<boolean>`(${blankSql(table, p.column)} and ${table[p.onlyWhen]} is not null)`
		: blankSql(table, p.column);
}

/** Prédicat SQL du manque `kind`, ou `null` si la table ne le vérifie pas. */
export function gapKindSql(table: GapTable, plan: GapPlan, kind: GapKind): SQL<boolean> | null {
	const p = gapPredicates(plan).find((x) => x.kind === kind);
	return p ? gapPredicateSql(table, p) : null;
}

/** Condition de portée, ou `undefined` quand la portée couvre toute la table. */
export function scopeSql(
	table: GapTable,
	plan: GapPlan,
	scope: VisibilityScope
): SQL<boolean> | undefined {
	const f = scopeFilter(plan, scope);
	if (f.kind === "all") return undefined;
	if (f.kind === "none") return sql<boolean>`false`;
	return f.op === "is false"
		? sql<boolean>`(${table[f.column]} is false)`
		: sql<boolean>`(${table[f.column]} is not false)`;
}

/** « Au moins un manque », ou `undefined` si la table n'a rien à vérifier. */
export function anyGapSql(table: GapTable, plan: GapPlan): SQL | undefined {
	const parts = gapPredicates(plan).map((p) => gapPredicateSql(table, p));
	if (parts.length <= 1) return parts[0];
	return or(...parts);
}

/** `count(*) filter (where …)` typé nombre (postgres-js rend les bigint en chaînes). */
export function countWhereSql(cond: SQL | undefined): SQL<number> {
	return (cond ? sql`count(*) filter (where ${cond})` : sql`count(*)`).mapWith(Number);
}

/** Libellé affiché : première colonne libellé non vide, sinon la pk. */
export function labelSql(table: GapTable, plan: GapPlan): SQL<string> {
	const parts = [...plan.labelKeys, plan.pkKey].map(
		(k) => sql`nullif(btrim(${table[k]}::text), '')`
	);
	return sql<string>`coalesce(${sql.join(parts, sql`, `)})`;
}
