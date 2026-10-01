// SPDX-License-Identifier: Apache-2.0
/**
 * B6: `rag-lexique.ts` writes where `apps/shenron/bot/src/lib/rag.ts` reads, with a
 * path derived by `fileURLToPath` (correct on Windows), or `RAG_LEXIQUE`.
 * Only the exported resolver is exercised; the script is never executed.
 */
import { tempPath } from "@aphrody/paths";
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	MissingEnvError,
	repoRootFromScript,
	requireAphrodyApiUrl,
	requireEmbedBaseUrl,
	requireOfflineRagDb,
	requireScriptEmbeddingSpace,
	resolveLexiquePath,
} from "../scripts/lib/script-env";

const WIN_SCRIPT = "file:///C:/Users/dev/src/shenron/packages/shenron/pipeline/scripts/rag-lexique.ts";
const POSIX_SCRIPT = "file:///srv/rg/releases/shenron/packages/shenron/pipeline/scripts/rag-lexique.ts";

describe("resolveLexiquePath (B6)", () => {
	it("resolves the bot lexicon on win32 without a leading slash", () => {
		const p = resolveLexiquePath(WIN_SCRIPT, {}, "win32");
		expect(p).toBe("C:\\Users\\dev\\src\\shenron\\apps\\shenron\\bot\\data\\rag\\lexique-requetes.json");
		expect(p.startsWith("/")).toBe(false);
	});

	it("resolves the bot lexicon on posix", () => {
		expect(resolveLexiquePath(POSIX_SCRIPT, {}, "posix")).toBe(
			"/srv/rg/releases/shenron/apps/shenron/bot/data/rag/lexique-requetes.json"
		);
	});

	it("honours RAG_LEXIQUE", () => {
		expect(resolveLexiquePath(POSIX_SCRIPT, { RAG_LEXIQUE: "/var/lib/shenron/lexique.json" }, "posix")).toBe(
			"/var/lib/shenron/lexique.json"
		);
	});

	it("matches the file the bot reads in this checkout", () => {
		const scriptUrl = new URL("../scripts/rag-lexique.ts", import.meta.url).href;
		const botReads = fileURLToPath(new URL("../../../../apps/shenron/bot/data/rag/lexique-requetes.json", import.meta.url));
		expect(resolveLexiquePath(scriptUrl, {})).toBe(botReads);
	});

	it("derives the repository root from a script URL", () => {
		expect(repoRootFromScript(POSIX_SCRIPT, "posix")).toBe("/srv/rg/releases/shenron");
		expect(repoRootFromScript(WIN_SCRIPT, "win32")).toBe("C:\\Users\\dev\\src\\shenron");
	});
});

describe("script environment contract (B13, rule 9)", () => {
	it("has no embedder default and names the variables", () => {
		expect(() => requireEmbedBaseUrl({})).toThrow(MissingEnvError);
		expect(() => requireEmbedBaseUrl({})).toThrow(
			/APHRODY_AI_EMBED_BASE_URL ou APHRODY_SHENRON_EMBED_BASE_URL ou EMBED_URL ou APHRODY_RAG_EMBED_ENDPOINT/
		);
		expect(() => requireAphrodyApiUrl({})).toThrow(/APHRODY_AI_HTTP_URL ou APHRODY_SHENRON_API_URL/);
	});

	it("reads the canonical APHRODY_AI_* names before the legacy aliases", () => {
		expect(
			requireEmbedBaseUrl({ APHRODY_AI_EMBED_BASE_URL: "http://127.0.0.1:9002/v1", EMBED_URL: "http://127.0.0.1:9000" })
		).toEqual({ name: "APHRODY_AI_EMBED_BASE_URL", baseUrl: "http://127.0.0.1:9002/v1", origin: "http://127.0.0.1:9002" });
		expect(requireAphrodyApiUrl({ APHRODY_AI_HTTP_URL: "http://127.0.0.1:9003", APHRODY_SHENRON_API_URL: "http://127.0.0.1:1" })).toBe(
			"http://127.0.0.1:9003/"
		);
	});

	it("refuses to write vectors into another embedding space", () => {
		expect(requireScriptEmbeddingSpace({}, { model: "Xenova/multilingual-e5-small", dim: 384 })).toEqual({
			model: "Xenova/multilingual-e5-small",
			dimensions: 384,
		});
		expect(() => requireScriptEmbeddingSpace({ APHRODY_AI_EMBED_DIMENSIONS: "1024" })).toThrow(/never mixed/);
		expect(() => requireScriptEmbeddingSpace({}, { model: "Xenova/multilingual-e5-small", dim: 768 })).toThrow(/rag_meta/);
	});

	it("appends /v1 to EMBED_URL and keeps an explicit base", () => {
		expect(requireEmbedBaseUrl({ EMBED_URL: "http://127.0.0.1:9000/" })).toEqual({
			name: "EMBED_URL",
			baseUrl: "http://127.0.0.1:9000/v1",
			origin: "http://127.0.0.1:9000",
		});
		expect(requireEmbedBaseUrl({ APHRODY_SHENRON_EMBED_BASE_URL: "http://localhost:9001/v1", EMBED_URL: "http://x:1" }).name).toBe(
			"APHRODY_SHENRON_EMBED_BASE_URL"
		);
	});

	it("refuses a destructive rebuild without RAG_DB or against the served database", () => {
		expect(() => requireOfflineRagDb({}, "/srv/shenron", "posix")).toThrow(/RAG_DB/);
		expect(() => requireOfflineRagDb({ RAG_DB: "/srv/shenron/apps/shenron/bot/data/bot.db" }, "/srv/shenron", "posix")).toThrow(
			/base servie/
		);
		expect(() =>
			requireOfflineRagDb({ RAG_DB: "c:\\shenron\\APPS\\shenron\\bot\\data\\bot.db" }, "C:\\shenron", "win32")
		).toThrow(/base servie/);
		expect(requireOfflineRagDb({ RAG_DB: tempPath("ragbuild.db") }, "/srv/shenron", "posix")).toBe(tempPath("ragbuild.db"));
	});
});
