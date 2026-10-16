// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";
import { checkoutPath } from "@aphrody/paths";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const copies = [
  [
    resolve(root, "tools/config/bun-forge.json"),
    resolve(
      dirname(Bun.resolveSync("@aphrody/yolo-cli/forge", import.meta.dir)),
      "defaults.json",
    ),
  ],
  [
    resolve(root, "crates/ai/agent-home/sync-contract.json"),
    resolve(
      dirname(Bun.resolveSync("@aphrody/google/api", import.meta.dir)),
      "sync-contract.json",
    ),
  ],
  ...[
    "x-graphql-catalog.json",
    "gryphon-graphql-catalog.json",
    "x-policy.json",
  ].map((name) => [
    checkoutPath("bun", "packages/web/rust/crates/x/data", name),
    Bun.resolveSync(
      `@aphrody/web-source/packages/x/data/${name}`,
      import.meta.dir,
    ),
  ]),
];
for (const [source, packaged] of copies) {
  test(`packaged config preserves canonical owner: ${relative(root, source!)}`, async () => {
    expect(await Bun.file(packaged!).json()).toEqual(
      await Bun.file(source!).json(),
    );
  });
}
