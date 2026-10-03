#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { loadLiveRagEnv, requireLiveRag } from "../src/testing/live-rag";

loadLiveRagEnv();
const maxAgeMs = Number(process.env.SHENRON_RAG_MAX_AGE_SECONDS ?? 3600) * 1000;
if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
  throw new Error("SHENRON_RAG_MAX_AGE_SECONDS must be positive");
async function synchronize(): Promise<void> {
  const sync = Bun.spawn(
    [process.execPath, `${import.meta.dir}/rag-sync-aphrody.ts`, "--toutes", "--appliquer"],
    { stdout: "inherit", stderr: "inherit", env: process.env },
  );
  if ((await sync.exited) !== 0) throw new Error("Full Shenron RAG preload failed");
}
const startedAt = Date.now();
await synchronize();
if (Date.now() - startedAt >= maxAgeMs * 0.8) {
  // Re-read all sources after a long first ingestion. Unchanged sources verify
  // their durable counts/vectors and do not repeat their writes or embeddings.
  console.log("Long preload completed; validating the current editorial corpus again");
  await synchronize();
}
const { stats, completedAt } = await requireLiveRag();
console.log(
  JSON.stringify({
    status: "ready",
    backend: "aphrody",
    chunks: stats.chunks,
    vectors: stats.vectors,
    completedAt,
  }),
);
