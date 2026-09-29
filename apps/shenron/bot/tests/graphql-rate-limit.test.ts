import "./setup";
import { afterAll, describe, expect, it } from "bun:test";
import { startHarness } from "../scripts/api-harness";

// S9 : `/graphql` passe par le limiteur public (60/min/IP, 429 + Retry-After 60).
let graphqlCalls = 0;
const server = startHarness({
	wiki: null,
	graphql: () => {
		graphqlCalls += 1;
		return Response.json({ data: { ok: true } });
	},
});
afterAll(() => server.stop(true));

const post = (ip: string) =>
	fetch(new URL("/graphql", server.url), {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-real-ip": ip },
		body: JSON.stringify({ query: "{ __typename }" }),
	});

describe("S9 — limiteur public sur /graphql", () => {
	it("la 61e requête de la minute depuis une IP → 429", async () => {
		for (let i = 1; i <= 60; i++) {
			const res = await post("198.51.100.61");
			expect(res.status).toBe(200);
		}
		const refused = await post("198.51.100.61");
		expect(refused.status).toBe(429);
		expect(refused.headers.get("retry-after")).toBe("60");
		expect(await refused.json()).toEqual({ error: "Rate limit (60/min)" });
		expect(graphqlCalls).toBe(60);
	});

	it("une autre IP garde son propre budget", async () => {
		const res = await post("198.51.100.62");
		expect(res.status).toBe(200);
	});

	it("le préflight OPTIONS n'est pas compté ni bloqué", async () => {
		const res = await fetch(new URL("/graphql", server.url), {
			method: "OPTIONS",
			headers: { "x-real-ip": "198.51.100.61" },
		});
		expect(res.status).toBe(200);
	});
});
