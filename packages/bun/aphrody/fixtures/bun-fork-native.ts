// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeNativeLibrary, loadNativeLibrary, nativeLibraryLoaded } from "../src/library";
import { scanNodeProject } from "@aphrody/bun/n2b";
import * as oxc from "@aphrody/bun/oxc";

interface NativeBuiltin {
  version(): string;
  runCaptured(args: string[]): { code: number; stdout: string; stderr: string };
  scanNodeProject: typeof scanNodeProject;
  formatSource: typeof oxc.formatSource;
  minifySource: typeof oxc.minifySource;
  lintSource: typeof oxc.lintSource;
}
const moduleName: string = "bun:aphrody";
const builtin = (await import(moduleName)) as NativeBuiltin;
const key = Symbol.for("aphrody.ffi.library.v1");
const state = globalThis as typeof globalThis & {
  [key]?: { owner: string; library: unknown; path: string };
};
const root = mkdtempSync(join(tmpdir(), "aphrody-fork-native-"));
try {
  assert.equal(nativeLibraryLoaded(), false);
  const order = process.argv[2];
  if (order === "builtin-first") {
    builtin.version();
    const first = state[key]!;
    assert.equal(first.owner, "bun:aphrody");
    const expanded = loadNativeLibrary();
    assert.notEqual(first.library, expanded);
    assert.equal(state[key]!.owner, "@aphrody/bun");
  } else {
    const first = loadNativeLibrary();
    builtin.version();
    assert.equal(state[key]!.library, first);
  }
  const handle = loadNativeLibrary();
  assert.equal(state[key]!.library, handle);
  const script = join(root, "index.js");
  const input =
    '#!/usr/bin/env node\nconst fs = require("fs"); console.log(fs.readFileSync("x", "utf8"));\n';
  writeFileSync(script, input);
  const report = builtin.scanNodeProject(root, { mode: "check", dry_run: true });
  assert.deepEqual(report, scanNodeProject(root, { mode: "check", dry_run: true }));
  assert.equal(report.schema_version, 2);
  assert.ok(report.findings_total >= 1);
  assert.equal(readFileSync(script, "utf8"), input);
  const source = "const x=1;";
  assert.equal(builtin.formatSource(source), oxc.formatSource(source));
  assert.equal(builtin.minifySource(source), oxc.minifySource(source));
  assert.deepEqual(builtin.lintSource(source), oxc.lintSource(source));
  const captured = builtin.runCaptured(["--version"]);
  assert.equal(captured.code, 0);
  assert.equal(captured.stderr, "");
  assert.ok(captured.stdout.includes(builtin.version()));
  const configured = process.env.APHRODY_FFI_LIB;
  try {
    process.env.APHRODY_FFI_LIB = join(root, "different-library");
    assert.throws(() => builtin.version(), /already loaded from/);
    assert.throws(() => loadNativeLibrary(), /already loaded from/);
  } finally {
    if (configured === undefined) delete process.env.APHRODY_FFI_LIB;
    else process.env.APHRODY_FFI_LIB = configured;
  }
  const version = builtin.version();
  closeNativeLibrary();
  assert.equal(nativeLibraryLoaded(), false);
  assert.equal(builtin.version(), version);
  assert.notEqual(state[key]!.library, handle);
  loadNativeLibrary();
  assert.equal(state[key]!.owner, "@aphrody/bun");
  console.log(
    JSON.stringify({
      order,
      version,
      schema: report.schema_version,
      findings: report.findings_total,
      parity: true,
      reload: true,
    }),
  );
} finally {
  closeNativeLibrary();
  rmSync(root, { recursive: true, force: true });
}
