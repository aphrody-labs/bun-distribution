import { describe, expect, test } from "bun:test";

import { createAchilleaClient, type AchilleaFetch } from "../src/v1";

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

describe("v1 HTTP client", () => {
	test("calls and validates the paginated guild endpoint", async () => {
		let requestedUrl = "";
		const fetch: AchilleaFetch = async (input) => {
			requestedUrl = String(input);
			return jsonResponse({
				data: [],
				meta: { page: 2, limit: 10, total: 0, pageCount: 0 },
			});
		};
		const client = createAchilleaClient({
			baseUrl: "https://example.test/api///",
			fetch,
		});

		const result = await client.guilds.list(2, 10);

		expect(requestedUrl).toBe("https://example.test/api/guilds?page=2&limit=10");
		expect(result).toEqual({
			ok: true,
			value: { data: [], meta: { page: 2, limit: 10, total: 0, pageCount: 0 } },
		});
	});

	test("returns an HTTP failure without attempting response validation", async () => {
		const client = createAchilleaClient({
			fetch: async () => jsonResponse({ error: "maintenance" }, 503),
		});

		const result = await client.guilds.stats();

		expect(result).toEqual({
			ok: false,
			kind: "http",
			detail: "HTTP 503 for /guilds/stats",
			path: "/guilds/stats",
			status: 503,
		});
	});

	test("distinguishes invalid JSON from a schema drift", async () => {
		const invalidJsonClient = createAchilleaClient({
			fetch: async () => new Response("not JSON"),
		});
		const driftedClient = createAchilleaClient({
			fetch: async () => jsonResponse({ data: [], meta: { page: "one" } }),
		});

		const invalidJson = await invalidJsonClient.guilds.stats();
		const drifted = await driftedClient.guilds.list();

		expect(invalidJson.ok).toBe(false);
		if (!invalidJson.ok) expect(invalidJson.kind).toBe("invalid_json");
		expect(drifted).toMatchObject({
			ok: false,
			kind: "invalid_response",
			path: "/guilds?page=1&limit=25",
		});
		if (!drifted.ok) expect(drifted.detail).toStartWith("meta.page :");
	});

	test("returns unreachable when Fetch rejects", async () => {
		const client = createAchilleaClient({
			fetch: async () => {
				throw new Error("connection refused");
			},
		});

		const result = await client.guilds.get("123/456");

		expect(result).toEqual({
			ok: false,
			kind: "unreachable",
			detail: "connection refused",
			path: "/guilds/123%2F456",
		});
	});
});
