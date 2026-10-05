/**
 * Unified pipeline IPC client.
 * Routes operations to Tauri 2.0 Rust commands or fallback HTTP/REST endpoints.
 */

import { isTauri, tauriInvoke } from "./tauri";
import type {
	BridgeConfig,
	ChatMessage,
	ModelOption,
	RagSearchResult,
	RagStats,
	SendPromptRequest,
	CanonVerdict,
	CanonDoctrineConfig,
	OcrOverview,
	OcrPlate,
	TranslationBatch,
	LexiqueEntry,
	BilingualAlignment,
	A2aMessage,
	AgentHeartbeat,
	AgentTask,
	IaHealthStatus,
	IaObjective,
	AutoEvalMetric,
} from "./types";
import { resolveBotApiInternalUrl, resolveSiteInternalUrl } from "@shenron/config/services";

/** Site origin on the loopback (aphrody-infra service catalog: site = 5011); overridable. */
const DEFAULT_SITE_URL =
	resolveSiteInternalUrl(typeof process !== "undefined" ? process.env : {});

const DEFAULT_BOT_API_URL = resolveBotApiInternalUrl(typeof process !== "undefined" ? process.env : {});

const RAG_SERVED_MODES: ReadonlySet<string> = new Set(["hybrid", "hybrid+rerank", "lexical", "dense"]);

export class DbuiBridge {
	private config: BridgeConfig;
	private readonly explicitFallbackUrl: boolean;

	constructor(config: BridgeConfig = {}) {
		this.explicitFallbackUrl = Boolean(config.fallbackApiUrl);
		this.config = {
			fallbackApiUrl: config.fallbackApiUrl || DEFAULT_SITE_URL,
			forcedTransport: config.forcedTransport,
			timeoutMs: config.timeoutMs || 30_000,
		};
	}

	public get isTauriContainer(): boolean {
		return this.config.forcedTransport === "tauri" || (this.config.forcedTransport !== "http" && isTauri());
	}

	private async invokeCommand<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
		if (this.isTauriContainer) {
			try {
				// 1. Tentative d'appel direct sur la commande
				return await tauriInvoke<T>(cmd, args);
			} catch (err) {
				// 2. Si commande non trouvée, délégation via aphrody_exec (shell universel Aphrody App)
				try {
					const res = await tauriInvoke<{ code: number; stdout: string; stderr: string }>("aphrody_exec", {
						args: [cmd, JSON.stringify(args)],
					});
					if (res && res.code === 0 && res.stdout) {
						return JSON.parse(res.stdout) as T;
					}
				} catch {
					// Poursuite vers le fallback HTTP
				}
				console.warn(`[PipelineBridge] Tauri invoke '${cmd}' failed, checking HTTP fallback:`, err);
				if (this.config.forcedTransport === "tauri") throw err;
			}
		}

		// HTTP Fallback
		return this.fallbackHttp<T>(cmd, args);
	}

	private async fallbackHttp<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
		if (cmd === "aphrody_rag_search") return (await this.fallbackRagSearch(args)) as T;
		const baseUrl = this.config.fallbackApiUrl?.replace(/\/$/, "") || "";
		const endpointMap: Record<string, { method: "GET" | "POST"; path: string }> = {
			aphrody_chat_send: { method: "POST", path: "/api/chat" },
			aphrody_models: { method: "GET", path: "/api/models" },
			aphrody_rag_stats: { method: "GET", path: "/api/admin/ia" },
			aphrody_canon_evaluate: { method: "GET", path: "/api/canon" },
			aphrody_canon_doctrine: { method: "GET", path: "/api/canon-config" },
			aphrody_canon_save: { method: "POST", path: "/api/canon-config" },
			aphrody_ocr_overview: { method: "GET", path: "/api/admin/transcriptions?mode=overview" },
			aphrody_translation_batches: { method: "GET", path: "/api/admin/transcriptions?mode=batches" },
			aphrody_a2a_messages: { method: "GET", path: "/api/admin/ia" },
			aphrody_ia_health: { method: "GET", path: "/api/admin/ia" },
			aphrody_ia_objectives: { method: "GET", path: "/api/admin/ia" },
		};

		const mapping = endpointMap[cmd];
		if (!mapping) {
			throw new Error(`Commande bridge non configurée: ${cmd}`);
		}

		try {
			const url = new URL(mapping.path, baseUrl || DEFAULT_SITE_URL);
			const options: RequestInit = {
				method: mapping.method,
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
			};

			if (mapping.method === "GET") {
				Object.entries(args).forEach(([k, v]) => {
					if (v !== undefined && v !== null) {
						url.searchParams.append(k, String(v));
					}
				});
			} else {
				options.body = JSON.stringify(args);
			}

			const res = await fetch(url.toString(), options);
			if (!res.ok) throw new Error(`HTTP ${res.status} on ${cmd}`);
			return (await res.json()) as T;
		} catch (error) {
			throw new Error(`Échec du bridge HTTP ${cmd}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}

	/** The owner of RAG search is the bot API (GET /api/public/rag/search?q=), not the site. */
	private async fallbackRagSearch(args: Record<string, unknown>): Promise<RagSearchResult> {
		const mode = args.mode ?? "hybrid";
		if (mode === "dense" || mode === "lexical") {
			// The public route always serves hybrid: it ignores lexicalOnly and has no dense-only switch.
			throw new Error(`Échec du bridge HTTP aphrody_rag_search: mode ${String(mode)} seul non supporté par la route publique`);
		}
		const query = String(args.query ?? "");
		const base = this.explicitFallbackUrl ? this.config.fallbackApiUrl! : DEFAULT_BOT_API_URL;
		const url = new URL("/api/public/rag/search", base);
		url.searchParams.set("q", query);
		url.searchParams.set("limit", String(args.limit ?? 6));
		const started = performance.now();
		let body: unknown;
		try {
			const res = await fetch(url, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} on aphrody_rag_search`);
			body = await res.json();
		} catch (error) {
			throw new Error(`Échec du bridge HTTP aphrody_rag_search: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		const malformed = (why: string) => new Error(`Échec du bridge HTTP aphrody_rag_search: réponse invalide (${why})`);
		if (typeof body !== "object" || body === null || Array.isArray(body)) throw malformed("corps non objet");
		const record = body as Record<string, unknown>;
		if (record.error !== undefined && record.error !== null && record.error !== "") {
			throw new Error(`Échec du bridge HTTP aphrody_rag_search: ${String(record.error)}`);
		}
		if (typeof record.q !== "string") throw malformed("q absent");
		const servedMode = record.mode;
		if (typeof servedMode !== "string" || !RAG_SERVED_MODES.has(servedMode)) throw malformed("mode inconnu");
		if (!Array.isArray(record.results)) throw malformed("results absent");
		const results = record.results as RagSearchResult["results"];
		return {
			query: record.q,
			results,
			mode: servedMode as RagSearchResult["mode"],
			latencyMs: Math.round(performance.now() - started),
			totalFound: results.length,
		};
	}

	// ── Chat API ─────────────────────────────────────────────────────────────

	public async sendPrompt(req: SendPromptRequest): Promise<ChatMessage> {
		return this.invokeCommand<ChatMessage>("aphrody_chat_send", {
			prompt: req.prompt,
			persona: req.persona || "whis",
			modelId: req.modelId || "aphrody-local",
			context: req.context,
			sessionId: req.sessionId,
			entityFilter: req.entityFilter,
		});
	}

	public async getModels(): Promise<ModelOption[]> {
		return this.invokeCommand<ModelOption[]>("aphrody_models", {});
	}

	// ── RAG API ──────────────────────────────────────────────────────────────

	public async searchRag(
		query: string,
		options: { limit?: number; mode?: "hybrid" | "lexical" | "dense" } = {}
	): Promise<RagSearchResult> {
		return this.invokeCommand<RagSearchResult>("aphrody_rag_search", {
			query,
			limit: options.limit || 6,
			mode: options.mode || "hybrid",
		});
	}

	public async getRagStats(): Promise<RagStats> {
		return this.invokeCommand<RagStats>("aphrody_rag_stats", {});
	}

	// ── Canon API ────────────────────────────────────────────────────────────

	public async evaluateCanon(query: string): Promise<CanonVerdict> {
		return this.invokeCommand<CanonVerdict>("aphrody_canon_evaluate", { query });
	}

	public async getCanonVerdict(query: string): Promise<CanonVerdict> {
		return this.evaluateCanon(query);
	}

	public async getCanonDoctrine(): Promise<CanonDoctrineConfig> {
		return this.invokeCommand<CanonDoctrineConfig>("aphrody_canon_doctrine", {});
	}

	public async saveCanonDoctrine(config: Partial<CanonDoctrineConfig>): Promise<boolean> {
		return this.invokeCommand<boolean>("aphrody_canon_save", { config });
	}

	// ── Transcriptions & OCR API ─────────────────────────────────────────────

	public async getOcrOverview(): Promise<OcrOverview> {
		return this.invokeCommand<OcrOverview>("aphrody_ocr_overview", {});
	}

	public async inspectPlate(databookId: number, pageNumber: number): Promise<OcrPlate | null> {
		return this.invokeCommand<OcrPlate | null>("aphrody_ocr_inspect_plate", {
			databookId,
			pageNumber,
		});
	}

	public async validatePlate(
		databookId: number,
		pageNumber: number,
		textJa: string,
		textFr?: string
	): Promise<boolean> {
		return this.invokeCommand<boolean>("aphrody_ocr_validate_plate", {
			databookId,
			pageNumber,
			textJa,
			textFr,
		});
	}

	// ── Traduction & Lexique API ─────────────────────────────────────────────

	public async getTranslationBatches(): Promise<TranslationBatch[]> {
		return this.invokeCommand<TranslationBatch[]>("aphrody_translation_batches", {});
	}

	public async searchLexique(query: string, category?: string): Promise<LexiqueEntry[]> {
		return this.invokeCommand<LexiqueEntry[]>("aphrody_translation_lexique_search", {
			query,
			category,
		});
	}

	public async getLexique(query?: string, category?: string): Promise<LexiqueEntry[]> {
		return this.searchLexique(query || "", category);
	}

	public async alignBilingual(textJa: string, textFr: string): Promise<BilingualAlignment> {
		return this.invokeCommand<BilingualAlignment>("aphrody_translation_align", {
			textJa,
			textFr,
		});
	}

	// ── A2A & Agents API ─────────────────────────────────────────────────────

	public async getA2aMessages(): Promise<A2aMessage[]> {
		return this.invokeCommand<A2aMessage[]>("aphrody_a2a_messages", {});
	}

	public async sendA2aMessage(to: string, subject: string, content: string): Promise<boolean> {
		return this.invokeCommand<boolean>("aphrody_a2a_send", { to, subject, content });
	}

	public async getAgentHeartbeats(): Promise<AgentHeartbeat[]> {
		return this.invokeCommand<AgentHeartbeat[]>("aphrody_a2a_heartbeats", {});
	}

	public async getAgentTasks(): Promise<AgentTask[]> {
		return this.invokeCommand<AgentTask[]>("aphrody_a2a_tasks", {});
	}

	// ── IA Cockpit API ───────────────────────────────────────────────────────

	public async getIaHealth(): Promise<IaHealthStatus> {
		return this.invokeCommand<IaHealthStatus>("aphrody_ia_health", {});
	}

	public async getIaObjectives(): Promise<IaObjective[]> {
		return this.invokeCommand<IaObjective[]>("aphrody_ia_objectives", {});
	}

	public async saveIaObjective(objective: Partial<IaObjective>): Promise<boolean> {
		return this.invokeCommand<boolean>("aphrody_ia_save_objective", { objective });
	}

	public async runAutoEval(sampleSize = 25): Promise<AutoEvalMetric> {
		return this.invokeCommand<AutoEvalMetric>("aphrody_ia_auto_eval", { sampleSize });
	}
}
