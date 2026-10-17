// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { CString, dlopen, type FFIFunction } from "bun:ffi";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeNativeLibrary, loadNativeLibrary, nativeLibraryLoaded, resolveNativeLibraryPath } from "./src/library";
import { probeNativeTooling } from "@aphrody/bun-runtime-sdk/tooling";
import { findNewlinesUtf16, scanNodeProject } from "./src/n2b";
import { runAphrodyCaptured } from "./src/cli";
import { formatSource, lintSource, minifySource } from "./src/oxc";

const root = mkdtempSync(join(tmpdir(), "aphrody-native-consumer-"));
const script = join(root, "index.js");
// N2B reads the first n2b.json found walking up from the scanned root; pin it here so a stray one in %TEMP% is never used.
writeFileSync(join(root, "n2b.json"), "{}");
const original = "#!/usr/bin/env node\nconsole.log('hello');\n";
afterAll(() => {
  closeNativeLibrary();
  rmSync(root, { recursive: true, force: true });
});

test("typed tooling subpaths reject invalid inputs without loading product FFI", () => {
  closeNativeLibrary();
  expect(() => formatSource("x\0y")).toThrow(TypeError);
  expect(() => scanNodeProject("x\0y")).toThrow(TypeError);
  expect(() => scanNodeProject(root, { mode: "invalid" } as never)).toThrow(TypeError);
  expect(() => scanNodeProject(root, { dry_run: 3 } as never)).toThrow(TypeError);
  expect(() => scanNodeProject(root, { ignore: [3] } as never)).toThrow(TypeError);
  expect(() => scanNodeProject(root, { unknown: true } as never)).toThrow(TypeError);
  expect(nativeLibraryLoaded()).toBe(false);
});

let available = false;
try {
  loadNativeLibrary();
  available = true;
} catch (error) {
  if (process.env.APHRODY_FFI_REQUIRE_NATIVE === "1") throw error;
}
const native = test.skipIf(!available);
const toolingProbe = probeNativeTooling();
if (process.env.YOLO_TOOLING_LIB && !toolingProbe.available)
  throw new Error(toolingProbe.error ?? "Selected tooling provider is unavailable");
const tooling = test.skipIf(!toolingProbe.available);

// The legacy C contract is checked explicitly, separately from production SDK bindings.
function legacyTooling<S extends Record<string, FFIFunction>>(definitions: S) {
  loadNativeLibrary();
  const path = resolveNativeLibraryPath();
  if (!path) throw new Error("Legacy C ABI qualification requires an Aphrody FFI artifact");
  return dlopen(path, definitions);
}

native("command library preserves version output and parser errors without exiting the host", () => {
  const version = runAphrodyCaptured(["version", "--json"]);
  expect(version.code).toBe(0);
  expect(JSON.parse(version.stdout).version).toMatch(/^\d+\.\d+\.\d+/);
  const invalid = runAphrodyCaptured(["version", "--unknown-validation-flag"]);
  expect(invalid.code).toBe(2);
  expect(invalid.stderr).toContain("--unknown-validation-flag");
  expect(runAphrodyCaptured(["version", "--json"]).code).toBe(0);
});

tooling("N2B reports findings, respects ignores and previews then applies fixes", () => {
  writeFileSync(script, original);
  const report = scanNodeProject(root);
  expect(report.schema_version).toBe(2);
  expect(report.files.flatMap(file => file.findings).some(finding => finding.rule_id === "shebang/node")).toBe(true);
  expect(readFileSync(script, "utf8")).toBe(original);
  const preview = scanNodeProject(root, { mode: "fix", dry_run: true });
  expect(preview.files.some(file => file.changed)).toBe(true);
  expect(readFileSync(script, "utf8")).toBe(original);
  expect(scanNodeProject(root, { ignore: ["index.js"] }).findings_total).toBe(0);
  scanNodeProject(root, { mode: "fix", dry_run: false });
  expect(readFileSync(script, "utf8")).toContain("#!/usr/bin/env bun");
  expect(() => scanNodeProject(join(root, "missing"))).toThrow("not a directory");
});

tooling("UTF16 helper preserves astral, lone-surrogate and high-byte newline offsets", () => {
  const source = "😀\n\u0A00\u000A\uD800x\n";
  const expected = Array.from({ length: source.length }, (_, index) => index).filter(
    index => source.charCodeAt(index) === 10,
  );
  expect([...findNewlinesUtf16(source)]).toEqual(expected);
  expect([...findNewlinesUtf16("")]).toEqual([]);
});

tooling("Oxc uses the shared SDK owner independently of product FFI lifetime", () => {
  const source = "const greeting='hello';console.log(greeting)";
  expect(formatSource(source)).toContain('const greeting = "hello";');
  expect(minifySource(source)).toContain("console.log");
  expect(lintSource("const = ;").length).toBeGreaterThan(0);
  expect(() => minifySource("const = ;")).toThrow("Oxc minify:");
  closeNativeLibrary();
  expect(formatSource(source)).toContain("const greeting");
  expect(nativeLibraryLoaded()).toBe(false);
});

const referencePath = process.env.APHRODY_OXC_REFERENCE_LIB;
test.skipIf(!referencePath)("aggregate Oxc matches the original fork bridge byte for byte", () => {
  const definitions = {
    aphrody_oxc_abi_version: { args: [], returns: "u32" },
    aphrody_oxc_format: { args: ["cstring", "cstring"], returns: "ptr" },
    aphrody_oxc_minify: { args: ["cstring", "cstring"], returns: "ptr" },
    aphrody_oxc_lint: { args: ["cstring", "cstring"], returns: "ptr" },
    aphrody_oxc_free: { args: ["ptr"], returns: "void" },
  } as const;
  const reference = dlopen(referencePath!, definitions);
  const aggregate = legacyTooling(definitions);
  try {
    expect(reference.symbols.aphrody_oxc_abi_version()).toBe(aggregate.symbols.aphrody_oxc_abi_version());
    for (const [source, filename] of [
      ["const foo='hello';console.log(foo)", "fixture.js"],
      ["interface Person {name: string};const greet=(p:Person)=>p.name", "fixture.ts"],
      ["const component = <div title='a'>hello</div>", "fixture.jsx"],
      ["const = ;", "invalid.js"],
      ["let α = '😀'; console.log(α)", "unicode.js"],
    ]) {
      for (const operation of ["format", "minify", "lint"] as const) {
        const symbol = `aphrody_oxc_${operation}` as const;
        const input = Buffer.from(`${source}\0`);
        const path = Buffer.from(`${filename}\0`);
        const expected = reference.symbols[symbol](input, path);
        const actual = aggregate.symbols[symbol](input, path);
        try {
          expect(new CString(actual!).toString()).toBe(new CString(expected!).toString());
        } finally {
          reference.symbols.aphrody_oxc_free(expected);
          aggregate.symbols.aphrody_oxc_free(actual);
        }
      }
    }
  } finally {
    aggregate.close();
    reference.close();
  }
});

const n2bReferencePath = process.env.APHRODY_N2B_REFERENCE_LIB;
test.skipIf(!n2bReferencePath)("aggregate N2B matches the original Compat bridge's full reports and errors", () => {
  const definitions = {
    node2bun_abi_version: { args: [], returns: "u32" },
    node2bun_scan_json: { args: ["cstring"], returns: "ptr" },
    node2bun_scan_with_options_json: {
      args: ["cstring", "cstring"],
      returns: "ptr",
    },
    node2bun_string_free: { args: ["ptr"], returns: "void" },
  } as const;
  const reference = dlopen(n2bReferencePath!, definitions);
  const aggregate = legacyTooling(definitions);
  writeFileSync(script, original);
  const path = Buffer.from(`${root}\0`);
  try {
    expect(reference.symbols.node2bun_abi_version()).toBe(aggregate.symbols.node2bun_abi_version());
    for (const options of [
      { mode: "check" },
      { mode: "fix", dry_run: true },
      { mode: "aggressive", dry_run: true },
      { ignore: ["index.js"] },
      { unknown: true },
    ]) {
      const encoded = Buffer.from(`${JSON.stringify(options)}\0`);
      const expected = reference.symbols.node2bun_scan_with_options_json(path, encoded);
      const actual = aggregate.symbols.node2bun_scan_with_options_json(path, encoded);
      try {
        expect(JSON.parse(new CString(actual!).toString())).toEqual(JSON.parse(new CString(expected!).toString()));
      } finally {
        reference.symbols.node2bun_string_free(expected);
        aggregate.symbols.node2bun_string_free(actual);
      }
      expect(readFileSync(script, "utf8")).toBe(original);
    }
    const expected = reference.symbols.node2bun_scan_json(null);
    const actual = aggregate.symbols.node2bun_scan_json(null);
    try {
      expect(JSON.parse(new CString(actual!).toString())).toEqual(JSON.parse(new CString(expected!).toString()));
    } finally {
      reference.symbols.node2bun_string_free(expected);
      aggregate.symbols.node2bun_string_free(actual);
    }
  } finally {
    aggregate.close();
    reference.close();
  }
});
