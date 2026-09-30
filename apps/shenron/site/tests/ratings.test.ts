/**
 * Règles de validation des notes — testées SUR LE CODE RÉEL.
 *
 * Ce fichier re-déclarait auparavant `isRatingTargetType` et `clampScore`
 * localement, faute de pouvoir importer `lib/ratings.ts` (marqué `server-only`,
 * donc rejeté par bun test). Il testait donc une copie : changer la vraie
 * implémentation ne pouvait pas le faire échouer. Les règles vivent désormais
 * dans `lib/ratings-rules.ts`, client-safe, et sont importées ici.
 */
import { describe, expect, test } from "bun:test";
import { RATING_TARGET_TYPES, clampScore, isRatingTargetType } from "../src/lib/ratings-rules";

const TYPES = RATING_TARGET_TYPES;

describe("rating target types", () => {
	test("accepte game/episode/movie/arc", () => {
		for (const t of TYPES) expect(isRatingTargetType(t)).toBe(true);
	});
	test("refuse tome/saga/personnage", () => {
		expect(isRatingTargetType("tome")).toBe(false);
		expect(isRatingTargetType("saga")).toBe(false);
		expect(isRatingTargetType("character")).toBe(false);
		expect(isRatingTargetType("")).toBe(false);
		expect(isRatingTargetType(null)).toBe(false);
	});
});

describe("rating score", () => {
	test("1..5 valides", () => {
		expect(clampScore(1)).toBe(1);
		expect(clampScore(5)).toBe(5);
		expect(clampScore(3.4)).toBe(3);
		expect(clampScore(3.6)).toBe(4);
	});
	test("hors plage / NaN → null", () => {
		expect(clampScore(0)).toBeNull();
		expect(clampScore(6)).toBeNull();
		expect(clampScore(NaN)).toBeNull();
		expect(clampScore(Infinity)).toBeNull();
	});
});
