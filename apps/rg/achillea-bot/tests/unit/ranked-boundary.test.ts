import { describe, expect, it } from "bun:test";

const rankedSource = await Bun.file(new URL("../../src/ranked/main.ts", import.meta.url)).text();

describe("ranked ownership boundary", () => {
	it("keeps public ranked reads behind the unified API proxy", () => {
		expect(rankedSource).toContain('proxyUnifiedRankedRead(req, res, "/tiers")');
		expect(rankedSource).toContain('proxyUnifiedRankedRead(req, res, "/me")');
		expect(rankedSource).toContain('proxyUnifiedRankedRead(req, res, "/leaderboard")');
		expect(rankedSource).not.toMatch(/app\.get\("\/api\/ranked\/(tiers|me|leaderboard)",\s*async/);
	});
});
