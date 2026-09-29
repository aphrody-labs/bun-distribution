// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	AI_ENV,
	AiConfigError,
	aiEnvNames,
	aiServiceHealthUrl,
	assertEmbeddingSpace,
	chatTimeoutMs,
	DEFAULT_AI_TIMEOUTS,
	EmbeddingSpaceMismatchError,
	requireAiHttpToken,
	requireAiHttpUrl,
	requireEmbedBaseUrl,
	requireEmbeddingSpace,
	resolveAiConfig,
	resolveChatModel,
	resolveEmbedBaseUrl,
	resolveRerank,
	resolveVisionModel,
	SHENRON_RAG_INDEX,
} from "../../src/ai/config";
import { loopbackBase } from "./helpers";

const TOKEN = "t".repeat(40);
const LOOP = loopbackBase(18789).origin;
const E5_ORIGIN = loopbackBase(18794).origin;
const E5 = `${E5_ORIGIN}/v1`;

function ok(env: Record<string, string>) {
	const r = resolveAiConfig(env);
	if (!r.ok) throw new Error(`unexpected issues: ${JSON.stringify(r.issues)}`);
	return r.config;
}

describe("resolveAiConfig", () => {
	test("empty env: nothing configured, reasons named, no throw", () => {
		const cfg = ok({});
		expect(cfg.compute).toBeNull();
		expect(cfg.embed).toBeNull();
		expect(cfg.e5BaseUrl).toBeNull();
		expect(cfg.rerank).toBeNull();
		expect(cfg.chatModel).toBe("gemini-web/flash");
		expect(cfg.visionModel).toBe("gemini-web/flash");
		expect(cfg.embedSpace).toEqual({ model: SHENRON_RAG_INDEX.model, dimensions: 384 });
		expect(cfg.ragBackend).toBe("local");
		expect(cfg.timeouts).toEqual({ ...DEFAULT_AI_TIMEOUTS });
		const caps = cfg.disabled.map((d) => d.capability).toSorted();
		expect(caps).toEqual(["chat", "compute", "embed", "ocr", "rag"]);
		for (const d of cfg.disabled) expect(d.reason).toContain("APHRODY_AI_HTTP_URL");
	});

	test("canonical compute names: origin form, aphrody embed transport", () => {
		const cfg = ok({
			APHRODY_AI_HTTP_URL: `${LOOP}/`,
			APHRODY_AI_HTTP_TOKEN: TOKEN,
			RAG_BACKEND: "aphrody",
		});
		expect(cfg.compute?.baseUrl.href).toBe(`${LOOP}/`);
		expect(cfg.compute?.token).toBe(TOKEN);
		expect(cfg.embed).toEqual({ transport: "aphrody" });
		expect(cfg.ragBackend).toBe("aphrody");
		expect(cfg.disabled).toEqual([]);
	});

	test("legacy compute aliases still work; canonical wins when both are set", () => {
		const legacy = ok({ APHRODY_SHENRON_API_URL: LOOP, APHRODY_SHENRON_API_TOKEN: TOKEN });
		expect(legacy.compute?.baseUrl.origin).toBe(LOOP);
		const other = loopbackBase(18800).origin;
		const both = ok({
			APHRODY_AI_HTTP_URL: other,
			APHRODY_SHENRON_API_URL: LOOP,
			APHRODY_AI_HTTP_TOKEN: TOKEN,
			APHRODY_SHENRON_API_TOKEN: "x".repeat(40),
		});
		expect(both.compute?.baseUrl.origin).toBe(other);
		expect(both.compute?.token).toBe(TOKEN);
	});

	test("non-loopback URL and short token: issues name variables, never values", () => {
		const secret = "short-secret-value";
		const remote = ["http://", "example.org", ":8789"].join("");
		const r = resolveAiConfig({
			APHRODY_AI_HTTP_URL: remote,
			APHRODY_AI_HTTP_TOKEN: secret,
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.map((i) => i.name).toSorted()).toEqual([
			"APHRODY_AI_HTTP_TOKEN",
			"APHRODY_AI_HTTP_URL",
		]);
		const serialised = JSON.stringify(r.issues);
		expect(serialised).not.toContain(secret);
		expect(serialised).not.toContain("example.org");
	});

	test("URL without token is an issue naming the canonical token variable", () => {
		const r = resolveAiConfig({ APHRODY_SHENRON_API_URL: LOOP });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.issues).toHaveLength(1);
			expect(r.issues[0]).toMatchObject({ name: "APHRODY_AI_HTTP_TOKEN", problem: "missing" });
			expect(r.issues[0]?.hint).toContain("APHRODY_SHENRON_API_TOKEN");
		}
	});

	test("e5-direct transport from any embed name; compute configured wins", () => {
		const cfg = ok({ APHRODY_AI_EMBED_BASE_URL: `${E5}/` });
		expect(cfg.embed?.transport).toBe("e5-direct");
		if (cfg.embed?.transport === "e5-direct") expect(cfg.embed.baseUrl.pathname).toBe("/v1");
		const both = ok({
			APHRODY_AI_HTTP_URL: LOOP,
			APHRODY_AI_HTTP_TOKEN: TOKEN,
			APHRODY_AI_EMBED_BASE_URL: E5,
		});
		expect(both.embed).toEqual({ transport: "aphrody" });
		expect(both.e5BaseUrl?.href).toBe(E5);
	});

	test("chat and vision model ids: canonical, aliases in contract order, <= 128 chars", () => {
		expect(ok({ APHRODY_LLM_MODEL: "gemini-web/pro" }).chatModel).toBe("gemini-web/pro");
		expect(ok({ APHRODY_SHENRON_LLM_MODEL: "qwen3" }).chatModel).toBe("qwen3");
		expect(
			ok({ APHRODY_AI_CHAT_MODEL: "gemini-web/flash-lite", APHRODY_LLM_MODEL: "gemini-web/pro" })
				.chatModel
		).toBe("gemini-web/flash-lite");
		expect(ok({ APHRODY_LLM_MODEL: "  " }).chatModel).toBe("gemini-web/flash");
		expect(resolveAiConfig({ APHRODY_AI_CHAT_MODEL: "m".repeat(129) }).ok).toBe(false);
		expect(ok({ APHRODY_SHENRON_VISION_MODEL: "qwen3-vl" }).visionModel).toBe("qwen3-vl");
		expect(resolveChatModel({ APHRODY_AI_CHAT_MODEL: "gemini-web/pro" })).toBe("gemini-web/pro");
		expect(resolveVisionModel({})).toBe("gemini-web/flash");
	});

	test("ragBackend only on exact match; EMBED_TIMEOUT_MS", () => {
		expect(ok({ RAG_BACKEND: "Aphrody" }).ragBackend).toBe("local");
		expect(ok({ RAG_BACKEND: " aphrody" }).ragBackend).toBe("local");
		expect(ok({ EMBED_TIMEOUT_MS: "1500" }).timeouts.embedHot).toBe(1500);
		expect(resolveAiConfig({ EMBED_TIMEOUT_MS: "abc" }).ok).toBe(false);
	});

	test("chat timeout: 125 s for gemini-web/*, 90 s otherwise", () => {
		expect(chatTimeoutMs("gemini-web/flash")).toBe(125_000);
		expect(chatTimeoutMs("qwen3")).toBe(90_000);
		expect(chatTimeoutMs(undefined)).toBe(90_000);
	});
});

describe("embed base URL forms", () => {
	const base = (env: Record<string, string>) => {
		const r = resolveEmbedBaseUrl(env);
		if (!r.ok) throw new Error(JSON.stringify(r.issues));
		return r.value?.href ?? null;
	};

	test("base form must end with /v1", () => {
		expect(base({ APHRODY_AI_EMBED_BASE_URL: E5 })).toBe(E5);
		expect(base({ APHRODY_SHENRON_EMBED_BASE_URL: `${E5}/` })).toBe(E5);
		const bad = resolveEmbedBaseUrl({ APHRODY_AI_EMBED_BASE_URL: E5_ORIGIN });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.issues[0]).toMatchObject({ name: "APHRODY_AI_EMBED_BASE_URL", problem: "invalid" });
	});

	test("EMBED_URL is an origin: /v1 is appended", () => {
		expect(base({ EMBED_URL: E5_ORIGIN })).toBe(E5);
		expect(base({ EMBED_URL: `${E5_ORIGIN}/` })).toBe(E5);
	});

	test("APHRODY_RAG_EMBED_ENDPOINT is an endpoint: the operation path is removed", () => {
		expect(base({ APHRODY_RAG_EMBED_ENDPOINT: `${E5}/embeddings` })).toBe(E5);
		expect(resolveEmbedBaseUrl({ APHRODY_RAG_EMBED_ENDPOINT: E5 }).ok).toBe(false);
	});

	test("contract order: canonical, then APHRODY_SHENRON_EMBED_BASE_URL, EMBED_URL, APHRODY_RAG_EMBED_ENDPOINT", () => {
		const other = `${loopbackBase(18900).origin}/v1`;
		expect(base({ EMBED_URL: E5_ORIGIN, APHRODY_SHENRON_EMBED_BASE_URL: other })).toBe(other);
		expect(base({ APHRODY_AI_EMBED_BASE_URL: other, EMBED_URL: E5_ORIGIN })).toBe(other);
	});

	test("no default: missing is an error naming the variables", () => {
		expect(base({})).toBeNull();
		expect(() => requireEmbedBaseUrl({})).toThrow(AiConfigError);
		expect(() => requireEmbedBaseUrl({})).toThrow(/APHRODY_AI_EMBED_BASE_URL.*EMBED_URL/);
		expect(aiServiceHealthUrl(new URL(E5)).href).toBe(`${E5_ORIGIN}/health`);
	});
});

describe("aphrody-ai-http require helpers", () => {
	test("missing URL or token is an error naming canonical and legacy names", () => {
		expect(() => requireAiHttpUrl({})).toThrow(/APHRODY_AI_HTTP_URL.*APHRODY_SHENRON_API_URL/);
		expect(() => requireAiHttpToken({})).toThrow(/APHRODY_AI_HTTP_TOKEN.*APHRODY_SHENRON_API_TOKEN/);
	});

	test("the URL is reduced to its origin; the token never appears in errors", () => {
		expect(requireAiHttpUrl({ APHRODY_AI_HTTP_URL: `${LOOP}/api/v1/shenron` }).href).toBe(`${LOOP}/`);
		expect(requireAiHttpToken({ APHRODY_SHENRON_API_TOKEN: TOKEN })).toBe(TOKEN);
		const remote = ["http://", "example.org", ":1"].join("");
		try {
			requireAiHttpUrl({ APHRODY_AI_HTTP_URL: remote });
			throw new Error("expected a throw");
		} catch (error) {
			expect(error).toBeInstanceOf(AiConfigError);
			expect(String(error)).not.toContain("example.org");
		}
	});
});

describe("embedding space (never mix spaces)", () => {
	test("defaults to the contract index", () => {
		expect(requireEmbeddingSpace({})).toEqual({ model: "Xenova/multilingual-e5-small", dimensions: 384 });
	});

	test("the same model, with or without its hub namespace, is accepted", () => {
		expect(
			requireEmbeddingSpace({
				APHRODY_AI_EMBED_MODEL: "multilingual-e5-small",
				APHRODY_AI_EMBED_DIMENSIONS: "384",
			}).dimensions
		).toBe(384);
		expect(requireEmbeddingSpace({ APHRODY_RAG_EMBED_DIM: "384" }).dimensions).toBe(384);
	});

	test("another dimension or another model is a hard error", () => {
		expect(() => requireEmbeddingSpace({ APHRODY_AI_EMBED_DIMENSIONS: "1024" })).toThrow(
			EmbeddingSpaceMismatchError
		);
		expect(() => requireEmbeddingSpace({ APHRODY_AI_EMBED_MODEL: "qwen3-embedding-0.6b" })).toThrow(
			EmbeddingSpaceMismatchError
		);
		expect(() =>
			assertEmbeddingSpace(
				{ model: SHENRON_RAG_INDEX.model, dimensions: 384 },
				{ model: SHENRON_RAG_INDEX.model, dimensions: 768 },
				"rag_meta"
			)
		).toThrow(/rag_meta/);
	});

	test("a malformed dimension is a configuration error", () => {
		expect(() => requireEmbeddingSpace({ APHRODY_AI_EMBED_DIMENSIONS: "384.5" })).toThrow(AiConfigError);
		expect(resolveAiConfig({ APHRODY_AI_EMBED_DIMENSIONS: "-1" }).ok).toBe(false);
	});
});

describe("rerank dialects", () => {
	const rerank = (env: Record<string, string>) => {
		const r = resolveRerank(env);
		if (!r.ok) throw new Error(JSON.stringify(r.issues));
		return r.value;
	};

	test("optional: absent means disabled", () => {
		expect(rerank({})).toBeNull();
	});

	test("canonical base form posts to /v1/rerank in the llama-server dialect", () => {
		const r = rerank({ APHRODY_AI_RERANK_BASE_URL: E5, APHRODY_AI_RERANK_MODEL: "qwen3-reranker" });
		expect(r?.endpoint.href).toBe(`${E5}/rerank`);
		expect(r?.dialect).toBe("llama-server");
		expect(r?.model).toBe("qwen3-reranker");
	});

	test("RERANK_URL keeps the Shenron sidecar dialect and its exact endpoint", () => {
		const r = rerank({ RERANK_URL: `${E5_ORIGIN}/rerank` });
		expect(r?.endpoint.href).toBe(`${E5_ORIGIN}/rerank`);
		expect(r?.dialect).toBe("shenron-sidecar");
	});

	test("APHRODY_RAG_RERANK_ENDPOINT is a llama-server endpoint", () => {
		const r = rerank({ APHRODY_RAG_RERANK_ENDPOINT: `${E5}/rerank`, APHRODY_RAG_RERANK_MODEL: "m" });
		expect(r?.dialect).toBe("llama-server");
		expect(r?.model).toBe("m");
	});
});

describe("aphrody-infra contract parity", () => {
	// The contract lives in the sibling aphrody-infra checkout; CI runners
	// without it skip this parity check (the table above still pins the names).
	const contractPath = join(import.meta.dir, "..", "..", "..", "..", "aphrody-infra", "config", "local-ai.json");
	const present = existsSync(contractPath);

	test.skipIf(!present)("AI_ENV mirrors the canonical names and alias order of local-ai.json", () => {
		const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
			gateways: Record<string, { env: { canonical: string; aliases: string[] }[] }>;
			capabilities: Record<string, { env: { canonical: string; aliases: string[] }[] }>;
			indexes: Record<string, { servedModel: string; dimensions: number }>;
		};
		const entries = [
			...Object.values(contract.gateways).flatMap((g) => g.env),
			...Object.values(contract.capabilities).flatMap((c) => c.env),
		];
		const byCanonical = new Map(entries.map((e) => [e.canonical, e.aliases]));
		for (const setting of Object.values(AI_ENV)) {
			expect(byCanonical.has(setting.canonical)).toBe(true);
			expect(aiEnvNames(setting).slice(1)).toEqual(byCanonical.get(setting.canonical) ?? []);
		}
		const index = contract.indexes["shenron-rag"];
		expect(index?.servedModel).toBe(SHENRON_RAG_INDEX.model);
		expect(index?.dimensions).toBe(SHENRON_RAG_INDEX.dimensions);
	});
});

describe("source hygiene", () => {
	test("no host or port literal in src/", () => {
		const dir = join(import.meta.dir, "..", "src");
		const offenders: string[] = [];
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
			const text = readFileSync(join(dir, file), "utf8");
			if (/127\.0\.0\.1|localhost|\[::1\]|https?:\/\/[a-z0-9.-]+:\d+|:\d{4,5}\b(?!\))/i.test(text))
				offenders.push(file);
		}
		expect(offenders).toEqual([]);
	});
});
