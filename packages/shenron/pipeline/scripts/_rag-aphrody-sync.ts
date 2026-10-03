// SPDX-License-Identifier: Apache-2.0
/** Deterministic PostgreSQL-source documents for Aphrody's generation-based RAG sync. */
import { createHash, randomUUID } from "node:crypto";
import type { AphrodyComputeClient, AphrodyRagDocument } from "@shenron/pipeline/aphrody";
import type { SourceChunk } from "./_rag-sources-pg";

export interface SourceState {
  digest: string;
  count: number;
  generation: string;
  completedAt: string;
}

export interface SyncManifest {
  version: 1;
  sources: Record<string, SourceState>;
}

export interface SyncResult {
  source: string;
  rendered: number;
  indexed: number;
  retired: number;
  unchanged: boolean;
  generation?: string;
  digest: string;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function sourceUrl(value: string): string {
  const url = value.startsWith("/") ? new URL(value, "https://dragonballfr.com") : new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("RAG source URL must use HTTP(S)");
  return url.href;
}

export function prepareSource(
  source: string,
  chunks: SourceChunk[],
): { documents: AphrodyRagDocument[]; digest: string } {
  if (!/^[a-z0-9_]{1,64}$/.test(source)) throw new Error("Invalid RAG source name");
  const ordinals = new Map<string, number>();
  const documents = chunks.map((chunk) => {
    if (!chunk.title.trim() || !chunk.content.trim())
      throw new Error(`Empty RAG passage in ${source}`);
    const url = sourceUrl(chunk.url.trim());
    const group = JSON.stringify([url, chunk.kind, chunk.lang, chunk.entity]);
    const ordinal = ordinals.get(group) ?? 0;
    ordinals.set(group, ordinal + 1);
    return {
      sourceId: `shenron:pg:${source}:${sha256(group).slice(0, 24)}:${ordinal}`,
      title: chunk.title,
      url,
      content: chunk.content,
      kind: chunk.kind,
      lang: chunk.lang,
      originSourceId: source,
      ...(chunk.entity.trim() ? { entity: chunk.entity } : {}),
    };
  });
  const digest = sha256(JSON.stringify(documents));
  return { documents, digest };
}

export async function syncSource(
  client: Pick<
    AphrodyComputeClient,
    "ragIngest" | "ragSyncFinish" | "ragStats" | "ragDocument"
  > | null,
  source: string,
  chunks: SourceChunk[],
  previous: SourceState | undefined,
  options: {
    apply: boolean;
    force?: boolean;
    concurrency?: number;
    requireVectors?: boolean;
    onProgress?: (indexed: number, total: number) => void;
  },
): Promise<{ result: SyncResult; state?: SourceState }> {
  const { documents, digest } = prepareSource(source, chunks);
  const base = { source, rendered: documents.length, digest };
  if (documents.length === 0) {
    if (options.apply)
      throw new Error(`${source}: empty source; remote retirement requires explicit review`);
    return { result: { ...base, indexed: 0, retired: 0, unchanged: false } };
  }
  if (!options.force && previous?.digest === digest && previous.count === documents.length) {
    if (!options.apply)
      return { result: { ...base, indexed: 0, retired: 0, unchanged: true }, state: previous };
    if (!client) throw new Error("Aphrody RAG client is unavailable");
    const [stats, first] = await Promise.all([
      client.ragStats(),
      client.ragDocument(documents[0]!.sourceId),
    ]);
    const remoteSources = stats.sources.filter((item) => item.sourceId === source);
    const remoteCount = remoteSources.reduce((count, item) => count + item.count, 0);
    const remoteVectors = remoteSources.reduce((count, item) => count + (item.vectors ?? 0), 0);
    if (
      remoteCount === documents.length &&
      (!options.requireVectors || remoteVectors === documents.length) &&
      first?.title === documents[0]!.title &&
      first.url === documents[0]!.url
    ) {
      return { result: { ...base, indexed: 0, retired: 0, unchanged: true }, state: previous };
    }
  }
  if (!options.apply) return { result: { ...base, indexed: 0, retired: 0, unchanged: false } };
  if (!client) throw new Error("Aphrody RAG client is unavailable");
  const generation = randomUUID();
  const workers = Math.max(1, Math.min(16, options.concurrency ?? 4, documents.length));
  let cursor = 0;
  let indexed = 0;
  let firstFailure: { error: unknown } | undefined;
  const fail = (error: unknown): never => {
    firstFailure ??= { error };
    throw error;
  };
  const outcomes = await Promise.allSettled(
    Array.from({ length: workers }, async () => {
      for (;;) {
        if (firstFailure) return;
        const index = cursor++;
        if (index >= documents.length) return;
        let result: Awaited<ReturnType<AphrodyComputeClient["ragIngest"]>> | undefined;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            result = await client.ragIngest({ ...documents[index]!, syncGeneration: generation });
            break;
          } catch (error) {
            const transient =
              error instanceof Error &&
              /HTTP (408|429|500|502|503|504)|timeout|unreachable/i.test(error.message);
            if (!transient || attempt === 5) return fail(error);
            await Bun.sleep(Math.min(4000, 250 * 2 ** attempt));
            if (firstFailure) return;
          }
        }
        if (!result)
          return fail(new Error(`${source}: document ingestion exhausted its retry budget`));
        if (options.requireVectors && !result.vectorIndexed) {
          return fail(
            new Error(
              `${source}: Aphrody did not confirm a compatible E5 vector for ${documents[index]!.sourceId}`,
            ),
          );
        }
        indexed++;
        options.onProgress?.(indexed, documents.length);
      }
    }).map((worker) => worker.catch(fail)),
  );
  if (firstFailure) throw firstFailure.error;
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  if (indexed !== documents.length)
    throw new Error(`${source}: incomplete RAG ingestion ${indexed}/${documents.length}`);
  // Aphrody verifies the entire generation before it soft-retires older documents.
  const { retired } = await client.ragSyncFinish(source, generation, documents.length);
  const state = {
    digest,
    count: documents.length,
    generation,
    completedAt: new Date().toISOString(),
  };
  return { result: { ...base, indexed, retired, unchanged: false, generation }, state };
}
