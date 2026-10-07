// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const copies = [
  ["tools/config/bun-forge.json", "packages/engine/yolo/src/cli/forge/defaults.json"],
  ["crates/ai/agent-home/sync-contract.json", "packages/google/google/src/sync-contract.json"],
  ...["x-graphql-catalog.json", "gryphon-graphql-catalog.json", "x-policy.json"].map((name) => [
    `crates/web/x/data/${name}`,
    `packages/web/x/data/${name}`,
  ]),
];
for (const [source, packaged] of copies) {
  test(`packaged config preserves canonical owner: ${source}`, async () => {
    expect(await Bun.file(resolve(root, packaged!)).json()).toEqual(
      await Bun.file(resolve(root, source!)).json(),
    );
  });
}
