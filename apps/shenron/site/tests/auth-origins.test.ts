/**
 * S2 (docs/STACK.md §2.2) : politique d'hôtes et d'origines du site.
 *
 * - `src/lib/auth.ts` n'est pas importable (Postgres + secrets) : on relit sa
 *   source pour vérifier qu'elle consomme `@shenron/auth/origins`.
 * - `src/proxy.ts` est importé avec ses dépendances serveur simulées : un hôte
 *   de preview Vercel est désormais redirigé vers le domaine canonique.
 */
import { describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { siteAllowedHosts, siteTrustedOrigins } from "@shenron/auth/origins";

mock.module("@/lib/proxy-admin", () => ({
	resolveVisitor: async () => ({ kind: "anonymous" }),
}));
mock.module("@/lib/wiki-launch-config", () => ({ getLaunchConfig: async () => null }));
mock.module("@/lib/wiki-launch", () => ({
	findEntry: () => null,
	resolveAccess: () => ({ allowed: true }),
}));
mock.module("@/lib/member-roles", () => ({ getMemberRoleIds: async () => [] }));

const { proxy } = await import("../src/proxy");

const authSrc = await Bun.file(new URL("../src/lib/auth.ts", import.meta.url)).text();

function request(host: string, path = "/"): NextRequest {
	return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

describe("S2 — auth.ts consomme la politique partagée", () => {
	test("allowedHosts et trustedOrigins dérivent de NODE_ENV", () => {
		// buildAuthOptions dérive `production` de l'env injecté, puis le passe aux deux listes.
		expect(authSrc).toMatch(/const production = authEnv\.NODE_ENV === "production";/);
		expect(authSrc).toMatch(/allowedHosts:\s*siteAllowedHosts\(\{\s*production\s*\}\)/);
		expect(authSrc).toMatch(/trustedOrigins:\s*siteTrustedOrigins\(\{\s*production\s*\}\)/);
		expect(authSrc).toMatch(/advanced:\s*advancedOptions\(\{\s*production\s*\}\)/);
		expect(authSrc).not.toContain("*.vercel.app\"");
		expect(authSrc).not.toContain("SHENRON_ALLOWED_HOSTS");
	});

	test("listes de production sans joker ni localhost", () => {
		for (const entry of [
			...siteAllowedHosts({ production: true }),
			...siteTrustedOrigins({ production: true }),
		]) {
			expect(entry).not.toContain("*");
			expect(entry).not.toContain("localhost");
		}
	});
});

describe("S2 — proxy : hôte non canonique", () => {
	test("un hôte de preview Vercel est redirigé (308) vers dragonballfr.com", async () => {
		const res = await proxy(request("dbfr-git-feature-aphrody.vercel.app", "/wiki?x=1"));
		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("https://dragonballfr.com/wiki?x=1");
	});

	test("l'alias nommé dbfr.vercel.app est redirigé aussi", async () => {
		const res = await proxy(request("dbfr.vercel.app", "/"));
		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("https://dragonballfr.com/");
	});

	test("localhost n'est pas redirigé vers le canonique", async () => {
		const res = await proxy(request("localhost:3000", "/news?page=2"));
		expect(res.headers.get("location")).toBe("https://localhost:3000/news/page/2");
	});
});
