import { describe, expect, test } from "bun:test";
import { sanitizeInternalPath } from "../src/lib/internal-path";

describe("sanitizeInternalPath", () => {
	test("conserve et normalise les routes locales", () => {
		expect(sanitizeInternalPath(" /wiki/personnages/1?tab=bio#sources ")).toBe(
			"/wiki/personnages/1?tab=bio#sources"
		);
	});

	test("refuse les destinations externes et les chemins réseau déguisés", () => {
		for (const value of [
			"https://example.com/phishing",
			"//example.com/phishing",
			"/\\example.com/phishing",
			"\\\\example.com/phishing",
			"javascript:alert(1)",
		]) {
			expect(sanitizeInternalPath(value)).toBeNull();
		}
	});

	test("refuse les valeurs vides, relatives ou trop longues", () => {
		expect(sanitizeInternalPath("")).toBeNull();
		expect(sanitizeInternalPath("wiki/personnages")).toBeNull();
		expect(sanitizeInternalPath(`/${"a".repeat(20)}`, 10)).toBeNull();
	});
});
