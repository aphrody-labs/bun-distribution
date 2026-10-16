import { describe, expect, test } from "bun:test";
import { PostgresQueryBuilder } from "./postgres-client";

function capture() {
	const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
	return {
		queries,
		executor: { executeQuery: async (query: { sql: string; parameters: readonly unknown[] }) => { queries.push(query); return { rows: [{ id: "1" }] }; } },
	};
}

describe("PostgresQueryBuilder", () => {
	test("keeps UPDATE placeholders aligned with parameters", async () => {
		const { executor, queries } = capture();
		const result = await new PostgresQueryBuilder(executor, "profiles")
			.update({ role: "admin", updated_at: "now" })
			.eq("id", "user-1")
			.eq("role", "staff");

		expect(result.error).toBeNull();
		expect(queries[0]?.sql).toContain('SET "role" = $1, "updated_at" = $2');
		expect(queries[0]?.sql).toContain('WHERE "id" = $3 AND "role" = $4');
		expect(queries[0]?.parameters).toEqual(["admin", "now", "user-1", "staff"]);
	});

	test("parameterizes upserts and excludes the conflict key", async () => {
		const { executor, queries } = capture();
		await new PostgresQueryBuilder(executor, "tweets").upsert(
			{ id: "tweet-1", text: "a; DROP TABLE tweets;" },
			{ onConflict: "id" },
		);

		expect(queries[0]?.sql).not.toContain("DROP TABLE");
		expect(queries[0]?.parameters).toEqual(["tweet-1", "a; DROP TABLE tweets;"]);
		expect(queries[0]?.sql).toContain('ON CONFLICT ("id") DO UPDATE SET "text" = EXCLUDED."text"');
	});

	test("supports PostgREST null and not-null filters in OR expressions", async () => {
		const { executor, queries } = capture();
		await new PostgresQueryBuilder(executor, "inagle_characters")
			.select("id")
			.or("sheet_data.not.is.null,is_controllable.eq.true,zukan_order.not.is.null");

		expect(queries[0]?.sql).toContain('"sheet_data" IS NOT NULL');
		expect(queries[0]?.sql).toContain('"is_controllable" = $1');
		expect(queries[0]?.sql).toContain('"zukan_order" IS NOT NULL');
	});

	test("maps not-is-null to IS NOT NULL", async () => {
		const { executor, queries } = capture();
		await new PostgresQueryBuilder(executor, "profiles")
			.select("id")
			.not("email", "is", null);

		expect(queries[0]?.sql).toContain('"email" IS NOT NULL');
	});

	test("parameterizes full-text search queries", async () => {
		const { executor, queries } = capture();
		await new PostgresQueryBuilder(executor, "articles")
			.select("id")
			.textSearch("search_vector", "rose & griffon", { config: "french" });

		expect(queries[0]?.sql).toContain('"search_vector" @@ to_tsquery($1, $2)');
		expect(queries[0]?.parameters).toEqual(["french", "rose & griffon"]);
	});
});
