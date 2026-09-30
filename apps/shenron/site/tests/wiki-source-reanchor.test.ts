import { describe, expect, test } from "bun:test";
import { containsExactCjkTerm, exactCanonicalMatches, isPrimaryReference, normalizeEntityName, toWikiSources } from "../src/lib/wiki-source-reanchor";

const reference = (overrides: Partial<Parameters<typeof isPrimaryReference>[0]> = {}) => ({
	id: "ref-1",
	subject: "Son Gokû",
	keywords: ["孫悟空"],
	source: "Dragon Ball tome 1",
	document: "Manga Dragon Ball",
	provenance: "manga",
	href: "/wiki/manga/volume/1",
	...overrides,
});

describe("ré-ancrage canonique exact", () => {
	test("refuse une graphie japonaise imbriquée dans un autre nom", () => {
		expect(containsExactCjkTerm("トルビーツラーモグ", "ビーツ")).toBe(false);
		expect(containsExactCjkTerm("過去 サイヤ人 ビーツ パラガス", "ビーツ")).toBe(true);
	});
	test("normalise graphie et diacritiques sans élargir en sous-chaîne", () => {
		expect(normalizeEntityName("Son Gokû (DBZ)")).toBe("son goku");
		expect(exactCanonicalMatches("Son Goku", null, [reference()])).toHaveLength(1);
		expect(exactCanonicalMatches("Goku Black", null, [reference()])).toHaveLength(0);
	});

	test("accepte uniquement manga/databook avec href primaire", () => {
		expect(isPrimaryReference(reference())).toBe(true);
		expect(isPrimaryReference(reference({ provenance: "fandom" }))).toBe(false);
		expect(isPrimaryReference(reference({ href: "https://example.com/wiki" }))).toBe(false);
	});

	test("produit une bibliographie traçable vers canon_references", () => {
		expect(toWikiSources([reference()])).toEqual([{ n: 1, kind: "canon_reference", label: "Manga Dragon Ball — Dragon Ball tome 1", url: "/wiki/manga/volume/1", canonReferenceId: "ref-1" }]);
	});
});
