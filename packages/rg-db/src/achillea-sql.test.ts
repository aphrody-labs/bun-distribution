import { afterEach, describe, expect, test } from "bun:test";

import { createAchilleaSql, destroyAchilleaSql } from "./achillea-sql";

describe("Achillea Kysely boundary", () => {
	afterEach(async () => {
		await destroyAchilleaSql();
	});

	test("shares one Kysely pool per connection configuration", () => {
		const first = createAchilleaSql({
			url: "postgresql://postgres:postgres@127.0.0.1:5432/rg",
			maxConnections: 2,
		});
		const second = createAchilleaSql({
			url: "postgresql://postgres:postgres@127.0.0.1:5432/rg",
			maxConnections: 2,
		});

		expect(second).toBe(first);
	});
});
