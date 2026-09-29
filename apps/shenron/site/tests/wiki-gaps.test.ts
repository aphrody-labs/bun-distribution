import { describe, expect, test } from "bun:test";
import { getTableName, is, type SQL } from "drizzle-orm";
import { PgDialect, PgTable } from "drizzle-orm/pg-core";
import * as botSchema from "../src/db/bot-schema";
import { TABLE_LABELS } from "../src/lib/db-labels";
import { isStudioTable } from "../src/lib/wiki-fields";
import {
	anyGapSql,
	countWhereSql,
	drizzleColumnKeys,
	gapKindSql,
	gapPredicates,
	isBlankValue,
	isPublicRow,
	JA_GAP_EXEMPT,
	labelSql,
	planGaps,
	scopeFilter,
	scopeSql,
	sumGapCounts,
	WORKLIST_EXTRA_TABLES,
	type GapTable,
} from "../src/lib/wiki-gaps";
import { WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

const dialect = new PgDialect();
const render = (fragment: SQL | undefined) => (fragment ? dialect.sqlToQuery(fragment).sql : "");

/** Plan d'une table RÉELLE de bot-schema, construit comme dans wiki-admin. */
function realPlan(table: string, drizzleTable: object) {
	return planGaps(table, drizzleColumnKeys(drizzleTable), "id");
}

const techniques = botSchema.botTechniques as unknown as GapTable;
const episodes = botSchema.botEpisodes as unknown as GapTable;

describe("worklist « fiches à compléter » — portée publique", () => {
	test("une table à visibilité filtre `visible IS NOT FALSE` (NULL = visible)", () => {
		const plan = realPlan("db_techniques", botSchema.botTechniques);
		expect(plan.visibleKey).toBe("visible");
		expect(scopeFilter(plan, "public")).toEqual({
			kind: "visible",
			column: "visible",
			op: "is not false",
		});
		expect(scopeFilter(plan, "hidden")).toEqual({ kind: "visible", column: "visible", op: "is false" });
		expect(render(scopeSql(techniques, plan, "public"))).toMatch(/"visible" is not false/);
		expect(render(scopeSql(techniques, plan, "hidden"))).toMatch(/"visible" is false/);
	});

	test("les lignes masquées ne sont jamais publiques, NULL l'est", () => {
		const plan = realPlan("db_techniques", botSchema.botTechniques);
		expect(isPublicRow(plan, { visible: false })).toBe(false);
		expect(isPublicRow(plan, { visible: true })).toBe(true);
		expect(isPublicRow(plan, { visible: null })).toBe(true);
		expect(isPublicRow(plan, {})).toBe(true);
	});

	test("une table sans `visible` est entièrement publique, sa portée masquée est vide", () => {
		const plan = realPlan("db_news", botSchema.botNews);
		expect(plan.visibleKey).toBeNull();
		expect(scopeFilter(plan, "public")).toEqual({ kind: "all" });
		expect(scopeFilter(plan, "hidden")).toEqual({ kind: "none" });
		const news = botSchema.botNews as unknown as GapTable;
		expect(scopeSql(news, plan, "public")).toBeUndefined();
		expect(render(scopeSql(news, plan, "hidden"))).toBe("false");
		expect(isPublicRow(plan, { visible: false })).toBe(true);
	});

	test("chaque table suivie par la worklist porte la visibilité éditoriale", () => {
		for (const table of [
			"db_characters",
			"db_techniques",
			"db_episodes",
			"db_movies",
			...WORKLIST_EXTRA_TABLES,
		]) {
			const spec = WIKI_TABLE_SPECS[table];
			expect(spec).toBeDefined();
			const drizzle = Object.values(botSchema).find(
				(t) => is(t, PgTable) && getTableName(t) === table
			);
			expect(drizzle).toBeDefined();
			expect(realPlan(table, drizzle as object).visibleKey).toBe("visible");
		}
	});
});

describe("worklist — manques vérifiés", () => {
	test("un manque = NULL, chaîne vide ou blancs seulement (miroir du btrim SQL)", () => {
		for (const v of [null, undefined, "", "   ", "\n\t"]) expect(isBlankValue(v)).toBe(true);
		for (const v of ["x", " Goku ", 0, false]) expect(isBlankValue(v)).toBe(false);
		const plan = realPlan("db_techniques", botSchema.botTechniques);
		const sql = render(gapKindSql(techniques, plan, "image") ?? undefined);
		expect(sql).toContain("nullif(btrim(");
		expect(sql).toContain("'') is null");
	});

	test("techniques : image, description et nom japonais, reliés par OU", () => {
		const plan = realPlan("db_techniques", botSchema.botTechniques);
		expect(plan.checks).toEqual({ image: "image", desc: "description", ja: "nameJa" });
		expect(gapPredicates(plan).map((p) => p.kind)).toEqual(["image", "desc", "ja"]);
		const any = render(anyGapSql(techniques, plan));
		expect(any).toContain('"image"');
		expect(any).toContain('"description"');
		expect(any).toContain('"name_ja"');
		expect(any.match(/ or /g)?.length).toBe(2);
	});

	test("seules les colonnes présentes sont vérifiées", () => {
		const transformations = realPlan("db_transformations", botSchema.botTransformations);
		expect(transformations.checks).toEqual({ image: "image", desc: null, ja: null });
		const races = realPlan("db_races", botSchema.botRaces);
		expect(races.checks.image).toBeNull();
		expect(races.checks.ja).toBe("nameJa");
		const dragons = realPlan("db_dragons", botSchema.botDragons);
		expect(dragons.checks).toEqual({ image: "image", desc: null, ja: "nameJa" });
		const movies = realPlan("db_movies", botSchema.botMovies);
		expect(movies.checks.image).toBe("poster");
		expect(movies.checks.ja).toBe("titleJa");
	});

	test("épisodes et films : le texte vérifié est le synopsis FRANÇAIS publié", () => {
		expect(realPlan("db_episodes", botSchema.botEpisodes).checks.desc).toBe("synopsisFr");
		expect(realPlan("db_movies", botSchema.botMovies).checks.desc).toBe("synopsisFr");
		// Sans colonne FR, repli sur le synopsis d'origine.
		expect(planGaps("t", ["id", "synopsis"], "id").checks.desc).toBe("synopsis");
	});

	test("épisodes : le titre japonais n'est attendu que s'ils ont été diffusés au Japon", () => {
		const plan = realPlan("db_episodes", botSchema.botEpisodes);
		expect(plan.jaOnlyWhenKey).toBe("airDate");
		expect(plan.jaScopeReason).toContain("#15");
		const ja = gapPredicates(plan).find((p) => p.kind === "ja");
		expect(ja).toEqual({ kind: "ja", column: "titleJa", onlyWhen: "airDate" });
		const sql = render(gapKindSql(episodes, plan, "ja") ?? undefined);
		expect(sql).toContain('"title_ja"');
		expect(sql).toContain('"air_date" is not null');
		// Les autres manques n'héritent pas de la restriction.
		expect(render(gapKindSql(episodes, plan, "image") ?? undefined)).not.toContain("air_date");
	});

	test("restriction ignorée si la colonne témoin n'existe pas", () => {
		const plan = planGaps("db_episodes", ["id", "title", "titleJa"], "id");
		expect(plan.checks.ja).toBe("titleJa");
		expect(plan.jaOnlyWhenKey).toBeNull();
	});

	test("versions et casting vocal : pas de faux manque japonais", () => {
		const variants = realPlan("db_character_variants", botSchema.botCharacterVariants);
		expect(variants.checks).toEqual({ image: "image", desc: "summary", ja: null });
		expect(variants.jaExemptReason).toBe(JA_GAP_EXEMPT.db_character_variants);
		expect(variants.note).toContain("image de la fiche personnage");
		expect(variants.labelKeys).toEqual(["displayName", "label"]);
		const voices = realPlan("db_voice_actors", botSchema.botVoiceActors);
		expect(voices.checks).toEqual({ image: "image", desc: "biography", ja: null });
	});

	test("une table sans colonne vérifiable n'a aucun prédicat", () => {
		const plan = planGaps("t", ["id", "name", "visible"], "id");
		expect(gapPredicates(plan)).toEqual([]);
		expect(anyGapSql({} as GapTable, plan)).toBeUndefined();
	});
});

describe("worklist — comptes et libellés", () => {
	test("les comptes sont des `count(*) filter`, jamais un LIMIT", () => {
		const plan = realPlan("db_techniques", botSchema.botTechniques);
		const sql = render(countWhereSql(anyGapSql(techniques, plan)));
		expect(sql.startsWith("count(*) filter (where")).toBe(true);
		expect(sql).not.toMatch(/limit/i);
		expect(render(countWhereSql(undefined))).toBe("count(*)");
	});

	test("le libellé coalesce nom/titre puis la pk", () => {
		const plan = realPlan("db_episodes", botSchema.botEpisodes);
		expect(plan.labelKeys).toEqual(["title"]);
		expect(plan.orderKeys).toEqual(["series", "numberInSeries"]);
		const sql = render(labelSql(episodes, plan));
		expect(sql.startsWith("coalesce(")).toBe(true);
		expect(sql).toContain('"title"');
		expect(sql).toContain('"id"');
	});

	test("totaux additionnés sans perte", () => {
		expect(
			sumGapCounts([
				{ total: 114, image: 0, desc: 0, ja: 114, hidden: 394 },
				{ total: 20, image: 20, desc: 0, ja: 0, hidden: 15 },
			])
		).toEqual({ total: 134, image: 20, desc: 0, ja: 114, hidden: 409 });
	});

	test("les rubriques ajoutées ont un libellé FR et une route d'édition", () => {
		for (const table of WORKLIST_EXTRA_TABLES) {
			expect(TABLE_LABELS[table]).toBeTruthy();
			// Pas de studio pour ces tables : l'édition passe par /admin/database.
			expect(isStudioTable(table)).toBe(false);
			expect(WIKI_TABLE_SPECS[table]).toBeDefined();
		}
	});
});
