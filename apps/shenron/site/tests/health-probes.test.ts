import { describe, expect, it } from "bun:test";
import { GET as getLiveness } from "../src/app/api/health/route";
import { GET as getLiveAlias } from "../src/app/api/health/live/route";
import { createReadinessHandler, GET as defaultGetReadiness } from "../src/app/api/health/ready/route";
import type { ServiceHealth } from "../src/lib/service-health";

describe("S2 — Site Liveness & Readiness Separation", () => {
	describe("Liveness probe (/api/health and /api/health/live)", () => {
		it("returns 200 with pure process liveness independent of downstream API/DB", async () => {
			const res = await getLiveness();
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("no-store");

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("ok");
			expect(body.service).toBe("site");
			expect(body.probe).toBe("liveness");
			expect(body.checks.http).toBe("ok");
			expect(body.failureSemantics).toBeDefined();
			expect(body.failureSemantics).toContain("Liveness probe");
		});

		it("/api/health/live aliases the liveness probe cleanly", async () => {
			const res = await getLiveAlias();
			expect(res.status).toBe(200);

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("ok");
			expect(body.probe).toBe("liveness");
			expect(body.checks.http).toBe("ok");
		});
	});

	describe("Readiness probe (/api/health/ready)", () => {
		it("returns 200 when all upstream checks are ok or disabled", async () => {
			const handler = createReadinessHandler({
				probeHttp: async () => "ok",
				probeDatabase: async () => "ok",
			});

			const res = await handler();
			expect(res.status).toBe(200);
			expect(res.headers.get("cache-control")).toBe("no-store");

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("ok");
			expect(body.probe).toBe("readiness");
			expect(body.checks.api).toBe("ok");
			expect(body.checks.database).toBe("ok");
			expect(body.failureSemantics).toContain("Readiness probe");
		});

		it("returns 200 when database is not configured (disabled)", async () => {
			const handler = createReadinessHandler({
				probeHttp: async () => "ok",
				probeDatabase: async () => "disabled",
			});

			const res = await handler();
			expect(res.status).toBe(200);

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("ok");
			expect(body.checks.database).toBe("disabled");
		});

		it("returns 503 degraded when upstream API is unreachable", async () => {
			const handler = createReadinessHandler({
				probeHttp: async () => "unreachable",
				probeDatabase: async () => "ok",
			});

			const res = await handler();
			expect(res.status).toBe(503);
			expect(res.headers.get("cache-control")).toBe("no-store");

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("degraded");
			expect(body.probe).toBe("readiness");
			expect(body.checks.api).toBe("unreachable");
			expect(body.checks.database).toBe("ok");
		});

		it("returns 503 degraded when upstream database is unreachable", async () => {
			const handler = createReadinessHandler({
				probeHttp: async () => "ok",
				probeDatabase: async () => "unreachable",
			});

			const res = await handler();
			expect(res.status).toBe(503);

			const body = (await res.json()) as ServiceHealth;
			expect(body.status).toBe("degraded");
			expect(body.checks.database).toBe("unreachable");
		});

		it("default GET handler executes without unhandled exceptions", async () => {
			const res = await defaultGetReadiness();
			expect([200, 503]).toContain(res.status);
			const body = (await res.json()) as ServiceHealth;
			expect(body.probe).toBe("readiness");
			expect(body.service).toBe("site");
		});
	});
});
