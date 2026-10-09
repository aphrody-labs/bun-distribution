// SPDX-License-Identifier: Apache-2.0
// Static drift gate: Rust `#[no_mangle]` exports vs C declarations in the
// public headers. Needs no native library, so it always runs.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportCrateDirs, repo } from "./export-crates.ts";

// aphrody.h also declares the yolo_* runtime ABI, implemented by yolo-runtime and re-exported by the cdylib.
const EXPORT_CRATES = [...exportCrateDirs(), join(repo, "crates/engine/yolo-runtime/src")];
const HEADER_DIR = join(repo, "crates/interop/ffi/include");
// Exports intentionally absent from the C headers (internal runtime / FFI bindings).
const INTERNAL = new Set<string>([
  "web_internal_bridge_abi_version",
  "aphrody_py_call",
  "aphrody_py_eval",
  "aphrody_py_finalize",
  "aphrody_py_init",
  "aphrody_py_last_error",
  "aphrody_py_load",
  "aphrody_py_run",
  "aphrody_py_string_free",
  "aphrody_py_version",
  "aphrody_rag_abi_version",
  "aphrody_rag_call_json",
  "aphrody_rag_call_vec",
  "aphrody_rag_last_error",
  "aphrody_rag_manifest",
  "aphrody_rag_take",
]);

function rustFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (entry.endsWith(".rs")) out.push(path);
  }
  return out;
}

function rustNames(): Set<string> {
  const names = new Set<string>();
  const re =
    /#\[(?:unsafe\()?no_mangle\)?\]\s*(?:#\[[^\]]*\]\s*|\/\/\/[^\n]*\n\s*)*pub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+(\w+)/g;
  for (const crate of EXPORT_CRATES) {
    for (const file of rustFiles(crate)) {
      for (const m of readFileSync(file, "utf8").matchAll(re)) names.add(m[1]!);
    }
  }
  return names;
}

function headerNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(HEADER_DIR)) {
    if (!entry.endsWith(".h")) continue;
    const text = readFileSync(join(HEADER_DIR, entry), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/^[^\n#]*?\b(\w+)\s*\([^;{]*\)\s*;/gm)) names.add(m[1]!);
  }
  return names;
}

const rust = rustNames();
const header = headerNames();

test("header scanner finds the export surface", () => {
  expect(rust.size).toBeGreaterThan(100);
  expect(header.size).toBeGreaterThan(100);
});

test("every Rust export is declared in the C headers", () => {
  expect([...rust].filter((n) => !header.has(n) && !INTERNAL.has(n)).toSorted()).toEqual([]);
});

test("every C header declaration has a Rust export", () => {
  expect([...header].filter((n) => !rust.has(n)).toSorted()).toEqual([]);
});

test("aphrody.h is the single header of the yolo_* runtime ABI", () => {
  const yolo = [...rust].filter((n) => n.startsWith("yolo_") && n !== "yolo_tooling_abi_version");
  expect(yolo.length).toBeGreaterThan(20);
  expect(yolo.filter((n) => !header.has(n)).toSorted()).toEqual([]);
  expect(header.has("ffi_sum_squares")).toBe(true);
  expect(statSync(join(repo, "crates/engine/yolo-runtime/include/yolo_runtime.h"), { throwIfNoEntry: false })).toBeUndefined();
  const text = readFileSync(join(HEADER_DIR, "aphrody.h"), "utf8");
  expect(text).not.toContain("#include \"../");
  expect(text).toMatch(/#define APHRODY_HEADER_VERSION 2u/);
});
