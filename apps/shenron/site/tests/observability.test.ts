import { describe, expect, test } from "bun:test";
import { createServiceHealth, probeHttp } from "../src/lib/service-health";

describe("service health contract", () => {
	test("uses a common, timestamped shape for site, bot and MCP", () => {
		const now = new Date("2026-09-14T12:30:00.000Z");
		for (const service of ["site", "bot", "mcp"] as const) {
			expect(createServiceHealth(service, "1.2.3", { http: "ok" }, now)).toEqual({
				status: "ok",
				service,
				version: "1.2.3",
				timestamp: now.toISOString(),
				checks: { http: "ok" },
			});
		}
	});

	test("classifies HTTP and network failures without disguising them as healthy", async () => {
		expect(
			await probeHttp("https://example.test", async () => new Response(null, { status: 503 }))
		).toBe("http_503");
		expect(
			await probeHttp("https://example.test", async () => {
				throw new Error("offline");
			})
		).toBe("unreachable");
		expect(createServiceHealth("site", "1", { api: "unreachable" }).status).toBe("degraded");
	});
});

describe("UI observability invariants", () => {
	test("keeps canonical URL, Japanese semantics and hydration strategy explicit", async () => {
		const [layout, character, translated, variantsRoute] = await Promise.all([
			Bun.file(new URL("../src/app/layout.tsx", import.meta.url)).text(),
			Bun.file(new URL("../src/app/wiki/personnages/[slug]/page.tsx", import.meta.url)).text(),
			Bun.file(new URL("../src/components/T.tsx", import.meta.url)).text(),
			Bun.file(new URL("../src/app/api/wiki/variants/route.ts", import.meta.url)).text(),
		]);
		expect(layout).toContain("metadataBase: new URL(SITE_URL)");
		expect(character).toContain('lang="ja"');
		expect(character).toContain("font-jp");
		expect(translated).toContain("the server renders the");
		expect(translated).toContain("French text into the cached HTML");
		expect(translated).toContain("at hydration");
		expect(variantsRoute).not.toContain("catch(() => [])");
		expect(variantsRoute).toContain('error: "database_unavailable"');
		expect(variantsRoute).toContain("status: 503");
	});
});
