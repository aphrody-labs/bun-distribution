/**
 * Contrat des API de configuration exposées par le tableau de bord admin.
 *
 * Les trois écrans modifient des singletons PostgreSQL, puis demandent une
 * invalidation ISR. Cette suite traverse les vrais handlers avec une mémoire
 * de test à la place de PG : elle verrouille le gate Better Auth, l'identité
 * d'audit transmise à l'écriture et les invalidations qui rendent le réglage
 * visible sans attendre le TTL. Aucun jeton ni base de production n'est lu.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

let isAdmin = false;
let currentUser: { user: { id: string; roleAdmin: boolean }; discordId: string } | null = null;
const writes: Array<{ kind: string; patch: unknown; by?: string | null }> = [];
const revalidated: Array<[string, "layout" | "page" | undefined]> = [];

mock.module("@/lib/session", () => ({
	isCurrentUserAdmin: async () => isAdmin,
	getCurrentUser: async () => currentUser,
}));
mock.module("@/lib/api-token", () => ({
	hasValidApiToken: (req: Request) => req.headers.get("authorization") === "Bearer test-admin-token",
}));
mock.module("@/lib/home-config", () => ({
	getHomeConfig: async () => ({ version: 1, hero: { lede: "défaut", scenes: [] } }),
	saveHomeConfig: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "home", patch, by });
		return patch;
	},
}));
mock.module("@/lib/banner-config", () => ({
	getPageBanners: async () => ({ fallback: "/banners/default.jpg", pages: {}, series: {} }),
	savePageBanners: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "banners", patch, by });
		return patch;
	},
}));
mock.module("@/lib/theme-config", () => ({
	getSiteTheme: async () => ({ version: 1, colors: {}, radius: 1 }),
	saveSiteTheme: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "theme", patch, by });
		return patch;
	},
}));
mock.module("@/lib/chronology-config", () => ({
	getChronologyConfig: async () => ({ overrides: {} }),
	saveChronologyConfig: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "chronology", patch, by });
		return patch;
	},
}));
mock.module("@/lib/db-universe", () => ({
	dbUniverse: { timeline: async () => [] },
}));
mock.module("@/lib/canon-config", () => ({
	getCanonConfig: async () => ({ version: 1 }),
	getCanonReferences: async () => [],
	saveCanonConfig: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "canon", patch, by });
		return patch;
	},
}));
mock.module("@/lib/wiki-launch-config", () => ({
	getLaunchConfig: async () => ({ openKeys: [], order: [], access: {} }),
	saveLaunchConfig: async (patch: unknown, by?: string | null) => {
		writes.push({ kind: "launch", patch, by });
		return patch;
	},
}));
mock.module("next/cache", () => ({
	revalidatePath: (path: string, type?: "layout" | "page") => revalidated.push([path, type]),
}));

const home = await import("../src/app/api/home-config/route");
const banners = await import("../src/app/api/banner-config/route");
const theme = await import("../src/app/api/theme-config/route");
const chronology = await import("../src/app/api/chronologie-config/route");
const canon = await import("../src/app/api/canon-config/route");
const launch = await import("../src/app/api/wiki-launch/route");

const request = (url: string, body: unknown) =>
	new NextRequest(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

const tokenRequest = (url: string, body: unknown) =>
	new NextRequest(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json", Authorization: "Bearer test-admin-token" },
		body: JSON.stringify(body),
	});

beforeEach(() => {
	isAdmin = false;
	currentUser = null;
	writes.length = 0;
	revalidated.length = 0;
});

describe("API de configuration du dashboard — Better Auth + persistance", () => {
	test("refusent toute lecture ou écriture lorsqu'aucune session admin n'est présente", async () => {
		for (const route of [home, banners, theme, chronology, canon, launch]) {
			expect((await route.GET(new NextRequest("http://test/api/config"))).status).toBe(403);
			expect((await route.PUT(request("http://test/api/admin", { version: 1 }))).status).toBe(403);
		}
		expect(writes).toEqual([]);
	});

	test("enregistre la configuration home sous l'identité admin et purge l'accueil", async () => {
		currentUser = { user: { id: "user-1", roleAdmin: true }, discordId: "discord-1" };
		const patch = { hero: { lede: "Une nouvelle légende", scenes: [] } };

		const response = await home.PUT(request("http://test/api/home-config", patch));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, config: patch });
		expect(writes).toEqual([{ kind: "home", patch, by: "discord-1" }]);
		expect(revalidated).toEqual([["/", undefined]]);
	});

	test("enregistre les bannières héros et invalide toutes les pages concernées", async () => {
		currentUser = { user: { id: "user-2", roleAdmin: true }, discordId: "" };
		const patch = { pages: { episodes: "/banners/new-episodes.jpg" } };

		const response = await banners.PUT(request("http://test/api/banner-config", patch));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, banners: patch });
		expect(writes).toEqual([{ kind: "banners", patch, by: "user-2" }]);
		expect(revalidated).toContainEqual(["/wiki/episodes", undefined]);
		expect(revalidated).toContainEqual(["/wiki/episodes/serie/[series]", "page"]);
		expect(revalidated).toContainEqual(["/actualites", undefined]);
		expect(revalidated).toContainEqual(["/", "layout"]);
	});

	test("accepte le jeton d'administration sans session et laisse une identité d'audit", async () => {
		const cases = [
			{ route: home, url: "home-config", patch: { hero: { lede: "token" } }, kind: "home", path: "/" },
			{ route: banners, url: "banner-config", patch: { pages: { episodes: "/banners/verified-by-token.jpg" } }, kind: "banners", path: "/wiki/episodes" },
			{ route: theme, url: "theme-config", patch: { colors: { ember: "#123456" } }, kind: "theme", path: "/" },
			{ route: chronology, url: "chronologie-config", patch: { overrides: {} }, kind: "chronology", path: "/wiki/chronologie" },
			{ route: canon, url: "canon-config", patch: { version: 1 }, kind: "canon", path: "/wiki/canon" },
			{ route: launch, url: "wiki-launch", patch: { openKeys: ["wiki"] }, kind: "launch", path: "/" },
		] as const;

		for (const item of cases) {
			const response = await item.route.PUT(tokenRequest(`http://test/api/${item.url}`, item.patch));
			expect(response.status).toBe(200);
			expect(writes).toContainEqual({ kind: item.kind, patch: item.patch, by: "token-admin" });
			expect(revalidated.some(([path]) => path === item.path)).toBe(true);
		}
	});

	test("enregistre le thème de site et invalide le layout global", async () => {
		currentUser = { user: { id: "user-3", roleAdmin: true }, discordId: "discord-3" };
		const patch = { colors: { ember: "#123456" } };

		const response = await theme.PUT(request("http://test/api/theme-config", patch));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, theme: patch });
		expect(writes).toEqual([{ kind: "theme", patch, by: "discord-3" }]);
		expect(revalidated).toEqual([["/", "layout"]]);
	});
});
