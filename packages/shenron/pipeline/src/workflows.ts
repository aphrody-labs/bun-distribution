// SPDX-License-Identifier: Apache-2.0
/** Unified operational workflows: OCR, RAG, agent orchestration, crawling and translation. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { wrapLanguageModel } from "ai";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { aphrodyComputeFromChat } from "@shenron/pipeline/aphrody/compute";
import { createAphrodyChatModel } from "@shenron/pipeline/ai/chat";
import { SHENRON_E5 } from "@shenron/pipeline/ai/config";
import { generateGroundedAnswer, type GroundedAnswerInput, type GroundedHit } from "@shenron/pipeline/ai/generate";
import { withHomePersona, type HomePersona } from "@shenron/pipeline/ai/prompts";
import { loadShenronHomePersona, type AgentEnv } from "./agent-home";
import { executeCommand, type CommandRunner, type PipelineExecution } from "./execution";

export { getToriyamaPersona } from "./agent-home";

/**
 * Pipeline IA — Agent Shenron / Akira Toriyama (Bird Studio x DBFR)
 * Moteur souverain d'orchestration cognitive déporté hors du VPS.
 * Raccordé à : RAG hybride, Vision/OCR, PostgreSQL (shenron_site) & SQLite, Crawl, et Persona Toriyama.
 */

export interface IaTaskOptions {
	task: string;
	prompt?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	withRag?: boolean;
	withVision?: boolean;
	withPostgres?: boolean;
	chat?: (prompt: string, model?: string) => Promise<{ answer: string; model: string }>;
	/** Modèle AI SDK injecté (tests, autre transport) ; prioritaire sur `chat`. */
	languageModel?: GroundedAnswerInput["model"];
	/** Environnement qui désigne l'Agent Home (défaut `process.env`) ; voir `./agent-home`. */
	env?: AgentEnv;
}
export interface ShenronAgentResponse {
	role: "assistant";
	content: string;
	thought?: string;
	modelUsed: string;
	citations?: Array<{ title: string; snippet: string; score: number }>;
	ocrContext?: string;
	dbState?: { postgresConnected: boolean; sqliteCached: boolean };
}

/**
 * Ajoute le ton et le style du profil Agent Home aux instructions du système. Le garde
 * anti-injection reste la dernière phrase (`withHomePersona`).
 */
function withHomeInstructions(model: GroundedAnswerInput["model"], persona: HomePersona): GroundedAnswerInput["model"] {
	return wrapLanguageModel({
		model,
		middleware: {
			transformParams: async ({ params }) => ({
				...params,
				prompt: params.prompt.map((message) =>
					message.role === "system" ? { ...message, content: withHomePersona(message.content, persona) } : message,
				),
			}),
		},
	});
}

/**
 * Tâche IA ancrée (B5) : les citations récupérées par le RAG sont réellement
 * injectées dans le prompt via `generateGroundedAnswer` (persona Shenron,
 * règles et garde anti-injection de `@shenron/pipeline/ai/prompts`). Le ton et le
 * style du profil Agent Home du domaine (`./agent-home`) s'y ajoutent quand le
 * profil existe ; sinon la persona canonique seule. Aucun repli silencieux :
 * une configuration d'Agent Home invalide, une génération en échec rejettent avec
 * l'erreur d'origine, une réponse vide avec « Agent Aphrody terminé sans réponse ».
 */
export async function runIaTask(options: IaTaskOptions): Promise<ShenronAgentResponse> {
	const prompt = options.prompt ?? options.task;
	const home = loadShenronHomePersona(options.env);

	// 1. Enrichissement RAG si pertinent
	const citations: Array<{ title: string; snippet: string; score: number }> = [];
	const groundedHits: GroundedHit[] = [];
	if (options.withRag !== false) {
		const hits = await searchRagIndex(prompt, 3);
		for (const [index, h] of hits.entries()) {
			citations.push({ title: h.title, snippet: h.snippet, score: h.score });
			groundedHits.push({
				id: `citation-${index + 1}`,
				title: h.title,
				url: h.url ?? "",
				content: h.snippet,
			});
		}
	}

	// 2. Modèle : injecté, sinon fonction `chat` héritée, sinon la façade Aphrody.
	let modelUsed = "";
	const record = (value: { answer: string; model: string }) => {
		modelUsed = value.model;
		return value;
	};
	const model =
		options.languageModel ??
		createAphrodyChatModel(
			aphrodyComputeFromChat(async (messages, selectedModel) => {
				if (options.chat) {
					// Contrat historique : une seule chaîne de prompt.
					return record(await options.chat(messages.map((m) => m.content).join("\n\n"), selectedModel));
				}
				return record(await new AphrodyComputeClient().chat(messages, selectedModel));
			}),
			// Chaîne vide = aucun `model` envoyé : Aphrody garde son modèle par défaut, comme avant.
			{ modelId: options.model ?? "" }
		);

	let failure: unknown;
	const result = await generateGroundedAnswer({
		model: home ? withHomeInstructions(model, home) : model,
		persona: "shenron",
		question: prompt,
		hits: groundedHits,
		chunks: { contentFor: async () => new Map() },
		onError: (stage, error) => {
			if (stage === "generate") failure = error;
		},
	});
	if (failure !== undefined) throw failure;
	const assistantReply = result.fallback ? "" : result.answer.trim();
	if (!assistantReply) throw new Error("Agent Aphrody terminé sans réponse");

	return {
		role: "assistant",
		content: assistantReply,
		modelUsed: modelUsed || model.modelId,
		citations,
	};
}

export interface OcrJobOptions {
	lotId?: string;
	tome?: number;
	sourceDir?: string;
	concurrency?: number;
	dryRun?: boolean;
	runner?: CommandRunner;
}

export async function runMangaOcr(options: OcrJobOptions = {}): Promise<PipelineExecution> {
	const root = join(import.meta.dir, "../../../..");
	if (options.tome !== undefined) throw new Error("Le filtre tome exige lotId");
	const command = ["bun", join(root, "packages/shenron/pipeline/scripts/run-manga-ocr.ts")];
	if (options.sourceDir) command.push("--root", options.sourceDir);
	if (options.lotId) command.push("--lot", options.lotId);
	if (options.concurrency !== undefined) command.push("--limit", String(options.concurrency));
	if (options.dryRun) command.push("--dry-run");
	return executeCommand(command, { cwd: root, dryRun: options.dryRun, runner: options.runner });
}

export async function runDatabooksOcr(options: OcrJobOptions = {}): Promise<PipelineExecution> {
	const root = join(import.meta.dir, "../../../..");
	if (options.lotId) throw new Error("Le worker databooks continu ne prend pas de lotId");
	const command = ["bun", join(root, "scripts/tools/shenron/scripts/ops/gpu-continuous-ocr.ts")];
	if (options.concurrency !== undefined) command.push("--limite-lots", String(options.concurrency));
	return executeCommand(command, { cwd: root, dryRun: options.dryRun, runner: options.runner });
}



/**
 * E5 constants of the RAG index, read from `@shenron/ai/config` (single
 * source: `aphrody-shenron-embed` model, 384 dimensions, 16 inputs per call).
 */
export const RAG_EMBED_MODEL: string = SHENRON_E5.modelId;
export const RAG_EMBED_DIMENSIONS: number = SHENRON_E5.dimensions;
export const RAG_EMBED_MAX_INPUTS: number = SHENRON_E5.maxInputs;

export interface RagBuildOptions {
	source?: "manga" | "databooks" | "wiki" | "all";
	dryRun?: boolean;
	runner?: CommandRunner;
}

export interface RagSearchResultItem {
	title: string;
	snippet: string;
	score: number;
	kind?: string;
	url?: string;
}

export async function buildRagIndex(options: RagBuildOptions = {}): Promise<PipelineExecution> {
	if (options.source && options.source !== "all") throw new Error("source ciblée: utilisez rag-resync-entites");
	const root = join(import.meta.dir, "../../../..");
	return executeCommand(["bun", join(root, "packages/shenron/pipeline/scripts/rag-sync-aphrody.ts"), "--toutes", ...(options.dryRun ? [] : ["--appliquer"])], {
		cwd: root, dryRun: options.dryRun, runner: options.runner,
	});
}

export async function searchRagIndex(query: string, limit = 5): Promise<RagSearchResultItem[]> {
	return new AphrodyComputeClient().ragSearch(query, limit);
}

export async function evaluateRag(options: { dryRun?: boolean; runner?: CommandRunner } = {}): Promise<PipelineExecution> {
	const root = join(import.meta.dir, "../../../..");
	return executeCommand(["bun", join(root, "scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts"), "--ci"], {
		cwd: root, dryRun: options.dryRun, runner: options.runner,
	});
}

export interface CrawlTarget {
	source: "dragonballcn" | "kanzenshuu" | "official" | "databooks" | "custom" | "universal";
	url?: string;
	depth?: number;
	outDir?: string;
	dryRun?: boolean;
	runner?: CommandRunner;
}

/**
 * Aphrody-owned Dragon Ball crawl and RAG locations for the Shenron profile.
 */
export function corpusLocations(root: string, env: Record<string, string | undefined> = process.env) {
	const crawlDir = env.APHRODY_CORPUS_CRAWL_DIR?.trim() || join(env.APHRODY_HOME?.trim() || join(homedir(), ".aphrody"), "workspaces", "dbfr", "crawl");
	const datasetDir = env.APHRODY_DRAGONBALL_DATASET_DIR?.trim() || join(root, "crates", "ai", "rag-eval", "datasets", "dragonball");
	return {
		datasetDir,
		crawlConfig: join(datasetDir, "crawl.config.json"),
		crawlDir,
		ragDb: env.APHRODY_DRAGONBALL_RAG_DB?.trim() || join(crawlDir, "rag.sqlite"),
	};
}

/** Ingests every Aphrody Web corpus JSONL export into the Aphrody RAG owner. */
export async function runCorpusIngest(options: { dryRun?: boolean; runner?: CommandRunner } = {}): Promise<PipelineExecution> {
	const root = join(import.meta.dir, "../../../..");
	const loc = corpusLocations(root);
	const corpusDir = join(loc.crawlDir, "corpus");
	const exports = existsSync(corpusDir) ? readdirSync(corpusDir).filter((f) => f.endsWith(".jsonl")).toSorted().map((f) => join(corpusDir, f)) : [];
	if (!exports.length && !options.dryRun) throw new Error(`aucun export Aphrody Web dans ${corpusDir}; lancer d'abord: pipeline crawl universal`);
	const command = ["bun", join(root, "packages/shenron/pipeline/scripts/rag-sync-aphrody.ts"), "--corpus-crawl", `--crawl-dir=${loc.crawlDir}`];
	if (!options.dryRun) command.push("--appliquer");
	return executeCommand(command, { cwd: root, dryRun: options.dryRun, runner: options.runner });
}

export async function runCrawl(target: CrawlTarget): Promise<PipelineExecution> {
	const root = join(import.meta.dir, "../../../..");
	let command: string[] = [];
	switch (target.source) {
		case "dragonballcn": command = ["bun", join(root, "packages/shenron/pipeline/scripts/crawl-dragonballcn.ts")]; break;
		case "kanzenshuu": command = ["bun", join(root, "packages/shenron/pipeline/scripts/crawl-kanzenshuu-rag.ts")]; break;
		case "databooks": command = ["bun", join(root, "packages/shenron/pipeline/scripts/crawl-databooks-rag.ts")]; break;
		case "official":
			command = ["bun", join(root, "scripts/tools/shenron/scripts/ops/crawl-dragon-ball-official-aphrody.ts"), target.dryRun ? "--dry-run" : "--apply"];
			break;
		case "universal": {
			// Aphrody Web Rust owns crawling/extraction; Shenron supplies its DBFR plan.
			command = ["bun", join(root, "packages/shenron/pipeline/scripts/aphrody-web-corpus-crawl.ts")];
			if (target.dryRun) command.push("--dry-run");
			if (target.depth !== undefined || target.outDir) throw new Error("crawl universal: profondeur et sortie viennent de crawl.config.json et APHRODY_CORPUS_CRAWL_DIR");
			return executeCommand(command, { cwd: root, dryRun: target.dryRun, runner: target.runner });
		}
		case "custom":
			if (!target.url) throw new Error("crawl custom exige une URL");
			if (target.outDir) throw new Error("crawl distant Aphrody ne prend pas --out; les pages restent dans l'index Aphrody Web");
			command = ["bun", join(root, "scripts/tools/shenron/scripts/ops/aphrody-web-crawl.ts"), target.url];
			break;
	}
	if (target.outDir) command.push("--out", target.outDir);
	if (target.depth !== undefined) command.push("--max-depth", String(target.depth));
	return executeCommand(command, { cwd: root, dryRun: target.dryRun, runner: target.runner });
}
export * from "./dragonballcn-gallery";

/**
 * Unified Bun entrypoint for the repository translation pipeline.
 * The supervisor owns sharding, BXC startup, quality gates, atomic deposits,
 * RAG ingestion and run evidence; this package only provides the stable CLI.
 */

export interface TranslationOptions {
	dryRun?: boolean;
	args?: string[];
}

export async function runTranslation(options: TranslationOptions = {}): Promise<Record<string, unknown>> {
	const args = options.args ?? [];
	const root = join(import.meta.dir, "../../../..");
	const supervisor = join(root, "apps/shenron/site/scripts/traduction-boucle.ts");
	if (options.dryRun) {
		return {
			status: "planned",
			entrypoint: supervisor,
			scope: "eligible databook pages -> Aphrody Rust translation -> Shenron editorial gate and deposit",
		};
	}

	const child = Bun.spawn(
		[process.execPath, supervisor, ...args.filter((arg) => arg !== "--dry-run")],
		{ cwd: root, stdout: "inherit", stderr: "inherit", stdin: "inherit" },
	);
	const code = await child.exited;
	if (code !== 0) throw new Error(`translation worker exited with code ${code}`);
	return { status: "completed", supervisor };
}
