/**
 * Instantané statut/corps des 15 routes « admin ou jeton » (W4-AUTH-01).
 *
 * Chaque handler exporté est traversé en process avec quatre appelants :
 * anonyme, session admin, Bearer valide, Bearer erroné. Les modules de session,
 * de jeton et de stockage sont simulés (aucune base, aucun secret réel) ; les
 * valeurs volatiles (latences, horodatages) sont normalisées. L'instantané a été
 * produit sur les routes non modifiées : la bascule vers `@/lib/admin-guard`
 * doit le laisser strictement identique.
 *
 * Le second bloc épingle le chemin rapide du proxy (`src/proxy.ts`) : un
 * visiteur sans cookie d'authentification ne déclenche jamais la résolution
 * d'identité, un cookie de session Better Auth ou `dbfr_admin` la déclenche, et
 * toute erreur retombe sur l'anonyme (fail-closed).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import * as realFs from "node:fs/promises";
import * as realNet from "node:net";
import { NextRequest } from "next/server";

const ADMIN_DISCORD_ID = "123456789012345678";

let isAdmin = false;
let currentUser: { user: { id: string; roleAdmin: boolean }; discordId: string } | null = null;

mock.module("server-only", () => ({}));
mock.module("@/lib/session", () => ({
	isCurrentUserAdmin: async () => isAdmin,
	getCurrentUser: async () => currentUser,
}));
mock.module("@/lib/api-token", () => ({
	hasValidApiToken: (req: Request) => req.headers.get("authorization") === "Bearer test-admin-token",
	expectedApiToken: () => "test-admin-token",
}));
mock.module("@/lib/config", () => ({
	API_URL: "http://bot.test",
	SITE_URL: "https://dragonballfr.com",
}));
mock.module("@/lib/env", () => ({ env: { SHENRON_ADMIN_TOKEN: "test-admin-token" } }));
mock.module("@/lib/db", () => ({ db: { execute: async () => [{ ok: 1 }] } }));
mock.module("@shenron/pipeline/aphrody/a2a", () => ({
	ShenronA2AHub: { configure: () => {}, listEnvelopes: () => [], listTasks: async () => [] },
}));
mock.module("bun", () => ({ RedisClient: class { send = async () => "PONG"; } }));
// Sonde Redis de dashboard-live : socket TCP simulée qui échoue toujours de la
// même façon, pour que l'instantané ne dépende pas d'un Redis local.
const fakeConnect = () => {
	const socket = Object.assign(new EventEmitter(), {
		setTimeout: () => socket,
		end: () => {},
		destroy: () => {},
	});
	queueMicrotask(() => socket.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379")));
	return socket;
};
mock.module("node:net", () => ({ ...realNet, default: { ...realNet, connect: fakeConnect }, connect: fakeConnect }));
mock.module("node:fs/promises", () => ({
	...realFs,
	readdir: async () => ["goku.png", "goku.webp", "vegeta.jpg", "notes.txt"],
}));

mock.module("@/lib/home-config", () => ({
	getHomeConfig: async () => ({ version: 1, hero: { lede: "défaut", scenes: [] } }),
	saveHomeConfig: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("@/lib/banner-config", () => ({
	getPageBanners: async () => ({ fallback: "/banners/default.jpg", pages: {}, series: {} }),
	savePageBanners: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("@/lib/theme-config", () => ({
	getSiteTheme: async () => ({ version: 1, colors: {}, radius: 1 }),
	saveSiteTheme: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("@/lib/chronology-config", () => ({
	getChronologyConfig: async () => ({ overrides: {} }),
	saveChronologyConfig: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("@/lib/db-universe", () => ({ dbUniverse: { timeline: async () => [] } }));
mock.module("@/lib/canon-config", () => ({
	getCanonConfig: async () => ({ version: 1 }),
	getCanonReferences: async () => [],
	saveCanonConfig: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("@/lib/wiki-launch-config", () => ({
	getLaunchConfig: async () => ({ openKeys: [], order: [], access: {} }),
	saveLaunchConfig: async (patch: unknown, by?: string | null) => ({ patch, by }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

mock.module("@/lib/databooks", () => ({
	DATABOOK_LIMIT_MAX: 100,
	getDatabook: async () => null,
	listDatabooks: async (q: { includeHidden?: boolean }) => ({
		items: [],
		total: 0,
		includeHidden: q.includeHidden === true,
	}),
	createDatabook: async (body: unknown) => ({ id: 1, body }),
	updateDatabook: async () => null,
	deleteDatabook: async () => false,
}));
mock.module("@/lib/databooks-transcription", () => ({
	chercherDansPlanches: async (terme: string, o: { includeHidden?: boolean }) => ({
		results: [],
		terme,
		includeHidden: o.includeHidden === true,
	}),
}));
mock.module("@/lib/databooks-freeze", () => ({ databooksFreeze: () => null }));
mock.module("@/lib/databooks-redis", () => ({ indexDatabook: async () => {} }));
mock.module("@/lib/wiki-revisions", () => ({ recordRevision: async () => {} }));
mock.module("@/lib/wiki-revalidate", () => ({ revalidateWikiEntity: () => {} }));
mock.module("@/lib/ja", () => ({ anomaliesOuvrage: async () => ({ total: 0, planches: [] }) }));

// Proxy : identité simulée, compteur d'appels pour épingler le chemin rapide.
let resolveCalls = 0;
let resolveThrows = false;
mock.module("@/lib/proxy-admin", () => ({
	resolveVisitor: async () => {
		resolveCalls += 1;
		if (resolveThrows) throw new Error("session store down");
		return { isAdmin: true, authenticated: true, discordId: ADMIN_DISCORD_ID };
	},
}));
mock.module("@/lib/member-roles", () => ({ getMemberRoleIds: async () => [] }));

globalThis.fetch = mock(
	async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })
) as unknown as typeof fetch;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, unknown>> }) => unknown;
type RouteModule = Record<string, unknown>;

interface RouteCase {
	name: string;
	mod: RouteModule;
	url: string;
	params?: Record<string, unknown>;
	body?: string;
}

const routes: RouteCase[] = [
	{ name: "admin/banner-library", mod: await import("../src/app/api/admin/banner-library/route"), url: "/api/admin/banner-library" },
	{ name: "admin/dashboard-live", mod: await import("../src/app/api/admin/dashboard-live/route"), url: "/api/admin/dashboard-live" },
	{ name: "banner-config", mod: await import("../src/app/api/banner-config/route"), url: "/api/banner-config", body: "{}" },
	{ name: "canon-config", mod: await import("../src/app/api/canon-config/route"), url: "/api/canon-config", body: "{}" },
	{ name: "chronologie-config", mod: await import("../src/app/api/chronologie-config/route"), url: "/api/chronologie-config", body: "{}" },
	{ name: "databooks/[id]/anomalies", mod: await import("../src/app/api/databooks/[id]/anomalies/route"), url: "/api/databooks/999/anomalies", params: { id: "999" } },
	{ name: "databooks/[id]/pages", mod: await import("../src/app/api/databooks/[id]/pages/route"), url: "/api/databooks/999/pages", params: { id: "999" }, body: "{}" },
	{ name: "databooks/[id]/relecture-ocr", mod: await import("../src/app/api/databooks/[id]/relecture-ocr/route"), url: "/api/databooks/999/relecture-ocr", params: { id: "999" } },
	{ name: "databooks/[id]", mod: await import("../src/app/api/databooks/[id]/route"), url: "/api/databooks/999", params: { id: "999" }, body: "{}" },
	{ name: "databooks/[id]/transcription", mod: await import("../src/app/api/databooks/[id]/transcription/route"), url: "/api/databooks/999/transcription", params: { id: "999" }, body: "{}" },
	{ name: "databooks", mod: await import("../src/app/api/databooks/route"), url: "/api/databooks?includeHidden=1", body: "{}" },
	{ name: "databooks/search", mod: await import("../src/app/api/databooks/search/route"), url: "/api/databooks/search?q=kamehameha&includeHidden=1" },
	{ name: "home-config", mod: await import("../src/app/api/home-config/route"), url: "/api/home-config", body: "{}" },
	{ name: "theme-config", mod: await import("../src/app/api/theme-config/route"), url: "/api/theme-config", body: "{}" },
	{ name: "wiki-launch", mod: await import("../src/app/api/wiki-launch/route"), url: "/api/wiki-launch", body: "{}" },
];

const { proxy } = await import("../src/proxy");

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

const CALLERS = {
	anonymous: () => {
		isAdmin = false;
		currentUser = null;
		return {} as Record<string, string>;
	},
	sessionAdmin: () => {
		isAdmin = true;
		currentUser = { user: { id: "user-admin", roleAdmin: true }, discordId: ADMIN_DISCORD_ID };
		return {} as Record<string, string>;
	},
	validBearer: () => {
		isAdmin = false;
		currentUser = null;
		return { authorization: "Bearer test-admin-token" } as Record<string, string>;
	},
	wrongBearer: () => {
		isAdmin = false;
		currentUser = null;
		return { authorization: "Bearer wrong-token-0000000000" } as Record<string, string>;
	},
} as const;

const VOLATILE_KEYS = new Set(["latencyMs", "sampledAt", "latestActivityAt"]);

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = VOLATILE_KEYS.has(k) && v !== null ? `<${k}>` : normalize(v);
		}
		return out;
	}
	return value;
}

async function outcome(res: Response): Promise<{ status: number; cacheControl: string | null; body: unknown }> {
	const text = await res.text();
	let body: unknown = text === "" ? null : text;
	try {
		body = text === "" ? null : JSON.parse(text);
	} catch {
		// corps non JSON : conservé tel quel
	}
	return { status: res.status, cacheControl: res.headers.get("cache-control"), body: normalize(body) };
}

beforeEach(() => {
	isAdmin = false;
	currentUser = null;
	resolveCalls = 0;
	resolveThrows = false;
});

describe("15 routes admin-ou-jeton : instantané statut/corps", () => {
	for (const route of routes) {
		const methods = METHODS.filter((m) => typeof route.mod[m] === "function");
		test(`${route.name} (${methods.join(", ")})`, async () => {
			expect(methods.length).toBeGreaterThan(0);
			const snapshot: Record<string, unknown> = {};
			for (const method of methods) {
				for (const [caller, setup] of Object.entries(CALLERS)) {
					const headers = setup();
					const hasBody = route.body !== undefined && method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
					if (hasBody) headers["content-type"] = "application/json";
					const req = new NextRequest(`http://test${route.url}`, {
						method,
						headers,
						body: hasBody ? route.body : undefined,
					});
					const handler = route.mod[method] as Handler;
					const res = (await handler(req, { params: Promise.resolve(route.params ?? {}) })) as Response;
					snapshot[`${method} ${caller}`] = await outcome(res);
				}
			}
			expect(snapshot).toMatchSnapshot();
		});
	}
});

describe("proxy : chemin rapide anonyme et gating /admin", () => {
	const adminRequest = (cookie?: string) =>
		new NextRequest("http://localhost/admin/databooks", {
			headers: { host: "localhost", ...(cookie ? { cookie } : {}) },
		});

	test("sans cookie d'authentification : redirection sans résolution d'identité", async () => {
		const res = await proxy(adminRequest());
		expect(res.status).toBe(307);
		expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
		expect(resolveCalls).toBe(0);
	});

	test("un cookie étranger ne sort pas du chemin rapide", async () => {
		const res = await proxy(adminRequest("theme=dark; NEXT_LOCALE=fr"));
		expect(res.status).toBe(307);
		expect(resolveCalls).toBe(0);
	});

	for (const cookie of [
		"better-auth.session_token=abc.def",
		"__Secure-better-auth.session_token=abc.def",
		"dbfr_admin=1767225600000.deadbeef",
	]) {
		test(`cookie « ${cookie.split("=")[0]} » : identité résolue, admin admis`, async () => {
			const res = await proxy(adminRequest(cookie));
			expect(resolveCalls).toBe(1);
			expect(res.status).toBe(200);
			expect(res.headers.get("location")).toBeNull();
		});
	}

	test("fail-closed : une erreur de résolution retombe sur l'anonyme", async () => {
		resolveThrows = true;
		const res = await proxy(adminRequest("better-auth.session_token=abc.def"));
		expect(resolveCalls).toBe(1);
		expect(res.status).toBe(307);
		expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
	});
});

describe("proxy : préfixe de cookie aligné sur la configuration Better Auth", () => {
	test("auth.ts ne fixe aucun cookiePrefix (le proxy suppose « better-auth »)", async () => {
		const authSource = await Bun.file(new URL("../src/lib/auth.ts", import.meta.url)).text();
		const proxySource = await Bun.file(new URL("../src/proxy.ts", import.meta.url)).text();
		expect(authSource).not.toMatch(/cookiePrefix/);
		expect(proxySource).toMatch(/SESSION_COOKIE_PREFIX = "better-auth"/);
	});
});
