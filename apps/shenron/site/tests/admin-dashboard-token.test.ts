/** Authentification Bearer de la sonde du tableau de bord, sans secret réel. */
import { describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));
mock.module("@/lib/session", () => ({ isCurrentUserAdmin: async () => false }));
mock.module("@/lib/api-token", () => ({
	hasValidApiToken: (req: Request) => req.headers.get("authorization") === "Bearer test-admin-token",
}));
mock.module("@/lib/config", () => ({ API_URL: "http://bot.test" }));
mock.module("@/lib/env", () => ({ env: { SHENRON_ADMIN_TOKEN: "test-admin-token" } }));
mock.module("@/lib/db", () => ({ db: { execute: async () => [{ ok: 1 }] } }));
mock.module("@shenron/pipeline/aphrody/a2a", () => ({
	ShenronA2AHub: {
		configure: () => {}, listEnvelopes: () => [], listTasks: async () => [] },
}));
mock.module("bun", () => ({ RedisClient: class { send = async () => "PONG"; } }));

globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
const { GET } = await import("../src/app/api/admin/dashboard-live/route");

describe("sonde dashboard par jeton admin", () => {
	test("refuse l'anonyme et accepte le Bearer valide", async () => {
		expect((await GET(new NextRequest("http://test/api/admin/dashboard-live"))).status).toBe(403);
		const response = await GET(
			new NextRequest("http://test/api/admin/dashboard-live", {
				headers: { authorization: "Bearer test-admin-token" },
			})
		);
		expect(response.status).toBe(200);
	});
});
