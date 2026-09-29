// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import type { AphrodyComputeClient, AphrodyRagDocument } from "@shenron/pipeline/aphrody";
import { prepareSource, syncSource } from "./_rag-aphrody-sync";

const chunk = { kind: "character", title: "Son Goku", url: "/wiki/personnages/son-goku", content: "Son Goku est un Saiyan.", lang: "fr", entity: "Son Goku" };

describe("Aphrody editorial RAG sync", () => {
	it("keeps passage IDs stable when editorial content changes", () => {
		const before = prepareSource("db_characters", [chunk]);
		const after = prepareSource("db_characters", [{ ...chunk, content: "Son Goku est un Saiyan né sur Vegeta." }]);
		expect(after.documents[0]?.sourceId).toBe(before.documents[0]?.sourceId);
		expect(after.digest).not.toBe(before.digest);
		expect(before.documents[0]?.url).toBe("https://dragonballfr.com/wiki/personnages/son-goku");
	});

	it("skips an unchanged source only when Aphrody confirms its document and count", async () => {
		const prepared = prepareSource("db_characters", [chunk]);
		const digest = prepared.digest;
		const previous = { digest, count: 1, generation: "previous", completedAt: "2026-01-01T00:00:00Z" };
		const client = {
			ragStats: async () => ({ chunks: 1, vectors: 0, sources: [{ sourceId: "db_characters", kind: "character", count: 1 }] }),
			ragDocument: async () => ({ sourceId: prepared.documents[0]!.sourceId, title: chunk.title, url: prepared.documents[0]!.url, kind: chunk.kind, snippet: chunk.content }),
		} as Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		const { result, state } = await syncSource(client, "db_characters", [chunk], previous, { apply: true });
		expect(result.unchanged).toBe(true);
		expect(result.indexed).toBe(0);
		expect(state).toBe(previous);
	});

	it("rebuilds an unchanged local manifest when Aphrody lost the source", async () => {
		const previous = { digest: prepareSource("db_characters", [chunk]).digest, count: 1, generation: "previous", completedAt: "2026-01-01T00:00:00Z" };
		const client = {
			ragStats: async () => ({ chunks: 0, vectors: 0, sources: [] }),
			ragDocument: async () => null,
			ragIngest: async (document: AphrodyRagDocument) => ({ indexed: true as const, sourceId: document.sourceId, vectorIndexed: true }),
			ragSyncFinish: async () => ({ retired: 0 }),
		} satisfies Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		const { result } = await syncSource(client, "db_characters", [chunk], previous, { apply: true });
		expect(result.unchanged).toBe(false);
		expect(result.indexed).toBe(1);
	});

	it("reindexes an unchanged source whose vectors became stale", async () => {
		const prepared = prepareSource("db_characters", [chunk]);
		const previous = { digest: prepared.digest, count: 1, generation: "previous", completedAt: "2026-01-01T00:00:00Z" };
		const client = {
			ragStats: async () => ({ chunks: 1, vectors: 0, sources: [{ sourceId: "db_characters", kind: "character", count: 1, vectors: 0 }] }),
			ragDocument: async () => ({ sourceId: prepared.documents[0]!.sourceId, title: chunk.title, url: prepared.documents[0]!.url, kind: chunk.kind, snippet: chunk.content }),
			ragIngest: async (document: AphrodyRagDocument) => ({ indexed: true as const, sourceId: document.sourceId, vectorIndexed: true }),
			ragSyncFinish: async () => ({ retired: 0 }),
		} satisfies Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		const { result } = await syncSource(client, "db_characters", [chunk], previous, { apply: true, requireVectors: true });
		expect(result.unchanged).toBe(false);
		expect(result.indexed).toBe(1);
	});

	it("ingests a whole generation before soft retirement", async () => {
		const events: string[] = [];
		const client = {
			ragStats: async () => ({ chunks: 0, vectors: 0, sources: [] }),
			ragDocument: async () => null,
			ragIngest: async (document: AphrodyRagDocument) => {
				events.push(`ingest:${document.sourceId}`);
				expect(document.syncGeneration).toMatch(/^[0-9a-f-]{36}$/);
				return { indexed: true as const, sourceId: document.sourceId, vectorIndexed: true };
			},
			ragSyncFinish: async (source: string, generation: string, expectedCount: number) => {
				events.push(`finish:${source}`);
				expect(expectedCount).toBe(2);
				expect(generation).toMatch(/^[0-9a-f-]{36}$/);
				return { retired: 3 };
			},
		} satisfies Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		const { result, state } = await syncSource(client, "db_characters", [chunk, { ...chunk, content: "Autre passage" }], undefined, { apply: true, concurrency: 2 });
		expect(events).toHaveLength(3);
		expect(events[2]).toBe("finish:db_characters");
		expect(result.retired).toBe(3);
		expect(state?.count).toBe(2);
	});

	it("never finishes or checkpoints an incomplete generation", async () => {
		let finishCalls = 0;
		const client = {
			ragStats: async () => ({ chunks: 0, vectors: 0, sources: [] }),
			ragDocument: async () => null,
			ragIngest: async () => { throw new Error("upstream unavailable"); },
			ragSyncFinish: async () => { finishCalls++; return { retired: 0 }; },
		} as unknown as Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		await expect(syncSource(client, "db_characters", [chunk], undefined, { apply: true })).rejects.toThrow("upstream unavailable");
		expect(finishCalls).toBe(0);
	});

	it("does not finish a remote generation without a confirmed E5 vector", async () => {
		let finishCalls = 0;
		const client = {
			ragStats: async () => ({ chunks: 0, vectors: 0, sources: [] }),
			ragDocument: async () => null,
			ragIngest: async (document: AphrodyRagDocument) => ({ indexed: true as const, sourceId: document.sourceId, vectorIndexed: false }),
			ragSyncFinish: async () => { finishCalls++; return { retired: 0 }; },
		} satisfies Pick<AphrodyComputeClient, "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument">;
		await expect(syncSource(client, "db_characters", [chunk], undefined, { apply: true, requireVectors: true })).rejects.toThrow("compatible E5 vector");
		expect(finishCalls).toBe(0);
	});

	it("refuses to retire a source rendered empty", async () => {
		await expect(syncSource(null, "db_characters", [], undefined, { apply: true })).rejects.toThrow("empty source");
	});
});
