import { afterEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));
let isAdmin = true;
mock.module("@/lib/session", () => ({ isCurrentUserAdmin: async () => isAdmin }));
mock.module("@/lib/api-token", () => ({
	hasValidApiToken: (req: Request) => req.headers.get("authorization") === "Bearer test-admin-token",
}));
mock.module("@/lib/config", () => ({ API_URL: "http://bot.test" }));
mock.module("@/lib/env", () => ({ env: { SHENRON_ADMIN_TOKEN: "test-admin-token" } }));
mock.module("@/lib/db", () => ({ db: { execute: async () => [{ ok: 1 }] } }));
mock.module("@shenron/pipeline/aphrody/a2a", () => ({
	ShenronA2AHub: {
		configure: () => {},
		listEnvelopes: () => [{ id: "env-1", ts: new Date().toISOString(), from: "codex", to: "shenron-dragonball" }],
		listTasks: async () => [{ status: "working" }],
	},
}));
mock.module("bun", () => ({
	RedisClient: class { send = async () => "PONG"; },
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mock(
	async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })
) as unknown as typeof fetch;

const { GET } = await import("../src/app/api/admin/dashboard-live/route");

afterEach(() => {
	globalThis.fetch = originalFetch;
	isAdmin = true;
});

describe("sondes live du dashboard admin", () => {
	test("mesure API, PostgreSQL, Redis, BO et activité A2A dans un instantané non caché", async () => {
		const response = await GET(new NextRequest("http://test/api/admin/dashboard-live"));
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");

		const body = await response.json();
		expect(body.services.map((service: { id: string }) => service.id)).toEqual([
			"api",
			"database",
			"redis",
			"backOffice",
		]);
		expect(body.services.every((service: { latencyMs: unknown }) => typeof service.latencyMs === "number")).toBe(true);
		expect(body.agents.activePeers).toEqual(["codex"]);
		expect(body.agents.activeTasks).toBe(1);
		expect(typeof body.sampledAt).toBe("string");
	});

	test("sert les requêtes suivantes depuis le cache in-memory dans la fenêtre de TTL", async () => {
		const res1 = await GET(new NextRequest("http://test/api/admin/dashboard-live"));
		const body1 = await res1.json();

		const res2 = await GET(new NextRequest("http://test/api/admin/dashboard-live"));
		const body2 = await res2.json();

		expect(body2.sampledAt).toBe(body1.sampledAt);
		expect(body2.refreshAfterMs).toBe(10_000);
	});

	test("accepte le jeton admin pour le contrôle automatisé du dashboard", async () => {
		isAdmin = false;
		expect((await GET(new NextRequest("http://test/api/admin/dashboard-live"))).status).toBe(403);
		const response = await GET(
			new NextRequest("http://test/api/admin/dashboard-live", {
				headers: { authorization: "Bearer test-admin-token" },
			})
		);
		expect(response.status).toBe(200);
	});
});
