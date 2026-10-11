// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { obscuraSourceRoot } from "./obscura-sources";

describe("Obscura source resolution", () => {
  test("finds the package selected by the locked Cargo workspace", async () => {
    const workspace = resolve(import.meta.dir, "../../..");
    const sourceRoot = obscuraSourceRoot(workspace);

    expect(await Bun.file(join(sourceRoot, "obscura-js/Cargo.toml")).exists()).toBe(true);
    expect(await Bun.file(join(sourceRoot, "obscura-js/src/ops.rs")).exists()).toBe(true);
  });
});
