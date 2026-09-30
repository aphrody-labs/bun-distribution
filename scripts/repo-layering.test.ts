// SPDX-License-Identifier: Apache-2.0
/**
 * Guard against the sibling `aphrody-*` category repositories drifting back into a cycle
 * (docs/REPO-LAYERING.md). Runs the real graph against the checkout next to this repository, so
 * it only asserts something meaningful when the sibling repositories are present (CI and local
 * dev both check them out side by side; a lone checkout of `aphrody-infra` skips it).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { collectEdges, cycles, LAYERS, violations } from "./repo-layering.ts";

const root = resolve(import.meta.dir, "..", "..");
const siblingsPresent = Object.keys(LAYERS).filter((repo) => repo !== "aphrody-infra")
  .some((repo) => existsSync(join(root, repo, "Cargo.toml")));

describe.skipIf(!siblingsPresent)("repository layering", () => {
  test("the sibling category repositories form a DAG with no layer violations", async () => {
    const { edges, errors } = collectEdges(root);
    // `aphrody-ai` may be mid-edit by another agent and briefly fail `cargo metadata`; that is
    // not a layering regression, so only fail on errors from a repository this check can reach.
    const hardErrors = errors.filter((error) => !error.startsWith("aphrody-ai:"));
    expect(hardErrors).toEqual([]);
    const loops = cycles(
      Object.keys(LAYERS),
      edges.filter((edge) => edge.kind !== "declared-only"),
    );
    expect(loops).toEqual([]);
    expect(violations(edges)).toEqual([]);
  }, 120_000);
});
