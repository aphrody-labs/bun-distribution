import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WIKI_TABLE_NAMES, WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

const script = readFileSync(join(import.meta.dir, "..", "scripts", "audit-wiki-contract.ts"), "utf8");

describe("audit SQL du contrat wiki", () => {
	test("couvre toutes les tables du registre unique", () => {
		expect(WIKI_TABLE_NAMES.length).toBe(Object.keys(WIKI_TABLE_SPECS).length);
		for (const _table of WIKI_TABLE_NAMES) expect(script).toContain("WIKI_TABLE_SPECS");
	});

	test("vérifie les colonnes SQL et échoue en cas de divergence", () => {
		expect(script).toContain("information_schema.columns");
		expect(script).toContain("missingPrimaryKey");
		expect(script).toContain("missingMutableColumns");
		expect(script).toContain("process.exitCode = 1");
		expect(script).toContain("Audit SQL du contrat wiki impossible");
	});
});
