import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
	buildRagContext,
	createQueryExpander,
	exactQueryTerms,
	hybridSearch,
	inferSourceHintUrl,
	truthWeight,
	type RagHit,
} from "../src/lib/rag";
import {
	aggregate,
	aggregateByTag,
	firstHitRank,
	isHit,
	ndcgAtK,
	matchesExpectedUrl,
	normalizeUrl,
	parseGold,
	type CaseResult,
} from "../src/lib/rag-eval";

const hit = (url: string, title = "t", snippet = ""): RagHit => ({
	rowid: 1,
	kind: "character",
	title,
	url,
	snippet,
	score: 1,
});

describe("rag-eval — matcher", () => {
	it("classe les entités de la refonte au niveau éditorial prévu", () => {
		expect(truthWeight("", "media_work", ["ouvrage"], "Dragon Ball")).toBe(2);
		expect(truthWeight("", "narrative_timeline", ["question"], "Manga")).toBe(1.9);
		expect(truthWeight("", "narrative_event", ["question"], "Combat")).toBe(1.9);
	});
	it("route une demande encyclopédique explicite vers la saga canonique", () => {
		expect(inferSourceHintUrl("Parle-moi du Tournoi du Pouvoir")).toBe("/wiki/sagas/tournament-of-power");
	});

	it("normalise l'origine du site et le slash final", () => {
		expect(normalizeUrl("https://dragonballfr.com/wiki/databooks/4/")).toBe("/wiki/databooks/4");
		expect(normalizeUrl("/wiki/Personnages/Vegeta#Personnalite")).toBe(
			"/wiki/personnages/vegeta#personnalite"
		);
	});

	it("exige la source attendue quand expectUrl est fourni, pas un mot de la question", () => {
		const c = {
			q: "Qui est Freezer ?",
			expectUrl: ["/wiki/personnages/freezer"],
			expect: ["Freezer"],
		};
		expect(isHit(hit("/wiki/combats/goku-vs-freezer-namek", "Goku vs Freezer"), c)).toBe(false);
		expect(isHit(hit("/wiki/personnages/freezer#histoire"), c)).toBe(true);
	});

	it("un préfixe d'URL accepte les ancres de section", () => {
		const c = { q: "x", expectUrl: ["/wiki/dragons#voeu-1"] };
		expect(isHit(hit("/wiki/dragons#voeu-1"), c)).toBe(true);
		expect(isHit(hit("/wiki/dragons#polunga"), c)).toBe(false);
	});

	it("respecte la frontière du slug et refuse les quasi-homonymes", () => {
		expect(
			matchesExpectedUrl("/wiki/personnages/freezer#histoire", "/wiki/personnages/freezer")
		).toBe(true);
		expect(matchesExpectedUrl("/wiki/personnages/freezer-futur", "/wiki/personnages/freezer")).toBe(
			false
		);
		expect(matchesExpectedUrl("/wiki/dragons#voeu-14", "/wiki/dragons#voeu-1")).toBe(false);
	});

	it("expectTitle matche le titre quand l'URL n'est pas fiable", () => {
		const c = { q: "x", expectTitle: ["Ultra Instinct"] };
		expect(
			isHit(hit("/wiki/transformations/vegeta-ssjb", "Transformation d'Ultra Instinct"), c)
		).toBe(true);
	});

	it("garde le matcher historique par sous-chaîne", () => {
		const c = { q: "x", expect: ["Saikyō"] };
		expect(isHit(hit("", "Saikyō Jump"), c)).toBe(true);
	});
});

describe("rag-eval — métriques", () => {
	const c = { q: "x", expectUrl: ["/a"] };
	const results = [hit("/b"), hit("/a"), hit("/a/2")];

	it("rang du premier hit et nDCG binaire", () => {
		expect(firstHitRank(results, c)).toBe(2);
		expect(ndcgAtK([hit("/b")], c)).toBe(0);
		expect(ndcgAtK([hit("/a")], c)).toBe(1);
	});

	it("agrège recall/MRR et ventile par tag", () => {
		const r = (rank: number, tags: string[]): CaseResult => ({
			case: { q: "x", expectUrl: ["/a"], tags },
			rank,
			ndcg: rank ? 1 / Math.log2(rank + 1) : 0,
			top: [],
			latencyMs: 1,
			mode: "lexical",
		});
		const all = [r(1, ["a"]), r(4, ["a", "b"]), r(0, ["b"])];
		const m = aggregate(all);
		expect(m.recall[1]).toBeCloseTo(1 / 3);
		expect(m.recall[5]).toBeCloseTo(2 / 3);
		expect(m.mrr).toBeCloseTo((1 + 0.25) / 3);
		const byTag = aggregateByTag(all);
		expect(byTag.a!.cases).toBe(2);
		expect(byTag.b!.recall[10]).toBeCloseTo(0.5);
	});

	it("parseGold ignore les lignes invalides et les commentaires", () => {
		const gold = parseGold(
			'{"q":"a","expectUrl":["/a"]}\n// commentaire\n{pas du json}\n{"q":"b"}\n'
		);
		expect(gold.map((g) => g.q)).toEqual(["a"]);
	});
});

describe("rag — expansion de requête par graphies équivalentes", () => {
	const expand = createQueryExpander([
		["Freezer", "Frieza", "フリーザ"],
		["Son Goku", "Goku", "孫悟空"],
		["Ultra Instinct", "Migatte no Gokui", "身勝手の極意"],
	]);

	it("ajoute les formes françaises et japonaises à une question anglaise", () => {
		expect(expand("What race is Frieza?").toSorted()).toEqual(["freezer", "フリーザ"].toSorted());
	});

	it("reconnaît une graphie japonaise dans la question", () => {
		expect(expand("身勝手の極意とは")).toContain("ultra instinct");
	});

	it("reconnaît les expressions de plusieurs mots et n'invente rien sinon", () => {
		expect(expand("la technique migatte no gokui")).toContain("身勝手の極意");
		expect(expand("combien vaut un zeni")).toEqual([]);
	});
});

describe("rag — rappel exact des fiches", () => {
	it("préserve les expressions numérotées au lieu de les réduire à leur forme générique", () => {
		expect(exactQueryTerms("Le Super Saiyan 4 de Dragon Ball GT")).toContain("super saiyan 4");
	});

	it("conserve le sujet explicite avant les aliases ajoutés à la recherche", () => {
		expect(exactQueryTerms("Qui est Bardock, le père de Goku ?")).toContain("bardock");
	});
});

describe("rag — routage strict vers le dossier canon", () => {
	it("reconnaît les sujets d'interviews et de biologie documentés", () => {
		expect(inferSourceHintUrl("Quel est le vrai nom de Mr Satan ?")).toBe("/wiki/canon");
		expect(inferSourceHintUrl("How did Toriyama come up with the Kamehameha?")).toBe("/wiki/canon");
		expect(inferSourceHintUrl("Les Namékiens vivent-ils seulement d'eau ?")).toBe("/wiki/canon");
	});

	it("ne route pas une simple mention vers le dossier canon", () => {
		expect(inferSourceHintUrl("Qui est Mr Satan ?")).toBeNull();
		expect(inferSourceHintUrl("Piccolo lance un Kamehameha")).toBeNull();
		expect(inferSourceHintUrl("Combat entre Gohan et Goku")).toBeNull();
	});
});

describe("rag — filtre kind et contexte d'ancrage", () => {
	const db = new Database(":memory:");
	db.run(
		"CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')"
	);
	const ins = db.query(
		"INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?)"
	);
	ins.run(
		"character",
		"Vegeta",
		"/wiki/personnages/vegeta",
		"Vegeta est le prince des Saiyans. ".repeat(40),
		"fr",
		"db_characters",
		"Vegeta"
	);
	ins.run(
		"battle",
		"Vegeta vs Zarbon",
		"/wiki/combats/vegeta-vs-zarbon-round1",
		"Vegeta affronte Zarbon sur Namek.",
		"fr",
		"db_battles",
		"Vegeta"
	);
	ins.run(
		"canon",
		"Noms de légumes",
		"/wiki/canon#legumes",
		"Vegeta vient de vegetable selon Toriyama.",
		"fr",
		"canon_references",
		""
	);

	it("filtre par kind", async () => {
		const { results } = await hybridSearch(db, "Vegeta", 10, { kind: "battle", lexicalOnly: true });
		expect(results.map((r) => r.kind)).toEqual(["battle"]);
		expect(results[0]!.sourceId).toBe("db_battles");
	});

	it("rend des passages numérotés, en URL absolue, dans le budget", async () => {
		const ctx = await buildRagContext(db, "Vegeta", { lexicalOnly: true, maxChars: 900, limit: 3 });
		expect(ctx.sources.length).toBeGreaterThan(1);
		expect(ctx.sources[0]!.n).toBe(1);
		expect(ctx.sources.every((s) => s.url.startsWith("https://dragonballfr.com/"))).toBe(true);
		expect(ctx.context).toContain("[1] ");
		expect(ctx.context.length).toBeLessThanOrEqual(900 + 40);
	});
});

describe("rag-eval — adaptateur de @shenron/pipeline/ai/eval", () => {
	it("réexporte la définition partagée des métriques", async () => {
		const shared = await import("@shenron/pipeline/ai/eval");
		const local = await import("../src/lib/rag-eval");
		for (const name of ["aggregate", "aggregateByTag", "isHit", "matchesExpectedUrl", "normalizeUrl", "parseGold", "RANKS"] as const) {
			expect(local[name]).toBe(shared[name] as never);
		}
		const c = { q: "Freezer ?", expectUrl: ["/wiki/personnages/freezer"] };
		const results = [hit("/wiki/combats/x"), hit("/wiki/personnages/freezer")];
		expect(local.firstHitRank(results, c)).toBe(shared.firstHitRank(results, c));
		expect(local.ndcgAtK(results, c)).toBe(shared.ndcgAtK(results, c));
		const run = await local.runCase(c, async () => ({ results, mode: "lexical" }));
		expect(run.rank).toBe(2);
		expect(run.mode).toBe("lexical");
	});
});
