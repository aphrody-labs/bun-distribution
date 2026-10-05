import { describe, expect, test } from "bun:test";
import { findAndUpsertUsers } from "./src/db/ingest";
import { Store } from "./src/db/store";

describe("findAndUpsertUsers", () => {
	test("walks nested payloads and deduplicates users", () => {
		const store = new Store(":memory:");
		const result = {
			entries: [
				{
					user_results: {
						result: {
							rest_id: "42",
							legacy: { screen_name: "aphrody", name: "Aphrody" },
						},
					},
				},
			],
		};
		result.entries.push(result.entries[0]);

		expect(findAndUpsertUsers(result, store)).toBe(1);
		expect(store.query("SELECT username FROM users")).toEqual([{ username: "aphrody" }]);
		store.close();
	});
});
