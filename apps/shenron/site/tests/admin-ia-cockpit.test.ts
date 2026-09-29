import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	SourceNotConfiguredError,
	resolveRagBackend,
	type IaCockpitFetchers,
	type RagBackendInfo,
	type SourceSpec,
} from "../src/lib/ia-cockpit";

// Hermetic route test: every I/O boundary is replaced. The route must not open
// the bot SQLite database any more; it reads its sources through
// `ia-cockpit-server` and delegates writes to the bot API.

mock.module("server-only", () => ({}));

let admin = true;
mock.module("@/lib/session", () => ({
	isCurrentUserAdmin: async () => admin,
	getCurrentUser: async () =>
		admin
			? {
					sessionUserId: "s",
					discordId: "1527405876695142620",
					user: { id: "admin-test-user", username: "AdminTest", roleAdmin: true, discordId: "1527405876695142620" },
				}
			: null,
	requireAdmin: async () => {},
}));

const canonConfig = { tiers: [], rules: [] };
mock.module("@/lib/canon-config", () => ({
	getCanonConfig: async () => canonConfig,
	saveCanonConfig: async (patch: unknown) => patch,
}));
mock.module("@/lib/canon-preuves", () => ({ canonPreuves: async () => ({ references: [] }) }));
mock.module("@/lib/manga-api", () => ({
	chercherPlanches: async () => [{ series: "db", tome: "2", planche: 14, extrait: "<mark>Kamehameha</mark>", score: 3.2 }],
}));
mock.module("@/lib/admin-lab", () => ({ sendAdminLabMessage: async () => ({ id: "m1", ok: true }) }));

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
let evalCalls: Array<{ samples: number; backend: RagBackendInfo }> = [];
let searchFailure: Error | null = null;
let backend = resolveRagBackend(undefined);

const ok = <T>(label: string, data: T): SourceSpec<T> => ({ label, target: label, run: async () => data });

function fakeFetchers(): IaCockpitFetchers {
	return {
		aphrodyHealth: ok("Aphrody AI — santé", { rag: true, llm: false, ocr: false }),
		aphrodyRagStats: {
			label: "Aphrody RAG — statistiques",
			target: "GET /api/v1/shenron/rag/stats",
			run: async () => {
				throw new Error("Aphrody compute HTTP 404 on /api/v1/shenron/rag/stats");
			},
		},
		aphrodyRagProbe: ok("Aphrody RAG — sonde", { query: "Son Goku", mode: "lexical", hits: 1 }),
		aphrodyWeb: {
			label: "Aphrody Web — crawl",
			target: "GET /crawl/stats",
			run: async () => {
				throw new SourceNotConfiguredError("APHRODY_BXC_API_TOKEN absent de l'environnement du site");
			},
		},
		botRag: ok("Bot Shenron — index local", { chunks: 59995, vectors: 59995, mode: "hybrid", builtAt: null, gatewayReady: true }),
		evalHistory: ok("Historique", []),
		goldSet: ok("Jeu doré", { cases: 172, sample: [] }),
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
	searchConfiguredRag: async (query: string) => {
		if (searchFailure) throw searchFailure;
		return { mode: "lexical", results: [{ title: query, snippet: "Technique de Kamé Sennin", url: "/wiki/techniques/kamehameha", score: 0.85 }] };
	},
	evaluateConfiguredRag: async (samples: number, b: RagBackendInfo) => {
		evalCalls.push({ samples, backend: b });
		if (botFailure) throw botFailure;
		return {
			cases: samples || 172,
			recall: { 1: 0.5, 3: 0.7, 5: 0.8, 10: 0.9 },
			mrr: 0.6,
			ndcg: 0.65,
			durationMs: 12,
			misses: [],
			engine: b.engine,
			persisted: b.value === "local",
		};
	},
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
	admin = true;
	botCalls.length = 0;
	botFailure = null;
	evalCalls = [];
	searchFailure = null;
	backend = resolveRagBackend(undefined);
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

	test("GET refuse un non-administrateur", async () => {
		admin = false;
		expect((await GET()).status).toBe(403);
		expect((await post({ action: "create_goal", title: "x" })).status).toBe(403);
	});

	test("GET rend l'état de chaque source, le moteur servi et le RAG_BACKEND", async () => {
		const res = await GET();
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("no-store");
		const json = await res.json();

		expect(json.backend).toEqual({ value: "local", raw: null, engine: "Bot Shenron (index local)" });
		expect(json.sources.aphrodyHealth).toMatchObject({ status: "ok", data: { rag: true, llm: false, ocr: false } });
		expect(json.sources.aphrodyRagStats).toMatchObject({
			status: "unavailable",
			data: null,
			error: "Aphrody compute HTTP 404 on /api/v1/shenron/rag/stats",
		});
		expect(json.sources.aphrodyWeb).toMatchObject({ status: "unconfigured", data: null });
		expect(json.summary.status).toBe("degraded");
		expect(json.summary.serving).toMatchObject({ source: "botRag", status: "ok" });
		expect(json.summary.documents).toBe(59995);
		expect(json.summary.goldCases).toBe(172);
		expect(json.canonConfig).toEqual(canonConfig);
		expect(json.canonDefaults).toBeDefined();
		// Legacy fields that hid failures behind zeros are gone.
		expect(json.stats).toBeUndefined();
		expect(json.services).toBeUndefined();
	});

	test("test_prompt : RAG du moteur actif, canon et manga", async () => {
		const res = await post({ action: "test_prompt", query: "Kamehameha" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.ok).toBe(true);
		expect(json.backend.value).toBe("local");
		expect(json.rag).toMatchObject({ status: "ok", data: { mode: "lexical" } });
		expect(json.rag.data.results[0].title).toBe("Kamehameha");
		expect(json.manga).toMatchObject({ status: "ok" });
		expect(json.manga.data).toHaveLength(1);
		expect(json.canon).toBeDefined();
	});

	test("test_prompt : une recherche en échec est signalée, pas remplacée par une liste vide", async () => {
		searchFailure = new Error("Bot HTTP 429 sur /api/public/rag/search");
		const json = await (await post({ action: "test_prompt", query: "Goku" })).json();
		expect(json.rag).toMatchObject({ status: "unavailable", data: null, error: "Bot HTTP 429 sur /api/public/rag/search" });
	});

	test("evaluate_rag : échantillon transmis au moteur configuré", async () => {
		backend = resolveRagBackend("aphrody");
		const json = await (await post({ action: "evaluate_rag", samples: 3 })).json();
		expect(evalCalls).toEqual([{ samples: 3, backend }]);
		expect(json.metrics).toMatchObject({ cases: 3, engine: "Aphrody AI", persisted: false });

		await post({ action: "evaluate_rag", samples: 0 });
		expect(evalCalls[1]?.samples).toBe(0);
	});

	test("evaluate_rag : une panne du moteur renvoie son statut et son message", async () => {
		botFailure = new FakeCockpitActionError(503, "Recherche Aphrody indisponible (cas « Qui est Goku ? ») : Délai de réponse dépassé");
		const res = await post({ action: "evaluate_rag", samples: 10 });
		expect(res.status).toBe(503);
		expect((await res.json()).error).toContain("Recherche Aphrody indisponible");
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

	test("ocr_probe délègue l'image au client Aphrody réel", async () => {
		const json = await (await post({ action: "ocr_probe", imageBase64: "aW1n", language: "ja" })).json();
		expect(json).toMatchObject({ ok: true, engine: "Aphrody AI", language: "ja", result: { text: "ja:aW1n" } });
	});

	test("action inconnue", async () => {
		expect((await post({ action: "drop_everything" })).status).toBe(400);
	});
});
