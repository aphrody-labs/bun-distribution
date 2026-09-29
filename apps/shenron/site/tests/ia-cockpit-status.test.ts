import { describe, expect, test } from "bun:test";
import {
	SourceNotConfiguredError,
	collectIaCockpit,
	computeRetrievalMetrics,
	fetchAphrodyWebCrawlStats,
	mapDiscordMessage,
	mapEvalRow,
	parseBotIaStatus,
	parseCrawlStats,
	parseGoldSet,
	probeSource,
	resolveRagBackend,
	summarizeAphrodyRagStats,
	type FetchLike,
	type IaCockpitFetchers,
	type SourceSpec,
} from "../src/lib/ia-cockpit";

/** Deterministic clock: every call advances by 7 ms. */
function steppingClock(step = 7): () => number {
	let now = 0;
	return () => {
		const current = now;
		now += step;
		return current;
	};
}

const ok = <T>(label: string, data: T): SourceSpec<T> => ({ label, target: label, run: async () => data });
const failing = <T>(label: string, error: Error): SourceSpec<T> => ({
	label,
	target: label,
	run: async () => {
		throw error;
	},
});

/** Evaluation row exactly as postgres-js returns it (bigint columns as strings). */
const EVAL_ROW = {
	id: "94",
	recall_1: 0.3837,
	recall_3: 0.6,
	recall_5: 0.8023,
	recall_10: 0.8605,
	mrr: 0.5453,
	ndcg: 0.6149,
	duration_ms: "9165",
	cases_count: "172",
	sidecar_online: "0",
	misses_count: "24",
	created_at: "1790156651492",
};

function healthyFetchers(): IaCockpitFetchers {
	return {
		aphrodyHealth: ok("Aphrody AI — santé", { rag: true, llm: false, ocr: false }),
		aphrodyRagStats: ok("Aphrody RAG — statistiques", {
			chunks: 59_995,
			vectors: 59_000,
			vectorsStored: 59_995,
			sources: 2,
			kinds: [{ kind: "technique", count: 59_995, vectors: 59_000 }],
		}),
		aphrodyRagProbe: ok("Aphrody RAG — sonde", { query: "Son Goku", mode: "hybrid", hits: 1 }),
		aphrodyWeb: ok("Aphrody Web — crawl", {
			queue: { pending: 1, locked: 0, done: 10, failed: 2, total: 13 },
			jobs: 1,
			runningJobs: 0,
		}),
		botRag: ok("Bot Shenron — index local", {
			chunks: 60_000,
			vectors: 60_000,
			mode: "hybrid",
			builtAt: "2026-09-16T05:28:53.630Z",
			gatewayReady: true,
		}),
		evalHistory: ok("Historique", [mapEvalRow(EVAL_ROW)]),
		goldSet: ok("Jeu doré", { cases: 172, sample: [{ q: "Qui est Goku ?", expected: ["/wiki/personnages/son-goku"] }] }),
		feedbacks: ok("Retours", { total: 48, pending: 3, rows: [] }),
		goals: ok("Objectifs", { active: 2, rows: [] }),
		labMessages: ok("Discord", []),
		agentKeys: ok("Clés", []),
	};
}

describe("probeSource — chaque source rend son propre état", () => {
	test("succès : données validées et latence mesurée", async () => {
		const report = await probeSource(ok("A", { n: 1 }), steppingClock());
		expect(report).toEqual({ label: "A", target: "A", status: "ok", latencyMs: 7, data: { n: 1 }, error: null });
	});

	test("échec : indisponible avec le message d'erreur, jamais de données de repli", async () => {
		const report = await probeSource(
			failing("Aphrody RAG — statistiques", new Error("Aphrody compute HTTP 404 on /api/v1/shenron/rag/stats")),
			steppingClock()
		);
		expect(report.status).toBe("unavailable");
		expect(report.data).toBeNull();
		expect(report.error).toBe("Aphrody compute HTTP 404 on /api/v1/shenron/rag/stats");
		expect(report.latencyMs).toBe(7);
	});

	test("configuration absente : non configuré, sans latence", async () => {
		const report = await probeSource(failing("Web", new SourceNotConfiguredError("APHRODY_BXC_API_TOKEN absent")));
		expect(report.status).toBe("unconfigured");
		expect(report.latencyMs).toBeNull();
		expect(report.error).toBe("APHRODY_BXC_API_TOKEN absent");
	});

	test("délai dépassé : nommé comme tel", async () => {
		const timeout = new DOMException("The operation timed out.", "TimeoutError");
		const report = await probeSource({ label: "T", target: "T", run: () => Promise.reject(timeout) });
		expect(report.error).toBe("Délai de réponse dépassé");
	});
});

describe("resolveRagBackend — même règle que usesAphrodyRag()", () => {
	test("non défini → moteur local du bot", () => {
		expect(resolveRagBackend(undefined)).toEqual({ value: "local", raw: null, engine: "Bot Shenron (index local)" });
	});
	test("aphrody → Aphrody AI", () => {
		expect(resolveRagBackend("aphrody")).toEqual({ value: "aphrody", raw: "aphrody", engine: "Aphrody AI" });
	});
	test("toute autre valeur reste locale mais est affichée telle quelle", () => {
		expect(resolveRagBackend(" aphrody")).toMatchObject({ value: "local", raw: " aphrody" });
	});
});

describe("collectIaCockpit — agrégation", () => {
	test("toutes sources OK, RAG_BACKEND local : compteurs du bot, mode du bot", async () => {
		const report = await collectIaCockpit(healthyFetchers(), resolveRagBackend(undefined), steppingClock());
		expect(report.summary.status).toBe("ok");
		expect(report.summary.failing).toEqual([]);
		expect(report.summary.serving).toEqual({
			engine: "Bot Shenron (index local)",
			source: "botRag",
			status: "ok",
			error: null,
		});
		expect(report.summary.countsSource).toBe("botRag");
		expect(report.summary.documents).toBe(60_000);
		expect(report.summary.mode).toBe("hybrid");
		expect(report.summary.goldCases).toBe(172);
		expect(report.summary.latestEval?.recall5).toBe(0.8023);
		expect(report.summary.pendingFeedbacks).toBe(3);
		expect(report.summary.activeGoals).toBe(2);
	});

	test("RAG_BACKEND=aphrody : statistiques Aphrody, mode de la sonde de recherche", async () => {
		const report = await collectIaCockpit(healthyFetchers(), resolveRagBackend("aphrody"));
		expect(report.summary.serving.source).toBe("aphrodyRagProbe");
		expect(report.summary.countsSource).toBe("aphrodyRagStats");
		expect(report.summary.documents).toBe(59_995);
		expect(report.summary.vectors).toBe(59_000);
		expect(report.summary.mode).toBe("hybrid");
	});

	test("état de production observé : stats Aphrody en 404, Web non configuré, aucune valeur inventée", async () => {
		const fetchers = healthyFetchers();
		fetchers.aphrodyRagStats = failing("Aphrody RAG — statistiques", new Error("Aphrody compute HTTP 404 on /api/v1/shenron/rag/stats"));
		fetchers.aphrodyRagProbe = ok("Aphrody RAG — sonde", { query: "Son Goku", mode: "lexical", hits: 1 });
		fetchers.aphrodyWeb = failing("Aphrody Web — crawl", new SourceNotConfiguredError("APHRODY_BXC_API_TOKEN absent de l'environnement du site"));
		fetchers.feedbacks = failing("Retours", new Error("connect ECONNREFUSED"));

		const report = await collectIaCockpit(fetchers, resolveRagBackend("aphrody"));

		expect(report.summary.status).toBe("degraded");
		expect(report.summary.failing.map((f) => [f.key, f.status])).toEqual([
			["aphrodyRagStats", "unavailable"],
			["aphrodyWeb", "unconfigured"],
			["feedbacks", "unavailable"],
		]);
		// The engine still answers searches: serving is ok, but its counters are unknown, not zero.
		expect(report.summary.serving.status).toBe("ok");
		expect(report.summary.documents).toBeNull();
		expect(report.summary.vectors).toBeNull();
		expect(report.summary.mode).toBe("lexical");
		expect(report.summary.pendingFeedbacks).toBeNull();
		expect(report.sources.feedbacks.data).toBeNull();
		// Other sources are unaffected by the failures.
		expect(report.sources.aphrodyHealth.data).toEqual({ rag: true, llm: false, ocr: false });
		expect(report.sources.botRag.status).toBe("ok");
		expect(report.summary.latestEval?.casesCount).toBe(172);
	});

	test("moteur local en panne : le moteur servi est signalé indisponible", async () => {
		const fetchers = healthyFetchers();
		fetchers.botRag = failing("Bot Shenron — index local", new Error("Bot HTTP 502 sur /api/ia/status"));
		const report = await collectIaCockpit(fetchers, resolveRagBackend(undefined));
		expect(report.summary.serving).toMatchObject({ status: "unavailable", error: "Bot HTTP 502 sur /api/ia/status" });
		expect(report.summary.documents).toBeNull();
		expect(report.summary.mode).toBeNull();
	});

	test("les sources sont interrogées en parallèle", async () => {
		const fetchers = healthyFetchers();
		let inFlight = 0;
		let peak = 0;
		for (const key of Object.keys(fetchers) as Array<keyof IaCockpitFetchers>) {
			const original = fetchers[key];
			(fetchers as unknown as Record<string, SourceSpec<unknown>>)[key] = {
				...original,
				run: async () => {
					inFlight++;
					peak = Math.max(peak, inFlight);
					await Bun.sleep(5);
					inFlight--;
					return (original as SourceSpec<unknown>).run();
				},
			};
		}
		await collectIaCockpit(fetchers, resolveRagBackend(undefined));
		expect(peak).toBe(Object.keys(fetchers).length);
	});
});

describe("parseurs des réponses réelles", () => {
	test("bot.rag_eval_history : colonnes bigint converties, date ISO", () => {
		expect(mapEvalRow(EVAL_ROW)).toEqual({
			id: 94,
			createdAt: new Date(1790156651492).toISOString(),
			casesCount: 172,
			recall1: 0.3837,
			recall3: 0.6,
			recall5: 0.8023,
			recall10: 0.8605,
			mrr: 0.5453,
			ndcg: 0.6149,
			durationMs: 9165,
			sidecarOnline: false,
			missesCount: 24,
		});
		expect(() => mapEvalRow({ ...EVAL_ROW, mrr: "n/a" })).toThrow("Colonne mrr invalide");
	});

	test("bot /api/ia/status", () => {
		const status = parseBotIaStatus({
			gatewayReady: true,
			wsLatency: 103,
			dbLatency: 0.08,
			ragReady: true,
			rag: { chunks: 59995, vectors: 59995, mode: "hybrid", builtAt: "2026-09-16T05:28:53.630Z" },
			ok: true,
		});
		expect(status).toEqual({ chunks: 59995, vectors: 59995, mode: "hybrid", builtAt: "2026-09-16T05:28:53.630Z", gatewayReady: true });
		expect(() => parseBotIaStatus({ ok: false, error: "sqlite locked" })).toThrow("sqlite locked");
		expect(() => parseBotIaStatus({ ok: true })).toThrow("Statut RAG du bot invalide");
	});

	test("Aphrody /rag/stats : regroupement par type", () => {
		expect(
			summarizeAphrodyRagStats({
				chunks: 10,
				vectors: 6,
				vectorsStored: 8,
				sources: [
					{ sourceId: "db_characters", kind: "character", count: 4, vectors: 2 },
					{ sourceId: "db_techniques", kind: "technique", count: 5, vectors: 4 },
					{ sourceId: "shenron:1", kind: "character", count: 1 },
				].map(({ kind, count, vectors }) => ({ kind, count, vectors })),
			})
		).toEqual({
			chunks: 10,
			vectors: 6,
			vectorsStored: 8,
			sources: 3,
			kinds: [
				{ kind: "character", count: 5, vectors: 2 },
				{ kind: "technique", count: 5, vectors: 4 },
			],
		});
	});

	test("Aphrody Web /crawl/stats", () => {
		expect(
			parseCrawlStats({
				success: true,
				stats: { pending: 2, locked: 1, done: 30, failed: 0, total: 33 },
				jobs: [{ id: "a", status: "running" }, { id: "b", status: "completed" }],
			})
		).toEqual({ queue: { pending: 2, locked: 1, done: 30, failed: 0, total: 33 }, jobs: 2, runningJobs: 1 });
		expect(() => parseCrawlStats({ success: true, stats: { pending: -1 } })).toThrow("Statistiques de file de crawl invalides");
		expect(() => parseCrawlStats({ ok: false, success: false, error: "Not Found" })).toThrow();
	});

	test("message Discord : auteur, texte ou titre d'embed", () => {
		expect(
			mapDiscordMessage({
				id: "1",
				author: { username: "shenron", global_name: "Shenron" },
				content: "",
				embeds: [{ title: "RAPPORT", description: "Recall@5 80 %" }],
				timestamp: "2026-09-23T09:44:11.492Z",
			})
		).toEqual({ id: "1", author: "Shenron", content: "RAPPORT — Recall@5 80 %", timestamp: "2026-09-23T09:44:11.492Z" });
	});
});

describe("fetchAphrodyWebCrawlStats — contrat du client Aphrody Web", () => {
	const okFetcher = (seen: string[]): FetchLike => async (input, init) => {
		seen.push(`${String(input)} ${new Headers(init?.headers).get("authorization")}`);
		return Response.json({ success: true, stats: { pending: 0, locked: 0, done: 5, failed: 1, total: 6 }, jobs: [] });
	};

	test("sans jeton : non configuré, aucune requête", async () => {
		const seen: string[] = [];
		await expect(fetchAphrodyWebCrawlStats({ fetcher: okFetcher(seen) })).rejects.toBeInstanceOf(SourceNotConfiguredError);
		expect(seen).toEqual([]);
	});

	test("API privée loopback :3007 → /api/v1, route publique → /api/v1/web", async () => {
		const seen: string[] = [];
		await fetchAphrodyWebCrawlStats({ baseUrl: "http://127.0.0.1:3007", token: "t0k", fetcher: okFetcher(seen) });
		await fetchAphrodyWebCrawlStats({ baseUrl: "https://aphrody.com", token: "t0k", fetcher: okFetcher(seen) });
		expect(seen).toEqual([
			"http://127.0.0.1:3007/api/v1/crawl/stats Bearer t0k",
			"https://aphrody.com/api/v1/web/crawl/stats Bearer t0k",
		]);
	});

	test("HTTP non loopback refusé comme mauvaise configuration", async () => {
		await expect(
			fetchAphrodyWebCrawlStats({ baseUrl: "http://10.0.0.5:3007", token: "t", fetcher: okFetcher([]) })
		).rejects.toBeInstanceOf(SourceNotConfiguredError);
	});

	test("erreur serveur : statut et corps rapportés (constat de production)", async () => {
		const fetcher: FetchLike = async () => new Response("unable to open database file", { status: 500 });
		await expect(
			fetchAphrodyWebCrawlStats({ baseUrl: "http://127.0.0.1:3007", token: "t", fetcher })
		).rejects.toThrow("Aphrody Web HTTP 500 sur /api/v1/crawl/stats : unable to open database file");
	});
});

describe("jeu doré et métriques de récupération (définitions de apps/shenron/bot/src/lib/rag-eval.ts)", () => {
	const gold = parseGoldSet(
		[
			'{"q":"Qui est Freezer ?","expectUrl":["/wiki/personnages/freezer"]}',
			"// commentaire",
			'{"q":"Kamehameha","expect":["kamehameha"]}',
			"ligne invalide",
			'{"q":"sans attente"}',
		].join("\n")
	);

	test("lignes invalides, commentaires et cas sans attente ignorés", () => {
		expect(gold.map((c) => c.q)).toEqual(["Qui est Freezer ?", "Kamehameha"]);
	});

	test("URL attendue avec frontière de chemin, rang, MRR, rappel", () => {
		const metrics = computeRetrievalMetrics(
			[
				{
					case: gold[0]!,
					hits: [
						{ title: "Freezer du futur", snippet: "", url: "/wiki/personnages/freezer-futur" },
						{ title: "Freezer", snippet: "", url: "https://dragonballfr.com/wiki/personnages/freezer/" },
					],
				},
				{ case: gold[1]!, hits: [{ title: "Autre", snippet: "rien", url: "/wiki/x" }] },
			],
			42
		);
		expect(metrics.cases).toBe(2);
		expect(metrics.recall).toEqual({ 1: 0, 3: 0.5, 5: 0.5, 10: 0.5 });
		expect(metrics.mrr).toBe(0.25);
		expect(metrics.ndcg).toBe(Number(((1 / Math.log2(3)) / 2).toFixed(4)));
		expect(metrics.durationMs).toBe(42);
		expect(metrics.misses).toEqual([{ q: "Kamehameha", expected: ["kamehameha"], returnedTitle: "Autre" }]);
	});
});
