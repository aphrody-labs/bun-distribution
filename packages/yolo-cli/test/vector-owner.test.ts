// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import * as vectors from "../../core/src/math/vectors";
import * as legacy from "../../core/src/gemma4/engine";

test("Gemma compatibility exports share the pure vector owner", () => {
  expect(legacy.cosineSimilarity).toBe(vectors.cosineSimilarity);
  expect(legacy.euclideanDistance).toBe(vectors.euclideanDistance);
  expect(legacy.normalizeL2).toBe(vectors.normalizeL2);
});

test("vector retrieval bundles without Gemma profiles or inference transport", async () => {
  const result = await Bun.build({
    entrypoints: [new URL("../../yolo-core/src/redis/vector.ts", import.meta.url).pathname],
    target: "bun",
    sourcemap: "external",
  });
  expect(result.success).toBe(true);
  const map = result.outputs.find(output => output.path.endsWith(".map"));
  expect(map).toBeDefined();
  const sources: string[] = JSON.parse(await map!.text()).sources;
  expect(sources.some(path => path.endsWith("math/vectors.ts"))).toBe(true);
  expect(sources.some(path => path.includes("/gemma4/"))).toBe(false);
});
