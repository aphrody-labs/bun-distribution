import { describe, expect, it } from "bun:test";
import { PG_SOURCES } from "../../../../packages/shenron/pipeline/scripts/_rag-sources-pg";

describe("RAG Refonte Sources Contract", () => {
	it("enregistre les 4 nouvelles sources de refonte dans PG_SOURCES", () => {
		expect(PG_SOURCES).toHaveProperty("contributors");
		expect(PG_SOURCES).toHaveProperty("media_works");
		expect(PG_SOURCES).toHaveProperty("narrative_timelines");
		expect(PG_SOURCES).toHaveProperty("narrative_events");
	});

	it("les renderers de refonte sont des fonctions asynchrones", () => {
		expect(typeof PG_SOURCES.contributors).toBe("function");
		expect(typeof PG_SOURCES.media_works).toBe("function");
		expect(typeof PG_SOURCES.narrative_timelines).toBe("function");
		expect(typeof PG_SOURCES.narrative_events).toBe("function");
	});

	it("génère des chunks conformes au schéma RAG", async () => {
		// Mock SQL léger pour tester le contrat sans connexion réseau si offline
		const fakeSql = {
			unsafe: async (query: string) => {
				if (query.includes("bot.contributors")) {
					return [
						{
							id: 1,
							slug: "akira-toriyama",
							name: "Akira Toriyama",
							name_ja: "鳥山明",
							name_romaji: "Toriyama Akira",
							category: "author",
							spotlight_rank: 0,
							birth_date: "1955-04-05",
							death_date: "2024-03-01",
							biography_fr: "Auteur légendaire et créateur de Dragon Ball.",
							credits: [{ role: "Auteur original", scope: "work" }],
						},
					];
				}
				if (query.includes("bot.media_works")) {
					return [
						{
							id: 1,
							slug: "dragon-ball",
							title: "Dragon Ball",
							title_ja: "ドラゴンボール",
							title_romaji: "Doragon Bōru",
							series: "DB",
							kind: "manga",
							synopsis_fr: "L'épopée fondatrice de Son Goku.",
							editions: [{ edition: "tankobon", label: "Tankobon 42 tomes", language: "ja", page_color: "nb" }],
						},
					];
				}
				if (query.includes("bot.narrative_events")) {
					return [
						{
							id: 1,
							slug: "combat-goku-vegeta",
							kind: "battle",
							title: "Son Goku contre Vegeta",
							title_ja: "孫悟空対ベジータ",
							title_romaji: "Son Gokū tai Bejīta",
							timeline_slug: "manga-canon",
							timeline_label: "Continuité Manga Canonique",
							canon: "absolute",
							synopsis_fr: "Le combat décisif sur Terre lors de l'attaque des Saiyans.",
						},
					];
				}
				if (query.includes("bot.narrative_timelines")) {
					return [
						{
							id: 1,
							slug: "manga-canon",
							kind: "manga",
							label: "Continuité Manga Canonique",
						},
					];
				}
				return [];
			},
		} as any;

		const contribChunks = await PG_SOURCES.contributors(fakeSql);
		expect(contribChunks.length).toBeGreaterThanOrEqual(1);
		expect(contribChunks[0]!.kind).toBe("contributor");
		expect(contribChunks[0]!.title).toContain("Akira Toriyama");
		expect(contribChunks[0]!.url).toBe("/wiki/contributeurs/akira-toriyama");
		expect(contribChunks[0]!.entity).toBe("Akira Toriyama");

		const workChunks = await PG_SOURCES.media_works(fakeSql);
		expect(workChunks.length).toBeGreaterThanOrEqual(1);
		expect(workChunks[0]!.kind).toBe("media_work");
		expect(workChunks[0]!.title).toContain("Dragon Ball");
		expect(workChunks[0]!.url).toBe("/wiki/manga");

		const timelineChunks = await PG_SOURCES.narrative_timelines(fakeSql);
		expect(timelineChunks.length).toBe(1);
		expect(timelineChunks[0]!.kind).toBe("narrative_timeline");
		expect(timelineChunks[0]!.title).toBe("Continuité Manga Canonique");

		const eventChunks = await PG_SOURCES.narrative_events(fakeSql);
		expect(eventChunks.length).toBeGreaterThanOrEqual(1);
		expect(eventChunks[0]!.kind).toBe("narrative_event");
		expect(eventChunks[0]!.title).toContain("Son Goku contre Vegeta");
		expect(eventChunks[0]!.url).toBe("/wiki/combats/combat-goku-vegeta");
	});
});
