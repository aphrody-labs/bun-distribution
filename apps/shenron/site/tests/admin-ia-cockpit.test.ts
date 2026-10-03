import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	SourceNotConfiguredError,
	resolveRagBackend,
	type IaCockpitFetchers,
	type SourceSpec,
} from "../src/lib/ia-cockpit";

// Hermetic route test: every I/O boundary is replaced. The route must not open
// the bot SQLite database any more; it reads its sources through
// `ia-cockpit-server` and delegates writes to the bot API.
//
// Retrieval is out of scope here, and nothing fakes it: the Aphrody RAG and the manga search
// are guarded, so a test that reaches them fails instead of receiving invented hits. Their
// runtime coverage (search, probe, evaluation, failures) is admin-ia-rag-live.test.ts, which
// runs on the preloaded Shenron PostgreSQL/E5/Redis services.

mock.module("server-only", () => ({}));

type Caller = "admin" | "member" | "anonymous";
let caller: Caller = "admin";
const sessionUsers = {
	admin: {
		sessionUserId: "s",
		discordId: "1527405876695142620",
		user: { id: "admin-test-user", username: "AdminTest", roleAdmin: true, discordId: "1527405876695142620" },
	},
	member: {
		sessionUserId: "s2",
		discordId: "1527405876695142621",
		user: { id: "member-test-user", username: "MemberTest", roleAdmin: false, discordId: "1527405876695142621" },
	},
	anonymous: null,
} as const;
mock.module("@/lib/session", () => ({
	isCurrentUserAdmin: async () => caller === "admin",
	getCurrentUser: async () => sessionUsers[caller],
	requireAdmin: async () => {},
}));

const canonConfig = { tiers: [], rules: [] };
mock.module("@/lib/canon-config", () => ({
	getCanonConfig: async () => canonConfig,
	saveCanonConfig: async (patch: unknown) => patch,
}));
mock.module("@/lib/canon-preuves", () => ({ canonPreuves: async () => ({ references: [] }) }));
mock.module("@/lib/admin-lab", () => ({ sendAdminLabMessage: async () => ({ id: "m1", ok: true }) }));

/** Retrieval entry points reached by a test of this suite; always empty when a test ends. */
const retrievalCalls: string[] = [];
const retrievalOutOfScope = (name: string) => async (): Promise<never> => {
	retrievalCalls.push(name);
	throw new Error(`${name} is retrieval: covered by admin-ia-rag-live.test.ts, not by this hermetic suite`);
};
mock.module("@/lib/manga-api", () => ({ chercherPlanches: retrievalOutOfScope("chercherPlanches") }));

class FakeCockpitActionError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}

const botCalls: Array<{ path: string; body: unknown }> = [];
let botFailure: FakeCockpitActionError | null = null;
const backend = resolveRagBackend(undefined);

const ok = <T>(label: string, data: T): SourceSpec<T> => ({ label, target: label, run: async () => data });
const unconfigured = (label: string, reason: string): SourceSpec<never> => ({
	label,
	target: label,
	run: async () => {
		throw new SourceNotConfiguredError(reason);
	},
});
/** Retrieval-backed sources report "not exercised" here rather than invented counters or hits. */
const notExercised = (label: string) => unconfigured(label, "Récupération non exercée : voir admin-ia-rag-live.test.ts");

function fakeFetchers(): IaCockpitFetchers {
	return {
		aphrodyHealth: notExercised("Aphrody AI — santé"),
		aphrodyRagStats: notExercised("Aphrody RAG — statistiques"),
		aphrodyRagProbe: notExercised("Aphrody RAG — sonde"),
		aphrodyWeb: unconfigured("Aphrody Web — crawl", "APHRODY_BXC_API_TOKEN absent de l'environnement du site"),
		botRag: notExercised("Bot Shenron — index local"),
		evalHistory: ok("Historique", []),
		goldSet: ok("Jeu doré", { cases: 3, sample: [] }),
		feedbacks: ok("Retours", { total: 0, pending: 0, rows: [] }),
		goals: ok("Objectifs", { active: 0, rows: [] }),
		labMessages: ok("Discord", []),
		agentKeys: ok("Clés", []),
	};
}

mock.module("@/lib/ia-cockpit-server", () => ({
	CockpitActionError: FakeCockpitActionError,
	currentRagBackend: () => backend,
	createIaCockpitFetchers: fakeFetchers,
	runAphrodyOcr: async (image: string, language: string) => ({ text: `${language}:${image.slice(0, 4)}` }),
	searchConfiguredRag: retrievalOutOfScope("searchConfiguredRag"),
	evaluateConfiguredRag: retrievalOutOfScope("evaluateConfiguredRag"),
	// Typed cockpit client: each call is recorded with the bot route it targets.
	botCockpit: {
		createGoal: (body: unknown) => botWrite("/api/admin/goals", body),
		completeGoal: (id: number, body: unknown) => botWrite(`/api/admin/goals/${id}/complete`, body),
		setFeedbackStatus: (id: number, body: unknown) => botWrite(`/api/training/feedback/${id}/status`, body),
		addGold: (body: unknown) => botWrite("/api/training/gold", body),
		runEval: (samples: number) => botWrite("/api/training/eval", { samples }),
	},
}));

async function botWrite(botPath: string, body: unknown) {
	botCalls.push({ path: botPath, body });
	if (botFailure) throw botFailure;
	return { ok: true as const, goal: { id: 30 } };
}

const { GET, POST } = await import("../src/app/api/admin/ia/route");
const { NextRequest } = await import("next/server");

function post(body: unknown) {
	return POST(
		new NextRequest("http://127.0.0.1:5011/api/admin/ia", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
	);
}

beforeEach(() => {
	caller = "admin";
	botCalls.length = 0;
	botFailure = null;
	retrievalCalls.length = 0;
});

afterEach(() => {
	expect(retrievalCalls).toEqual([]);
});

describe("Cockpit Admin IA — route /api/admin/ia", () => {
	test("la route n'ouvre plus la base SQLite du bot", () => {
		const source = readFileSync(path.resolve(import.meta.dir, "../src/app/api/admin/ia/route.ts"), "utf8");
		expect(source).not.toContain("bun:sqlite");
		expect(source).not.toContain("sqlite-vec");
		expect(source).not.toContain("bot.db");
		const server = readFileSync(path.resolve(import.meta.dir, "../src/lib/ia-cockpit-server.ts"), "utf8");
		expect(server).not.toContain("bun:sqlite");
		expect(server).not.toContain("sqlite-vec");
	});

	test("sans session : 401 ; session sans rôle administrateur : 403, aucune écriture", async () => {
		caller = "anonymous";
		expect((await GET()).status).toBe(401);
		expect((await post({ action: "create_goal", title: "x" })).status).toBe(401);
		caller = "member";
		expect((await GET()).status).toBe(403);
		expect((await post({ action: "create_goal", title: "x" })).status).toBe(403);
		expect(botCalls).toEqual([]);
	});

	test("GET rend l'état de chaque source et le RAG_BACKEND sans exercer la récupération", async () => {
		const res = await GET();
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		const json = await res.json();

		expect(json.backend).toEqual({ value: "local", raw: null, engine: "Bot Shenron (index local)" });
		for (const key of ["aphrodyHealth", "aphrodyRagStats", "aphrodyRagProbe", "botRag"]) {
			expect(json.sources[key]).toMatchObject({ status: "unconfigured", data: null });
		}
		expect(json.sources.aphrodyWeb).toMatchObject({ status: "unconfigured", data: null });
		expect(json.sources.goldSet).toMatchObject({ status: "ok", data: { cases: 3 } });
		expect(json.summary.status).toBe("degraded");
		expect(json.summary.failing.map((f: { key: string }) => f.key)).toEqual([
			"aphrodyHealth",
			"aphrodyRagStats",
			"aphrodyRagProbe",
			"aphrodyWeb",
			"botRag",
		]);
		// No retrieval answered: counters are unknown, never zero.
		expect(json.summary.serving).toMatchObject({ source: "botRag", status: "unconfigured" });
		expect(json.summary.documents).toBeNull();
		expect(json.summary.mode).toBeNull();
		expect(json.summary.goldCases).toBe(3);
		expect(json.canonConfig).toEqual(canonConfig);
		expect(json.canonDefaults).toBeDefined();
		// Legacy fields that hid failures behind zeros are gone.
		expect(json.stats).toBeUndefined();
		expect(json.services).toBeUndefined();
	});

	test("test_prompt sans requête : refusé avant toute recherche", async () => {
		const answers = await Promise.all(
			[undefined, "", "   "].map(async (query) => {
				const res = await post({ action: "test_prompt", query });
				return { status: res.status, error: (await res.json()).error as string };
			})
		);
		for (const { status, error } of answers) {
			expect(status).toBe(400);
			expect(error).toContain("query");
		}
	});

	test("evaluate_rag : taille d'échantillon invalide refusée avant toute évaluation", async () => {
		const answers = await Promise.all(
			[-1, 1.5, "abc", " ", true, []].map(async (samples) => {
				const res = await post({ action: "evaluate_rag", samples });
				return { status: res.status, error: (await res.json()).error as string };
			})
		);
		for (const { status, error } of answers) {
			expect(status).toBe(400);
			expect(error).toContain("samples");
		}
	});

	test("create_goal et complete_goal sont délégués au bot avec l'auteur de la session", async () => {
		const created = await post({ action: "create_goal", title: "Objectif Test Cockpit", description: "Validation" });
		expect(created.status).toBe(200);
		expect((await created.json()).goal).toEqual({ id: 30 });
		const completed = await post({ action: "complete_goal", id: 30, notes: "Validé" });
		expect(completed.status).toBe(200);
		expect(botCalls).toEqual([
			{
				path: "/api/admin/goals",
				body: { title: "Objectif Test Cockpit", description: "Validation", userId: "1527405876695142620", userTag: "AdminTest" },
			},
			{ path: "/api/admin/goals/30/complete", body: { notes: "Validé" } },
		]);
	});

	test("update_feedback et add_gold_case sont délégués au bot ; paramètres invalides refusés", async () => {
		expect((await post({ action: "update_feedback", id: 7, status: "supprimé" })).status).toBe(400);
		expect((await post({ action: "update_feedback", id: 0, status: "rejected" })).status).toBe(400);
		expect((await post({ action: "add_gold_case", q: "Q", expect: [] })).status).toBe(400);
		expect(botCalls).toEqual([]);

		expect((await post({ action: "update_feedback", id: 7, status: "rejected" })).status).toBe(200);
		expect((await post({ action: "add_gold_case", q: "Qui est Goku ?", expect: ["/wiki/personnages/son-goku"] })).status).toBe(200);
		expect(botCalls.map((c) => c.path)).toEqual(["/api/training/feedback/7/status", "/api/training/gold"]);
		expect(botCalls[0]?.body).toEqual({ status: "rejected" });
		expect(botCalls[1]?.body).toEqual({
			q: "Qui est Goku ?",
			expect: ["/wiki/personnages/son-goku"],
			userId: "1527405876695142620",
			userTag: "AdminTest",
		});
	});

	test("une écriture refusée par le bot remonte son statut au lieu d'un succès", async () => {
		botFailure = new FakeCockpitActionError(404, "Bot (HTTP 404 sur /api/admin/goals/99/complete) : Objectif #99 introuvable");
		const res = await post({ action: "complete_goal", id: 99 });
		expect(res.status).toBe(404);
		expect((await res.json()).error).toContain("Objectif #99 introuvable");
	});

	test("les corps sont validés par le contrat @shenron/api (limites du bot) avant tout appel", async () => {
		expect((await post({ action: "create_goal", title: "x".repeat(201) })).status).toBe(400);
		expect((await post({ action: "add_gold_case", q: "Q", expect: ["x".repeat(301)] })).status).toBe(400);
		expect((await post({ action: "complete_goal", id: 3, notes: "n".repeat(4001) })).status).toBe(400);
		expect(botCalls).toEqual([]);
		const source = readFileSync(path.resolve(import.meta.dir, "../src/app/api/admin/ia/route.ts"), "utf8");
		expect(source).toContain("@shenron/api/contract");
		expect(source).not.toContain("FEEDBACK_STATUSES");
		expect(source.split("revalidatePath(").length - 1).toBe(2);
	});

	test("ocr_probe délègue l'image et la langue à runAphrodyOcr (substitut hermétique, hors récupération)", async () => {
		const json = await (await post({ action: "ocr_probe", imageBase64: "aW1n", language: "ja" })).json();
		expect(json).toMatchObject({ ok: true, engine: "Aphrody AI", language: "ja", result: { text: "ja:aW1n" } });
		expect((await post({ action: "ocr_probe", imageBase64: "  " })).status).toBe(400);
	});

	test("action inconnue", async () => {
		expect((await post({ action: "drop_everything" })).status).toBe(400);
	});
});
