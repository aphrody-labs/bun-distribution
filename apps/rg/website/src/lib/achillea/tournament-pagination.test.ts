import { describe, expect, test } from "bun:test";

import { remainingTournamentPages } from "./tournament-pagination";

describe("remainingTournamentPages", () => {
	test("follows the legacy effective limit when it caps the requested page size", () => {
		expect(remainingTournamentPages({ page: 1, limit: 25, total: 52, pageCount: 3 })).toEqual([
			2,
			3,
		]);
	});

	test("uses the larger effective limit returned by the unified API", () => {
		expect(remainingTournamentPages({ page: 1, limit: 50, total: 52, pageCount: 2 })).toEqual([2]);
	});

	test("does not request a page when the first response already holds all records", () => {
		expect(remainingTournamentPages({ page: 1, limit: 25, total: 9, pageCount: 1 })).toEqual([]);
	});
});
