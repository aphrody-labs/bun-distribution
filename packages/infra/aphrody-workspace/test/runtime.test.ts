// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { infraRoot } from "../src/runtime.ts";

test("Infra bridge resolves the new monorepo Rust workspace", async () => {
  const root = infraRoot();
  expect(await Bun.file(join(root, "Cargo.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, "crates/infra/aphrody-infra/Cargo.toml")).exists()).toBe(true);
});
