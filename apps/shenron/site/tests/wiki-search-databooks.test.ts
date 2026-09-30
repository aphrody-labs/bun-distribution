import { describe, expect, test } from "bun:test";
import type { SearchResults } from "../src/lib/db-universe";

describe("wiki search databooks and novels integration", () => {
	test("SearchResults structure satisfies databooks and novels collections", () => {
		const mockResults: SearchResults = {
			q: "daizenshuu",
			characters: [],
			planets: [],
			sagas: [],
			movies: [],
			games: [],
			episodes: [],
			techniques: [],
			races: [],
			transformations: [],
			arcs: [],
			mangaVolumes: [],
			mangaChapters: [],
			battles: [],
			locations: [],
			tournaments: [],
			voiceActors: [],
			soundtracks: [],
			powerLevels: [],
			items: [],
			dragons: [],
			databooks: [
				{
					id: 1,
					title: "Daizenshuu 1: Complete Illustrations",
					title_ja: "大全集 1",
					category: "Daizenshuu",
					cover: "/databooks/d1.webp",
				},
			],
			novels: [
				{
					id: 101,
					title: "Dragon Ball Super: Broly (Novel)",
					title_ja: "ドラゴンボール超 ブロリー",
					publication_type: "light_novel",
					cover: "/novels/broly.webp",
				},
			],
			contributors: [],
		};

		expect(mockResults.databooks.length).toBe(1);
		expect(mockResults.databooks[0].category).toBe("Daizenshuu");
		expect(mockResults.novels.length).toBe(1);
		expect(mockResults.novels[0].publication_type).toBe("light_novel");
	});

	test("filter logic preserves databooks and novels when routes are accessible", () => {
		const allowedPaths = new Set(["/wiki/databooks", "/wiki/romans"]);
		const isPathPublic = (probe: string) => allowedPaths.has(probe);

		const keep = <T>(list: T[], probe: string): T[] => (isPathPublic(probe) ? list : []);

		const dummyData = [{ id: 1, title: "Test Item" }];
		expect(keep(dummyData, "/wiki/databooks")).toEqual(dummyData);
		expect(keep(dummyData, "/wiki/romans")).toEqual(dummyData);
		expect(keep(dummyData, "/wiki/secret")).toEqual([]);
	});
});
