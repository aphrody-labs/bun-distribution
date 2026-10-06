// SPDX-License-Identifier: Apache-2.0
// Static drift gate (no native library needed): the C exports of crates/ai/rag-ffi vs RAG_SYMBOLS.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RAG_SYMBOLS } from "../src/ffi";

const source = readFileSync(
  join(import.meta.dir, "../../../../crates/ai/rag-ffi/src/lib.rs"),
  "utf8",
);
const re =
  /#\[unsafe\(no_mangle\)\]\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+(\w+)\s*\(([^)]*)\)/g;

test("every Rust export has a typed binding with the same arity, and vice versa", () => {
  const exported = new Map<string, number>();
  for (const m of source.matchAll(re)) {
    exported.set(m[1]!, m[2]!.split(",").filter((p) => p.includes(":")).length);
  }
  expect([...exported.keys()].toSorted()).toEqual(Object.keys(RAG_SYMBOLS).toSorted());
  for (const [name, def] of Object.entries(RAG_SYMBOLS)) {
    expect(`${name}:${def.args.length}`).toBe(`${name}:${exported.get(name)}`);
  }
});
