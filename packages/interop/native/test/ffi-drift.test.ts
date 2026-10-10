// SPDX-License-Identifier: Apache-2.0
// Static drift gate: Rust `#[no_mangle]` exports vs the bun:ffi SYMBOLS table.
// Needs no native library, so it always runs.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { exportCrateDirs, repo } from "./export-crates.ts";

const EXPORT_CRATES = exportCrateDirs();

// These existing C ABI exports remain for compatibility. Their JS consumers
// now use the SDK's single tooling provider instead of the product FFI table.
const LEGACY_TOOLING_EXPORTS = new Set([
  "yolo_tooling_abi_version",
  "node2bun_abi_version",
  "node2bun_scan_json",
  "node2bun_scan_with_options_json",
  "node2bun_string_free",
  "find_newlines_u16",
  "aphrody_oxc_abi_version",
  "aphrody_oxc_format",
  "aphrody_oxc_minify",
  "aphrody_oxc_lint",
  "aphrody_oxc_analyze",
  "aphrody_oxc_parse",
  "aphrody_oxc_free",
]);

// The in-process inference ABI (cargo feature `inference`) has its own dlopen in src/inference.ts,
// not in the product table of this package.
const OWN_BINDING_EXPORTS = new Set([
  "aphrody_inference_abi_version",
  "aphrody_inference_submit",
  "aphrody_inference_poll",
  "aphrody_inference_cancel",
  "aphrody_inference_free",
  // RAG call surface: bound by @aphrody/rag-core (packages/ai/rag-core), which has its own drift test.
  "aphrody_rag_abi_version",
  "aphrody_rag_manifest",
  "aphrody_rag_call_json",
  "aphrody_rag_call_vec",
  "aphrody_rag_take",
  "aphrody_rag_last_error",
  // Web pipeline and command dispatch (bound in pipeline.ts / PIPELINE_SYMBOLS):
  "aphrody_command_submit",
  "aphrody_mcp_tool_submit",
  "aphrody_web_pipeline_abi_version",
  "aphrody_web_pipeline_pending_count",
  "aphrody_web_pipeline_submit",
  // Python runtime (bound by vu / aphrody-py):
  "aphrody_py_call",
  "aphrody_py_eval",
  "aphrody_py_finalize",
  "aphrody_py_init",
  "aphrody_py_last_error",
  "aphrody_py_load",
  "aphrody_py_run",
  "aphrody_py_string_free",
  "aphrody_py_version",
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

const FFI_TYPES: Record<string, string> = {
  cstring: "ptr",
  ptr: "ptr",
  u64_fast: "u64",
  i64_fast: "i64",
  usize: "usize",
};
const normalizeTs = (type: string) => FFI_TYPES[type] ?? type;

function normalizeRust(type: string): string {
  const t = type.trim();
  if (t === "") return "void";
  if (t.includes("*")) return "ptr";
  const map: Record<string, string> = { c_int: "i32", isize: "i64" };
  return map[t] ?? t;
}

interface RustExport {
  file: string;
  args: string[];
  returns: string;
}

const duplicateRustExports: string[] = [];

function rustExports(): Map<string, RustExport> {
  const found = new Map<string, RustExport>();
  const re =
    /#\[(?:unsafe\()?no_mangle\)?\]\s*(?:#\[[^\]]*\]\s*|\/\/\/[^\n]*\n\s*)*pub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/g;
  for (const crate of EXPORT_CRATES) {
    for (const file of rustFiles(crate)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(re)) {
        const params = m[2]!
          .split(/,\s*(?=\w+\s*:)/)
          .map((p) => p.trim().replace(/,$/, ""))
          .filter((p) => p.includes(":"))
          .map((p) => normalizeRust(p.slice(p.indexOf(":") + 1)));
        if (found.has(m[1]!)) duplicateRustExports.push(m[1]!);
        found.set(m[1]!, {
          file: relative(repo, file),
          args: params,
          returns: normalizeRust(m[3] ?? ""),
        });
      }
    }
  }
  return found;
}

function tsSymbols(): Map<string, { args: string[]; returns: string }> {
  const text = readFileSync(join(import.meta.dir, "..", "src", "library.ts"), "utf8");
  const body = text.slice(text.indexOf("const SYMBOLS = {"), text.indexOf("} as const;"));
  const out = new Map<string, { args: string[]; returns: string }>();
  const re = /^ {2}(\w+): \{\s*args: \[([\s\S]*?)\],\s*returns: ([^\n}]+?),?\s*\}/gm;
  for (const m of body.matchAll(re)) {
    const args = m[2]!
      .split(",")
      .map((a) =>
        a
          .trim()
          .replace(/^FFIType\./, "")
          .replace(/"/g, ""),
      )
      .filter(Boolean)
      .map(normalizeTs);
    if (out.has(m[1]!)) duplicateTsSymbols.push(m[1]!);
    out.set(m[1]!, {
      args,
      returns: normalizeTs(
        m[3]!
          .trim()
          .replace(/^FFIType\./, "")
          .replace(/"/g, ""),
      ),
    });
  }
  return out;
}

const duplicateTsSymbols: string[] = [];
const rust = rustExports();
const ts = tsSymbols();

test("scanners find the export surface", () => {
  expect(rust.size).toBeGreaterThan(100);
  expect(ts.size).toBeGreaterThan(80);
});

test("every product Rust export has a dlopen definition", () => {
  expect(
    [...rust.keys()]
      .filter(
        (name) =>
          !ts.has(name) && !LEGACY_TOOLING_EXPORTS.has(name) && !OWN_BINDING_EXPORTS.has(name),
      )
      .toSorted(),
  ).toEqual([]);
});

test("legacy tooling C exports are preserved without a second JS binding", () => {
  expect([...LEGACY_TOOLING_EXPORTS].filter((name) => !rust.has(name))).toEqual([]);
  expect([...LEGACY_TOOLING_EXPORTS].filter((name) => ts.has(name))).toEqual([]);
});

test("every dlopen definition has a Rust export", () => {
  expect([...ts.keys()].filter((name) => !rust.has(name)).toSorted()).toEqual([]);
});

test("Rust exports and dlopen definitions contain no duplicate symbols", () => {
  expect(duplicateRustExports.toSorted()).toEqual([]);
  expect(duplicateTsSymbols.toSorted()).toEqual([]);
});

test("arity, argument and return types agree", () => {
  const mismatches: string[] = [];
  for (const [name, r] of rust) {
    const t = ts.get(name);
    if (!t) continue;
    if (JSON.stringify(r.args) !== JSON.stringify(t.args) || r.returns !== t.returns) {
      mismatches.push(
        `${name}: rust (${r.args}) -> ${r.returns} @ ${r.file}; ts (${t.args}) -> ${t.returns}`,
      );
    }
  }
  expect(mismatches).toEqual([]);
});

test("no bun:aphrody fork dependence remains in the Bun sources", () => {
  const stale: string[] = [];
  const roots = ["packages/interop/native/src"].filter((root) => existsSync(join(repo, root)));
  const needle = ["bun", "aphrody"].join(":");
  for (const root of roots) {
    for (const entry of readdirSync(join(repo, root), { recursive: true })) {
      const rel = String(entry);
      if (!/\.(ts|tsx|js)$/.test(rel)) continue;
      if (readFileSync(join(repo, root, rel), "utf8").includes(needle))
        stale.push(`${root}/${rel}`);
    }
  }
  expect(stale).toEqual([]);
});
