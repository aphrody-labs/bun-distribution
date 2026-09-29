import { inject, singleton } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { embedQueryVector, hybridSearch, tokenize, fold, hitTruthWeight } from "~/lib/rag";
import {
	aggregate,
	parseGold,
	RANKS,
	runCase,
	type CaseResult,
	type GoldCase,
} from "~/lib/rag-eval";
import { CanonService, type CanonVerdict } from "~/services/CanonService";
import { ragTrainingFeedback } from "~/db/schema";
import { desc, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { sendAdminLabMessage } from "~/lib/admin-lab";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { resolveDataPath, warnIfEphemeral } from "@shenron/config/paths";
import { resolveBotApiInternalUrl, resolveSiteInternalUrl } from "@shenron/config/services";

/** Jeu doré livré avec le bot (défaut historique, D15). */
const LEGACY_GOLD_PATH = fileURLToPath(new URL("../../tests/rag-gold.jsonl", import.meta.url));

/**
 * Chemin du jeu doré : `RAG_GOLD_PATH`/`RAG_GOLD`, sinon le fichier livré
 * (inchangé). En production, un chemin hérité est signalé une fois (D15).
 */
function goldPath(): string {
	const p = resolveDataPath("ragGold", { env: process.env, legacyDefault: LEGACY_GOLD_PATH });
	warnIfEphemeral(p, process.env, (message) => console.warn(message));
	return p.path;
}
// Slot A is the production default; blue/green overrides this explicitly.
const SITE_INTERNAL = resolveSiteInternalUrl(process.env);
/** API interne du bot : mêmes variables et défauts que le bind de `api/server.ts` (`API_HOST`/`API_PORT`). */
const BOT_API_INTERNAL = resolveBotApiInternalUrl(process.env);

export type { GoldCase };

export interface EvalMetrics {
	cases: number;
	recall: Record<number, number>; // @1, @3, @5, @10
	mrr: number;
	ndcg: number;
	durationMs: number;
	sidecarActive: boolean;
	misses: { q: string; expected: string[]; returnedTitle?: string; returnedScore?: number }[];
}

export interface RagInspection {
	query: string;
	tokens: string[];
	mode: string;
	durationMs: number;
	sidecarActive: boolean;
	results: {
		rowid: number;
		kind: string;
		title: string;
		url: string;
		score: number;
		rerankScore?: number;
		truthMultiplier: number;
		snippet: string;
		isExactSubject: boolean;
	}[];
}

export interface CanonInspection {
	query: string;
	tier: string;
	tierLabel: string;
	score: number;
	verdict: string;
	nature: string;
	toriyamaQuote?: { text: string; source: string; year?: number };
	referencesCount: number;
	planchesCount: number;
	fichesCount: number;
	latencyMs: number;
	sources: string[];
}

export interface MangaInspection {
	query: string;
	count: number;
	latencyMs: number;
	resultats: {
		series: string;
		tome: string;
		planche: number;
		extrait: string;
		href: string;
		score: number;
	}[];
}

export interface FramesInspection {
	imageUrl: string;
	latencyMs: number;
	count: number;
	matches: {
		episodeId?: number;
		titre: string;
		timecode: string;
		similarity: number;
		href: string;
	}[];
	parasitesRejetes: number;
}

export interface TrainingStats {
	totalChunks: number;
	totalVectors: number;
	totalGoldCases: number;
	totalFeedbacks: number;
	pendingFeedbacks: number;
	goldFeedbacks: number;
	sidecarStatus: "online" | "offline";
	siteApiStatus: "online" | "offline";
	botApiStatus: "online" | "offline";
}

@singleton()
export class TrainingService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(CanonService) private canon: CanonService
	) {}

	/**
	 * Vérifie la disponibilité du backend d'embeddings sélectionné.
	 */
	async isSidecarOnline(): Promise<boolean> {
		if (process.env.RAG_BACKEND === "aphrody") {
			try {
				await new AphrodyComputeClient().embed(["ping"]);
				return true;
			} catch {
				return false;
			}
		}
		try {
			// Modèle construit paresseusement (B3) : une URL invalide = hors ligne, pas un crash.
			return (await embedQueryVector("ping", 1200)) !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Charge les cas de test du fichier tests/rag-gold.jsonl.
	 */
	async loadGoldCases(): Promise<GoldCase[]> {
		return parseGold(
			await Bun.file(goldPath())
				.text()
				.catch(() => "")
		);
	}

	/**
	 * Exécute une évaluation RAG en direct sur tout ou partie du jeu doré.
	 */
	async evaluateRag(
		sampleSize?: number,
		options: { persist?: boolean } = {}
	): Promise<EvalMetrics> {
		const start = performance.now();
		const allCases = await this.loadGoldCases();
		const cases =
			sampleSize && sampleSize < allCases.length ? allCases.slice(0, sampleSize) : allCases;

		const sidecarActive = await this.isSidecarOnline();
		const results: CaseResult[] = [];
		for (const c of cases) {
			results.push(await runCase(c, (q) => hybridSearch(this.dbs.sqlite, q, 10)));
		}
		const agg = aggregate(results);
		const round4 = (n: number) => Number(n.toFixed(4));
		const metrics: EvalMetrics = {
			cases: cases.length,
			recall: Object.fromEntries(RANKS.map((k) => [k, round4(agg.recall[k])])),
			mrr: round4(agg.mrr),
			ndcg: round4(agg.ndcg),
			durationMs: Math.round(performance.now() - start),
			sidecarActive,
			misses: results
				.filter((r) => r.rank === 0)
				.map((r) => ({
					q: r.case.q,
					expected: r.case.expectUrl ?? r.case.expectTitle ?? r.case.expect ?? [],
					returnedTitle: r.top[0]?.title,
				})),
		};

		// Enregistrement de l'instantané métrique si l'échantillon est représentatif
		if (options.persist !== false && (!sampleSize || sampleSize >= 10)) {
			try {
				await this.recordEvalSnapshot(metrics);
			} catch {}
		}

		return metrics;
	}

	/**
	 * Enregistre un instantané métrique en base et alerte en cas de régression détectée.
	 */
	async recordEvalSnapshot(metrics: EvalMetrics): Promise<any> {
		const prev = this.dbs.sqlite
			.query("SELECT * FROM rag_eval_history ORDER BY id DESC LIMIT 1")
			.get() as any;

		const res = this.dbs.sqlite
			.query(
				`INSERT INTO rag_eval_history (recall_1, recall_3, recall_5, recall_10, mrr, ndcg, duration_ms, cases_count, sidecar_online, misses_count, misses_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 RETURNING *`
			)
			.get(
				metrics.recall[1] ?? 0,
				metrics.recall[3] ?? 0,
				metrics.recall[5] ?? 0,
				metrics.recall[10] ?? 0,
				metrics.mrr,
				metrics.ndcg,
				metrics.durationMs,
				metrics.cases,
				metrics.sidecarActive ? 1 : 0,
				metrics.misses.length,
				JSON.stringify(metrics.misses),
				Date.now()
			) as any;

		// Détection automatique de régression
		if (prev && prev.cases_count >= 10 && metrics.cases >= 10) {
			const deltaR5 = (metrics.recall[5] ?? 0) - prev.recall_5;
			const deltaMrr = metrics.mrr - prev.mrr;
			if (deltaR5 <= -0.05 || deltaMrr <= -0.05) {
				try {
					await sendAdminLabMessage({
						embeds: [
							{
								color: 0xef4444,
								title: "🚨 ALERTE RÉGRESSION RETRIEVAL RAG",
								description: [
									`Une baisse significative de précision a été détectée sur le banc de test doré.`,
									"",
									`• **Recall@5 :** \`${(prev.recall_5 * 100).toFixed(1)}%\` → \`${((metrics.recall[5] ?? 0) * 100).toFixed(1)}%\` (\`${(deltaR5 * 100).toFixed(1)}%\`)`,
									`• **MRR :** \`${(prev.mrr * 100).toFixed(1)}%\` → \`${(metrics.mrr * 100).toFixed(1)}%\` (\`${(deltaMrr * 100).toFixed(1)}%\`)`,
									`• **Misses :** \`${metrics.misses.length} cas en échec\``,
									"",
									`*Consultez \`/train inspect-rag\` ou le salon admin.*`,
								].join("\n"),
								timestamp: new Date().toISOString(),
							},
						],
					});
				} catch {}
			}
		}

		return res;
	}

	/**
	 * Récupère l'historique des évaluations.
	 */
	getEvalHistory(limit = 10): any[] {
		return this.dbs.sqlite
			.query("SELECT * FROM rag_eval_history ORDER BY id DESC LIMIT ?")
			.all(limit) as any[];
	}

	/**
	 * Diagnostic approfondi d'une requête RAG avec scores et pondérations de véracité.
	 */
	async inspectRag(query: string): Promise<RagInspection> {
		const start = performance.now();
		const tokens = tokenize(query);
		const sidecarActive = await this.isSidecarOnline();
		const out = await hybridSearch(this.dbs.sqlite, query, 5);
		const durationMs = Math.round(performance.now() - start);

		const qFolded = fold(query).toLowerCase();
		const results = out.results.map((hit) => {
			const anyHit = hit as any;
			const isExactSubject =
				qFolded === fold(hit.title).toLowerCase() ||
				(anyHit.entity ? qFolded === fold(anyHit.entity).toLowerCase() : false);

			const multiplier = hitTruthWeight(hit, tokens);

			return {
				rowid: hit.rowid,
				kind: hit.kind,
				title: hit.title,
				url: hit.url,
				score: hit.score,
				rerankScore: anyHit.rerankScore,
				truthMultiplier: multiplier,
				snippet: hit.snippet,
				isExactSubject,
			};
		});

		return {
			query,
			tokens,
			mode: out.mode,
			durationMs,
			sidecarActive,
			results,
		};
	}

	/**
	 * Diagnostic de l'API Canon et de la doctrine.
	 */
	async inspectCanon(query: string): Promise<CanonInspection | null> {
		const start = performance.now();
		const res = await this.canon.verifier(query);
		const latencyMs = Math.round(performance.now() - start);
		if (!res) return null;

		return {
			query,
			tier: res.verdict.tier,
			tierLabel: res.verdict.tierLabel,
			score: res.verdict.score,
			verdict: res.verdict.verdict,
			nature: res.verdict.nature,
			toriyamaQuote: res.verdict.toriyamaQuote ?? undefined,
			referencesCount: res.references.length,
			planchesCount: res.planches.length,
			fichesCount: res.fiches.length,
			latencyMs,
			sources: res.verdict.sources ?? [],
		};
	}

	/**
	 * Diagnostic de la recherche textuelle manga.
	 */
	async inspectManga(
		query: string,
		opts?: { series?: string; tome?: string }
	): Promise<MangaInspection> {
		const start = performance.now();
		const params = new URLSearchParams({ q: query, limit: "5" });
		if (opts?.series) params.set("series", opts.series);
		if (opts?.tome) params.set("tome", opts.tome);

		let json: any = { count: 0, resultats: [] };
		try {
			const res = await fetch(`${SITE_INTERNAL}/api/manga/search?${params.toString()}`, {
				signal: AbortSignal.timeout(4000),
			});
			if (res.ok) {
				json = await res.json();
			}
		} catch {}

		return {
			query,
			count: json.count ?? 0,
			latencyMs: Math.round(performance.now() - start),
			resultats: (json.resultats ?? []).slice(0, 5).map((r: any) => ({
				series: r.series,
				tome: r.tome,
				planche: r.planche,
				extrait: r.extrait,
				href: r.href,
				score: r.score,
			})),
		};
	}

	/**
	 * Diagnostic de la reconnaissance visuelle Frames.
	 */
	async inspectFrames(imageUrl: string): Promise<FramesInspection> {
		const start = performance.now();
		let json: any = { matches: [] };
		try {
			const res = await fetch(`${SITE_INTERNAL}/api/frames/search`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imageBase64: imageUrl }),
				signal: AbortSignal.timeout(6000),
			});
			if (res.ok) {
				json = await res.json();
			}
		} catch {}

		const matches = (json.matches ?? []).slice(0, 5).map((m: any) => ({
			episodeId: m.episodeId,
			titre: m.title ?? m.episodeTitle ?? "Épisode Dragon Ball",
			timecode: m.timecode ?? "0:00",
			similarity: Math.round((m.similarity ?? 0) * 100),
			href: m.href ?? "",
		}));

		return {
			imageUrl,
			latencyMs: Math.round(performance.now() - start),
			count: matches.length,
			matches,
			parasitesRejetes: json.parasitesRejetes ?? 0,
		};
	}

	/**
	 * Enregistre un feedback d'entraînement direct.
	 */
	async recordFeedback(data: {
		userId: string;
		userTag?: string;
		type: "rag" | "canon" | "frames" | "manga";
		query: string;
		rating?: number;
		expected?: string;
		comment?: string;
		targetId?: string;
		status?: "pending" | "gold_added" | "rejected" | "reviewed";
	}) {
		await this.dbs.db.insert(ragTrainingFeedback).values({
			userId: data.userId,
			userTag: data.userTag ?? null,
			type: data.type,
			query: data.query,
			rating: data.rating ?? null,
			status: data.status ?? "pending",
			expected: data.expected ?? null,
			comment: data.comment ?? null,
			targetId: data.targetId ?? null,
		});
	}

	/**
	 * Ajoute directement une question au fichier tests/rag-gold.jsonl et l'archive en base.
	 */
	async addGoldCase(
		query: string,
		expect: string[],
		userId = "system",
		userTag = "admin"
	): Promise<boolean> {
		const trimmedQ = query.trim();
		const cleanExpect = expect.map((e) => e.trim()).filter(Boolean);
		if (!trimmedQ || cleanExpect.length === 0) return false;

		const line = JSON.stringify({ q: trimmedQ, expect: cleanExpect }) + "\n";
		const current = await Bun.file(goldPath())
			.text()
			.catch(() => "");
		await Bun.write(goldPath(), current + line);

		await this.recordFeedback({
			userId,
			userTag,
			type: "rag",
			query: trimmedQ,
			rating: 5,
			expected: cleanExpect.join(", "),
			status: "gold_added",
			comment: "Ajouté au gold-set depuis l'interface Discord",
		});

		return true;
	}

	/**
	 * Tableau de bord statistique d'entraînement et de disponibilité des briques.
	 */
	async getStats(): Promise<TrainingStats> {
		// Compteurs du backend RAG actif.
		let totalChunks = 0;
		let totalVectors = 0;
		if (process.env.RAG_BACKEND === "aphrody") {
			try {
				const stats = await new AphrodyComputeClient().ragStats();
				totalChunks = stats.chunks;
				totalVectors = stats.vectors;
			} catch {}
		} else {
			try {
				const resChunks = this.dbs.sqlite.query("SELECT count(*) as c FROM rag_chunks").get() as {
					c: number;
				};
				totalChunks = resChunks?.c ?? 0;
			} catch {}

			try {
				const resVec = this.dbs.sqlite.query("SELECT count(*) as c FROM vec_chunks").get() as {
					c: number;
				};
				totalVectors = resVec?.c ?? 0;
			} catch {}
		}

		const goldCases = await this.loadGoldCases();

		// Feedbacks
		const feedbacks = await this.dbs.db.select().from(ragTrainingFeedback);
		const pendingFeedbacks = feedbacks.filter((f) => f.status === "pending").length;
		const goldFeedbacks = feedbacks.filter((f) => f.status === "gold_added").length;

		// Sonde des services
		const sidecarOnline = await this.isSidecarOnline();

		let siteApiStatus: "online" | "offline" = "offline";
		try {
			const res = await fetch(`${SITE_INTERNAL}/api/canon`, { signal: AbortSignal.timeout(800) });
			if (res.ok) siteApiStatus = "online";
		} catch {}

		let botApiStatus: "online" | "offline" = "offline";
		try {
			const res = await fetch(`${BOT_API_INTERNAL}/health`, { signal: AbortSignal.timeout(800) });
			if (res.ok) botApiStatus = "online";
		} catch {}

		return {
			totalChunks,
			totalVectors,
			totalGoldCases: goldCases.length,
			totalFeedbacks: feedbacks.length,
			pendingFeedbacks,
			goldFeedbacks,
			sidecarStatus: sidecarOnline ? "online" : "offline",
			siteApiStatus,
			botApiStatus,
		};
	}
}
