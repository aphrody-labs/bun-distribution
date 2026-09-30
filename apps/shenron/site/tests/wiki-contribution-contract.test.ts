import { describe, expect, test } from "bun:test";
import {
	AGENT_WIKI_DYNAMIC_TARGETS,
	getAgentWikiContributionContract,
} from "../src/lib/wiki-contribution-contract";
import { isContributableColumn } from "../src/lib/contributions-shared";
import { WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

describe("contrat de contribution pour agents", () => {
	const tables = getAgentWikiContributionContract();

	test("ne publie que des cibles modérables", () => {
		for (const table of tables) {
			expect(table.fields.length, `${table.table} sans champ`).toBeGreaterThan(0);
			for (const field of table.fields) {
				expect(isContributableColumn(field.name), `${table.table}.${field.name}`).toBe(true);
				expect(WIKI_TABLE_SPECS[table.table]?.mutableColumns).toContain(field.name);
			}
		}
	});

	test("décrit les cibles spéciales sans les confondre avec des colonnes SQL", () => {
		expect(AGENT_WIKI_DYNAMIC_TARGETS).toContainEqual(
			expect.objectContaining({ table: "db_databooks", columnPattern: "pages#<numero>" })
		);
		expect(AGENT_WIKI_DYNAMIC_TARGETS).toContainEqual(
			expect.objectContaining({ table: "db_characters", columnPattern: "stats" })
		);
	});
});
