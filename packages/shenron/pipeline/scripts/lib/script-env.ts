// SPDX-License-Identifier: Apache-2.0
/**
 * Shared environment and path contract of the pipeline scripts.
 *
 * - B13 / D16: scripts carry no URL, host or port default. A missing endpoint
 *   is an explicit error naming the variable(s) to set.
 * - B6: repository paths are derived with `fileURLToPath` (never
 *   `URL.pathname`, which yields `/C:/...` on Windows).
 * - Rule 9 (CLAUDE.md): destructive RAG rebuilds refuse the served database.
 *
 * Pure helpers only: importing this module has no side effect.
 */
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AI_ENV,
	type AiEnvSetting,
	aiEnvNames,
	type EmbeddingSpace,
	readAiEnv,
	requireAiHttpUrl,
	requireEmbedBaseUrl as resolveEmbedBase,
	requireEmbeddingSpace,
} from "@shenron/pipeline/ai/config";
import { resolveDataPath } from "@shenron/config/paths";

export type EnvSource = Record<string, string | undefined>;
export type PathPlatform = "win32" | "posix";

function pathApi(platform: PathPlatform) {
	return platform === "win32" ? win32 : posix;
}

function currentPlatform(): PathPlatform {
	return process.platform === "win32" ? "win32" : "posix";
}

/** Error raised when a required environment variable is not set. */
export class MissingEnvError extends Error {
	readonly names: readonly string[];
	constructor(names: readonly string[], purpose: string) {
		super(`variable d'environnement manquante : ${names.join(" ou ")} (${purpose})`);
		this.name = "MissingEnvError";
		this.names = names;
	}
}

/** First non-empty variable among `names`, or a {@link MissingEnvError}. */
export function requireEnv(
	env: EnvSource,
	names: readonly string[],
	purpose: string
): { name: string; value: string } {
	for (const name of names) {
		const value = env[name]?.trim();
		if (value && value !== "undefined" && value !== "null") return { name, value };
	}
	throw new MissingEnvError(names, purpose);
}

/** {@link MissingEnvError} naming every variable of an AI setting (canonical first). */
function requireAiSetting(env: EnvSource, setting: AiEnvSetting, purpose: string): void {
	if (!readAiEnv(env, setting)) throw new MissingEnvError(aiEnvNames(setting), purpose);
}

/**
 * E5 embedder base URL (ending in `/v1`), resolved by `@shenron/pipeline/ai/config`:
 * `APHRODY_AI_EMBED_BASE_URL`, then the contract aliases
 * (`APHRODY_SHENRON_EMBED_BASE_URL`, `EMBED_URL` as an origin,
 * `APHRODY_RAG_EMBED_ENDPOINT` as an endpoint). No default (B13).
 */
export function requireEmbedBaseUrl(env: EnvSource): { name: string; baseUrl: string; origin: string } {
	requireAiSetting(env, AI_ENV.embedBaseUrl, "embedder E5");
	const url = resolveEmbedBase(env);
	const name = readAiEnv(env, AI_ENV.embedBaseUrl)?.name ?? AI_ENV.embedBaseUrl.canonical;
	return { name, baseUrl: url.toString(), origin: url.origin };
}

/** Origin of `aphrody-ai-http` (`APHRODY_AI_HTTP_URL`, alias `APHRODY_SHENRON_API_URL`). No default (B13). */
export function requireAphrodyApiUrl(env: EnvSource): string {
	requireAiSetting(env, AI_ENV.httpUrl, "API de calcul Aphrody");
	return requireAiHttpUrl(env).href;
}

/** `rag_meta` row (model, dim) of a SQLite RAG index, or `null` when the table is absent or empty. */
export function ragMetaOf(db: {
	query(sql: string): { get(): unknown };
}): { model: string | null; dim: number | null } | null {
	try {
		return (db.query("SELECT model, dim FROM rag_meta LIMIT 1").get() as { model: string | null; dim: number | null } | null) ?? null;
	} catch {
		return null;
	}
}

/**
 * Embedding space a script may write, checked against the contract index
 * `shenron-rag` and, when given, against the `rag_meta` row of the target
 * SQLite index. A mismatch throws: embedding spaces are never mixed.
 */
export function requireScriptEmbeddingSpace(
	env: EnvSource,
	index?: { model: string | null; dim: number | null } | null,
	label = "rag_meta"
): EmbeddingSpace {
	const space = requireEmbeddingSpace(env);
	if (index?.model && index.dim) {
		requireEmbeddingSpace(env, { model: index.model, dimensions: index.dim }, label);
	}
	return space;
}

/** Repository root, derived from a module URL located `depth` directories below it. */
export function repoRootFrom(moduleUrl: string, depth: number, platform: PathPlatform = currentPlatform()): string {
	const p = pathApi(platform);
	const file = fileURLToPath(moduleUrl, { windows: platform === "win32" });
	return p.resolve(p.dirname(file), ...Array.from({ length: depth }, () => ".."));
}

/** Repository root seen from a file of `packages/shenron/pipeline/scripts/`. */
export function repoRootFromScript(moduleUrl: string, platform: PathPlatform = currentPlatform()): string {
	return repoRootFrom(moduleUrl, 4, platform);
}

/** SQLite database served by the bot (`apps/shenron/bot/data/bot.db`). */
export function servedBotDbPath(repoRoot: string, platform: PathPlatform = currentPlatform()): string {
	return pathApi(platform).join(repoRoot, "apps", "shenron", "bot", "data", "bot.db");
}

/**
 * B6. Query lexicon output: `RAG_LEXIQUE` when set, else
 * `apps/shenron/bot/data/rag/lexique-requetes.json` — the file `apps/shenron/bot/src/lib/rag.ts` reads.
 */
export function resolveLexiquePath(
	moduleUrl: string,
	env: EnvSource,
	platform: PathPlatform = currentPlatform()
): string {
	const root = repoRootFromScript(moduleUrl, platform);
	const legacyDefault = pathApi(platform).join(root, "apps", "shenron", "bot", "data", "rag", "lexique-requetes.json");
	return resolveDataPath("ragLexique", { env, legacyDefault }).path;
}

/**
 * Rule 9: a destructive rebuild needs an explicit `RAG_DB` that is not the
 * served database. Returns the absolute target path.
 */
export function requireOfflineRagDb(
	env: EnvSource,
	repoRoot: string,
	platform: PathPlatform = currentPlatform()
): string {
	const p = pathApi(platform);
	const target = p.resolve(requireEnv(env, ["RAG_DB"], "copie hors service de la base RAG").value);
	const served = p.resolve(servedBotDbPath(repoRoot, platform));
	const same = platform === "win32" ? target.toLowerCase() === served.toLowerCase() : target === served;
	if (same) {
		throw new Error(
			`refus : RAG_DB désigne la base servie (${served}). Construire sur une copie puis basculer (docs/rag-enrichment.md).`
		);
	}
	return target;
}
