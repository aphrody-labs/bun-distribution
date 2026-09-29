/**
 * Façades auth du site (W3-AUTH-01, W3-AUTH-03) contre les vecteurs dorés des
 * tests de `@shenron/auth` (`packages/shenron/auth/test/tokens.test.ts`) : le cookie
 * `dbfr_admin` et le Bearer statique produits par le paquet sont acceptés par
 * `admin-token.ts` / `api-token.ts`, API publiques inchangées. S8 : un 401
 * anonyme de l'API agents n'écrit plus dans `agent_audit`.
 */
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	setSystemTime,
	test,
} from "bun:test";
import { createAdminCookieCodec } from "@shenron/auth/tokens";

// Vecteurs dorés du paquet (tokens.test.ts).
const SECRET = "golden-better-auth-secret-0123456789abcdef";
const TOKEN = "golden-admin-token-0123456789";
const NOW = 1767225600000;
const GOLDEN_COOKIE =
	"1767830400000.eb90ac9376e1c948167c1f62dcd30f4b21c8c45d6eb3a4008b84e0484441f44e";
const STATIC_BEARER = "a-static-token-0123456789";

const fakeEnv: { BETTER_AUTH_SECRET: string; SHENRON_ADMIN_TOKEN?: string } = {
	BETTER_AUTH_SECRET: SECRET,
	SHENRON_ADMIN_TOKEN: TOKEN,
};

const audit: unknown[] = [];
let agent: unknown = null;

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({ env: fakeEnv }));
mock.module("@/lib/agent-keys", () => ({
	authenticateAgent: async () => agent,
	agentCallsLastHour: async () => 0,
	recordAgentCall: async (entry: unknown) => {
		audit.push(entry);
	},
}));

const adminToken = await import("../src/lib/admin-token");
const apiToken = await import("../src/lib/api-token");
const agentApi = await import("../src/lib/agent-api");

describe("admin-token.ts — cookie dbfr_admin", () => {
	beforeEach(() => {
		setSystemTime(new Date(NOW));
		fakeEnv.SHENRON_ADMIN_TOKEN = TOKEN;
	});
	afterAll(() => {
		setSystemTime();
	});

	test("nom, durée et exports inchangés", () => {
		expect(adminToken.ADMIN_COOKIE).toBe("dbfr_admin");
		expect(adminToken.ADMIN_COOKIE_MAX_AGE).toBe(604800);
		expect(adminToken.adminTokenEnabled()).toBe(true);
	});

	test("le cookie doré du paquet est accepté, et la façade le reproduit octet pour octet", () => {
		expect(adminToken.verifyAdminCookie(GOLDEN_COOKIE)).toBe(true);
		expect(adminToken.buildAdminCookieValue()).toBe(GOLDEN_COOKIE);
		const codec = createAdminCookieCodec({ secret: SECRET, masterToken: TOKEN });
		expect(adminToken.verifyAdminCookie(codec.sign(NOW + 5000))).toBe(true);
	});

	test("refuse falsifié, expiré, jeton tourné ou fonctionnalité désactivée", () => {
		const [exp, sig] = GOLDEN_COOKIE.split(".") as [string, string];
		expect(adminToken.verifyAdminCookie(`${exp}.${sig.slice(0, -1)}0`)).toBe(false);
		expect(adminToken.verifyAdminCookie(`${Number(exp) + 1}.${sig}`)).toBe(false);
		expect(adminToken.verifyAdminCookie(null)).toBe(false);
		setSystemTime(new Date(Number(exp) + 1));
		expect(adminToken.verifyAdminCookie(GOLDEN_COOKIE)).toBe(false);
		setSystemTime(new Date(NOW));
		fakeEnv.SHENRON_ADMIN_TOKEN = `${TOKEN}-rotated`;
		expect(adminToken.verifyAdminCookie(GOLDEN_COOKIE)).toBe(false);
		fakeEnv.SHENRON_ADMIN_TOKEN = undefined;
		expect(adminToken.adminTokenEnabled()).toBe(false);
		expect(adminToken.verifyAdminCookie(GOLDEN_COOKIE)).toBe(false);
	});

	test("tokenMatches compare le jeton maître", () => {
		expect(adminToken.tokenMatches(TOKEN)).toBe(true);
		expect(adminToken.tokenMatches(`${TOKEN}x`)).toBe(false);
		expect(adminToken.tokenMatches("")).toBe(false);
	});
});

describe("api-token.ts — Bearer statique", () => {
	const saved = {
		DATABOOKS_API_TOKEN: process.env.DATABOOKS_API_TOKEN,
		SHENRON_ADMIN_TOKEN: process.env.SHENRON_ADMIN_TOKEN,
	};
	const req = (auth?: string) =>
		new Request(
			"http://site.test/api/x",
			auth === undefined ? {} : { headers: { authorization: auth } }
		);

	afterEach(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	test("le Bearer doré du paquet est accepté (schéma insensible à la casse)", () => {
		process.env.DATABOOKS_API_TOKEN = STATIC_BEARER;
		expect(apiToken.expectedApiToken()).toBe(STATIC_BEARER);
		expect(apiToken.hasValidApiToken(req(`Bearer ${STATIC_BEARER}`))).toBe(true);
		expect(apiToken.hasValidApiToken(req(`bearer   ${STATIC_BEARER}  `))).toBe(true);
		expect(apiToken.hasValidApiToken(req(`Bearer ${STATIC_BEARER}!`))).toBe(false);
		expect(apiToken.hasValidApiToken(req("Basic abc"))).toBe(false);
		expect(apiToken.hasValidApiToken(req())).toBe(false);
	});

	test("repli sur SHENRON_ADMIN_TOKEN, jeton trop court = écriture fermée", () => {
		delete process.env.DATABOOKS_API_TOKEN;
		process.env.SHENRON_ADMIN_TOKEN = ` ${STATIC_BEARER} `;
		expect(apiToken.expectedApiToken()).toBe(STATIC_BEARER);
		expect(apiToken.hasValidApiToken(req(`Bearer ${STATIC_BEARER}`))).toBe(true);
		process.env.SHENRON_ADMIN_TOKEN = "tooshort";
		expect(apiToken.expectedApiToken()).toBeNull();
		expect(apiToken.hasValidApiToken(req("Bearer tooshort"))).toBe(false);
	});
});

describe("agent-api.ts — S8", () => {
	beforeEach(() => {
		audit.length = 0;
		agent = null;
		agentApi.resetAnonymousRejections();
	});

	test("un 401 anonyme n'écrit aucune ligne d'audit et incrémente le compteur", async () => {
		let ran = false;
		const res = await agentApi.withAgent(
			new Request("https://site.test/api/agent/v1/feed"),
			"read",
			async () => {
				ran = true;
				return agentApi.agentOk({});
			}
		);
		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ ok: false, error: "auth_required" });
		expect(ran).toBe(false);
		expect(audit).toEqual([]);
		expect(agentApi.anonymousRejectionCount()).toBe(1);
	});

	test("un appel authentifié reste journalisé", async () => {
		agent = { keyId: "k1", name: "ingest", scopes: ["read"], rateLimitPerHour: 120 };
		const ok = await agentApi.withAgent(
			new Request("https://site.test/api/agent/v1/feed"),
			"read",
			async () => agentApi.agentOk({ n: 1 })
		);
		expect(ok.status).toBe(200);
		const denied = await agentApi.withAgent(
			new Request("https://site.test/api/agent/v1/articles", { method: "POST" }),
			"write:articles",
			async () => agentApi.agentOk({})
		);
		expect(denied.status).toBe(403);
		await Bun.sleep(0);
		expect(audit).toHaveLength(2);
		expect(agentApi.anonymousRejectionCount()).toBe(0);
	});
});
