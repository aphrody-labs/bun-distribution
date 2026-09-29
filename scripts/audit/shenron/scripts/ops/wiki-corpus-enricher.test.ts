import { describe, expect, test } from "bun:test";
import {
	buildSourceBundles,
	containsExactTerm,
	parseCandidates,
	type CorpusRecord,
} from "./wiki-corpus-enricher";

const records: CorpusRecord[] = [
	{
		kind: "manga",
		locator: { series: "DB", volume: "vol1", page: 3 },
		document: "Manga DB — tome vol1",
		sourceUrl: "https://dragonballfr.com/wiki/manga/volume/1#planche-3",
		text: "Bulma rencontre Son Goku.",
		verified: true,
	},
	{
		kind: "databook",
		locator: { databookId: 7, page: 12 },
		document: "Daizenshuu 7 — planche 12",
		sourceUrl: "https://dragonballfr.com/wiki/databooks/7#planche-12",
		text: "孫悟空の紹介。",
		verified: true,
	},
	{
		kind: "manga",
		locator: { series: "DB", volume: "vol1", page: 4 },
		document: "Manga DB — tome vol1",
		sourceUrl: "https://dragonballfr.com/wiki/manga/volume/1#planche-4",
		text: "Le personnage de Gokushima est différent.",
		verified: true,
	},
	{
		kind: "databook",
		locator: { databookId: 7, page: 13 },
		document: "Daizenshuu 7 — planche 13",
		sourceUrl: "https://dragonballfr.com/wiki/databooks/7#planche-13",
		text: "Son Goku non vérifié.",
		verified: false,
	},
];

describe("wiki corpus enricher", () => {
	test("requires safe exact terms", () => {
		expect(containsExactTerm("Son Goku arrive", "Son Goku")).toBe(true);
		expect(containsExactTerm("Gokushima arrive", "Goku")).toBe(false);
		expect(containsExactTerm("孫悟空の紹介", "孫悟空")).toBe(true);
		expect(containsExactTerm("神の宮殿", "神")).toBe(false);
	});

	test("emits provenance-only evidence and leaves unsupported candidates empty", () => {
		const candidates = [
			{ id: "goku", title: "Son Goku", slug: "son-goku", nameJa: "孫悟空" },
			{ id: "none", title: "Inconnu", slug: "inconnu" },
		];
		const result = buildSourceBundles(candidates, records);
		expect(result).toEqual(buildSourceBundles(candidates, records));
		expect(result.bundles[0]).toMatchObject({ status: "evidence_found" });
		expect(result.bundles[0]!.evidence.map((evidence) => evidence.id)).toEqual([
			"databook:7:12",
			"manga:DB:vol1:3",
		]);
		expect(result.bundles[0]!.evidence[0]!.textSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.bundles[1]).toEqual({
			candidate: { id: "none", title: "Inconnu", slug: "inconnu" },
			status: "no_primary_evidence",
			evidence: [],
		});
	});

	test("rejects malformed and duplicate candidate input", () => {
		expect(() => parseCandidates([{ id: "x", title: "X", slug: "x" }, { id: "x", title: "Y", slug: "y" }])).toThrow(
			"duplicate candidate id"
		);
		expect(() => parseCandidates({ candidates: [{ id: "x", title: "X" }] })).toThrow("needs non-empty");
	});
});
