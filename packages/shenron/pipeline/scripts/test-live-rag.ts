#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { requireLiveRag } from "../src/testing/live-rag";

const { stats } = await requireLiveRag();
console.log(`Real Shenron RAG: ${stats.chunks} passages, ${stats.vectors} current E5 vectors`);
const root = resolve(import.meta.dir, "../../../..");
const tests = [
  "packages/shenron/pipeline/src/testing/live-rag.test.ts",
  "packages/shenron/pipeline/test/aphrody/compute-live.test.ts",
  "packages/shenron/pipeline/test/ai/wire-live.test.ts",
  "packages/shenron/pipeline/test/aphrody/a2a-rag-live.test.ts",
  "packages/shenron/pipeline/test/workflows-rag-live.test.ts",
  "packages/shenron/pipeline/test/bridge-rag-live.test.ts",
  "packages/shenron/pipeline/test/storage-rag-live.test.ts",
  "packages/shenron/api/test/rag-live.test.ts",
  "apps/shenron/bot/tests/rag-aphrody.test.ts",
  "apps/shenron/bot/tests/rag-filter.test.ts",
  "apps/shenron/bot/tests/rag-eval.test.ts",
  "apps/shenron/bot/tests/rag-ai-env.test.ts",
  "apps/shenron/bot/tests/rag-import-graph.test.ts",
  "apps/shenron/bot/tests/training-rag-live.test.ts",
  "apps/shenron/bot/tests/semantic-cache-live.test.ts",
  "apps/shenron/bot/tests/llm-rag-live.test.ts",
  "apps/shenron/site/tests/site-rag-aphrody.test.ts",
  "apps/shenron/site/tests/readiness-rag-live.test.ts",
  "apps/shenron/site/tests/admin-ia-rag-live.test.ts",
  "apps/shenron/site/tests/manga-api.test.ts",
  "apps/shenron/site/tests/manga-integration.test.ts",
  "apps/shenron/site/tests/databook-features.test.ts",
  "apps/shenron/site/tests/rag-refonte-sources.test.ts",
  "packages/shenron/pipeline/scripts/_rag-aphrody-sync.test.ts",
  "packages/shenron/pipeline/scripts/_rag-corpus-sources.test.ts",
];
// Isolation prevents unrelated protocol-failure tests from replacing live transports.
for (const test of tests) {
  const child = Bun.spawn([process.execPath, "test", "--timeout", "120000", resolve(root, test)], {
    cwd: resolve(root, test, "../.."),
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if ((await child.exited) !== 0) process.exit(1);
}
