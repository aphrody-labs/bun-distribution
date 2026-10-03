#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { loadLiveRagEnv, requireLiveRag } from "../src/testing/live-rag";

loadLiveRagEnv();
const sync = Bun.spawn(
  [process.execPath, `${import.meta.dir}/rag-sync-aphrody.ts`, "--toutes", "--appliquer"],
  {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  },
);
if ((await sync.exited) !== 0) throw new Error("Full Shenron RAG preload failed");
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
