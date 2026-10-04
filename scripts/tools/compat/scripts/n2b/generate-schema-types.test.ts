// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaPaths } from "./generate-schema-types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "n2b-schema-"));
  roots.push(root);
  const consumer = join(root, "consumer");
  const producer = join(root, "producer");
  await Bun.write(
    join(consumer, "config/sibling-checkouts.json"),
    JSON.stringify({
      yolo: { path: "../producer", envOverride: "APHRODY_YOLO_ROOT" },
    }),
  );
  return { consumer, producer };
}

test("schema and Rust output belong to Yolo; generated TS belongs to consumer", async () => {
  const { consumer, producer } = await fixture();
  const schema = join(producer, "crates/aphrody-n2b-types/schema/v2.json");
  await Bun.write(schema, '{"title":"N2BReport"}');
  const paths = await schemaPaths(consumer, producer);
  expect(paths.schema).toBe(schema);
  expect(paths.rust).toBe(join(producer, "crates/aphrody-n2b-types/src/schema.rs"));
  expect(paths.format).toBe(join(producer, "crates/aphrody-n2b-types/rustfmt.toml"));
  expect(paths.ts).toBe(join(consumer, "packages/compat/n2b-types/src/index.ts"));
  expect(await Bun.file(paths.schema).json()).toEqual({ title: "N2BReport" });
});

test("missing producer fails instead of using a stale local schema", async () => {
  const { consumer, producer } = await fixture();
  await Bun.write(join(consumer, "crates/contracts/schema/v2.json"), "{}");
  await expect(schemaPaths(consumer, producer)).rejects.toThrow("Canonical N2B schema missing");
});

test("producer override is explicit and local", async () => {
  const { consumer, producer } = await fixture();
  const selected = join(producer, "alternate");
  await Bun.write(join(selected, "crates/aphrody-n2b-types/schema/v2.json"), "{}");
  expect((await schemaPaths(consumer, selected)).schema).toBe(
    join(selected, "crates/aphrody-n2b-types/schema/v2.json"),
  );
});
