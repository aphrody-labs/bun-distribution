// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaPaths } from "./generate-schema-types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "n2b-schema-"));
  roots.push(root);
  return root;
}

test("schema lives in crates/contracts; generated TS in the runtime SDK", async () => {
  const root = await fixture();
  const schema = join(root, "crates/contracts/schema/v2.json");
  await Bun.write(schema, '{"title":"N2BReport"}');
  const paths = await schemaPaths(root);
  expect(paths.schema).toBe(schema);
  expect(paths.ts).toBe(
    join(root, "packages/engine/runtime/src/tooling-schema.ts"),
  );
  expect(await Bun.file(paths.schema).json()).toEqual({ title: "N2BReport" });
});

test("a missing canonical schema fails", async () => {
  const root = await fixture();
  await expect(schemaPaths(root)).rejects.toThrow(
    "Canonical N2B schema missing",
  );
});

test("the repository schema is present", async () => {
  expect(await Bun.file((await schemaPaths()).schema).exists()).toBe(true);
});
