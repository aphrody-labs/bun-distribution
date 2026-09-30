import { describe, expect, test } from "bun:test";
import { isNonEmptyValue, nonEmptySql } from "../src/lib/wiki-coverage";

describe("audit de couverture wiki", () => {
	test("considère les conteneurs JSON vides comme vides", () => {
		for (const value of [null, undefined, "", "  ", [], {}]) expect(isNonEmptyValue(value)).toBe(false);
		for (const value of [0, false, "texte", [1], { key: null }]) expect(isNonEmptyValue(value)).toBe(true);
	});

	test("génère un prédicat JSONB qui exclut null, [] et {}", () => {
		const predicate = nonEmptySql("players", "jsonb");
		expect(predicate).toContain("'[]'::jsonb");
		expect(predicate).toContain("'{}'::jsonb");
		expect(predicate).toContain("'null'::jsonb");
	});

	test("traite séparément tableaux SQL, textes et scalaires", () => {
		expect(nonEmptySql("tags", "ARRAY")).toContain("cardinality");
		expect(nonEmptySql("title", "text")).toContain("btrim");
		expect(nonEmptySql("visible", "boolean")).toBe('"visible" IS NOT NULL');
	});

	test("refuse un identifiant SQL injecté", () => {
		expect(() => nonEmptySql("x; delete", "text")).toThrow("Identifiant SQL invalide");
	});
});
