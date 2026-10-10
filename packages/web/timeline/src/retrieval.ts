// SPDX-License-Identifier: Apache-2.0
import { passage, type Entry, type Snapshot } from "./model.ts";

export interface RetrievalOptions {
  /** Aphrody REST origin; authentication stays with the calling application. */
  url: string;
  token: string;
  /** A dedicated projection namespace, distinct from other editorial importers. */
  originSourceId: string;
  lang?: string;
  content?: (entry: Entry) => string | Promise<string>;
  requireVectors?: boolean;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Idempotent upserts followed by a namespace-scoped, count-checked soft retirement. */
export async function indexRetrieval(snapshot: Snapshot, options: RetrievalOptions) {
  const origin = new URL(options.url);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    !["http:", "https:"].includes(origin.protocol) ||
    !options.token.trim() ||
    !options.originSourceId.trim() ||
    options.originSourceId.length > 200 ||
    !snapshot.entries.length
  )
    throw new Error("invalid retrieval configuration");
  const transport = options.fetcher ?? fetch;
  const generation = crypto.randomUUID();
  const post = async (path: string, body: unknown) => {
    const response = await transport(new URL(`/api/v1/shenron/rag/${path}`, origin), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Never expose response bodies, tokens or private source content in error output.
    if (!response.ok) throw new Error(`retrieval ${path} failed (${response.status})`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  let vectors = 0;
  for (const entry of snapshot.entries) {
    const sourceId = `${options.originSourceId}:${entry.key}`;
    let content = passage(entry, snapshot.source);
    if (options.content) {
      // eslint-disable-next-line no-await-in-loop -- Content belongs to this serial document upsert.
      content = await options.content(entry);
    }
    // eslint-disable-next-line no-await-in-loop -- Avoid flooding the shared embedding service.
    const result = await post("ingest", {
      sourceId,
      originSourceId: options.originSourceId,
      syncGeneration: generation,
      title: entry.title,
      url: entry.href,
      content,
      kind: entry.kind === "age" ? "timeline_event" : `timeline_${entry.kind}`,
      lang: options.lang,
    });
    if (result.sourceId !== sourceId || result.indexed !== true)
      throw new Error("retrieval did not acknowledge the document");
    if (result.vectorIndexed === true) vectors++;
    else if (options.requireVectors) throw new Error("retrieval vector indexing unavailable");
  }
  // Only this projection's namespace can be retired, and only after every upsert succeeded.
  const finished = await post("sync/finish", {
    originSourceId: options.originSourceId,
    syncGeneration: generation,
    expectedCount: snapshot.entries.length,
  });
  if (finished.active !== snapshot.entries.length || finished.status !== "complete")
    throw new Error("retrieval sync count mismatch");
  return {
    indexed: snapshot.entries.length,
    vectors,
    retired: finished.retired,
    originSourceId: options.originSourceId,
  };
}
