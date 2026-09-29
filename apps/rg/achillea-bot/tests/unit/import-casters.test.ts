/**
 * T-2.5 — Tests unitaires des parsers du script import-casters-from-sheet.
 *
 * Couvre les fonctions pures (pas de DB, pas de fichier source).
 * L'upsert lui-même est validé manuellement via `--dry-run` sur la source réelle.
 */

import { describe, expect, test } from "bun:test";

import { expandLineToRows, parseCsv, parseDocxXml } from "../../scripts/import-casters-from-sheet";

describe("parseDocxXml", () => {
	test("extrait les paragraphes <w:p> contenant du texte <w:t>", () => {
		const xml = `<w:body>
      <w:p><w:r><w:t>Tanej - Bri - Ishido</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Nioum - Hyroto </w:t></w:r></w:p>
      <w:p><w:r></w:r></w:p>
    </w:body>`;
		const out = parseDocxXml(xml);
		expect(out).toEqual(["Tanej - Bri - Ishido", "Nioum - Hyroto"]);
	});

	test("concatène plusieurs <w:t> dans le même paragraphe", () => {
		const xml = `<w:p><w:r><w:t>foo </w:t></w:r><w:r><w:t>bar</w:t></w:r></w:p>`;
		expect(parseDocxXml(xml)).toEqual(["foo bar"]);
	});

	test("retourne un tableau vide pour un body sans texte", () => {
		expect(parseDocxXml("<w:body></w:body>")).toEqual([]);
	});
});

describe("expandLineToRows", () => {
	test("split sur ` - ` (séparateur principal docx)", () => {
		const rows = expandLineToRows("Tanej - Bri - Ishido - Angel");
		expect(rows.map((r) => r.name)).toEqual(["Tanej", "Bri", "Ishido", "Angel"]);
		expect(rows[0].rawLine).toBe("Tanej - Bri - Ishido - Angel");
	});

	test("ignore les noms vides ou trop longs", () => {
		const rows = expandLineToRows(`foo - - ${"x".repeat(70)}`);
		expect(rows.map((r) => r.name)).toEqual(["foo"]);
	});

	test("supporte virgule, pipe et slash", () => {
		expect(expandLineToRows("a, b | c / d").map((r) => r.name)).toEqual(["a", "b", "c", "d"]);
	});
});

describe("parseCsv", () => {
	test("parse header + rows avec discord_id", () => {
		const csv = "name,discord_id,twitch\nAlice,123456789012345678,alice_tv\nBob,,bob_tv\n";
		const rows = parseCsv(csv);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			name: "Alice",
			discordId: "123456789012345678",
			twitch: "alice_tv",
		});
		expect(rows[1].discordId).toBeUndefined();
	});

	test("retourne [] si pas de header ou vide", () => {
		expect(parseCsv("")).toEqual([]);
		expect(parseCsv("name\n")).toEqual([]);
	});

	test("accepte 'pseudo' comme alias de name", () => {
		const csv = "pseudo,discord_id\nCharlie,987654321098765432\n";
		expect(parseCsv(csv)[0].name).toBe("Charlie");
	});
});
