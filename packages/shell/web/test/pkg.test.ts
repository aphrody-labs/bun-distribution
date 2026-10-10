// SPDX-License-Identifier: Apache-2.0
// The package must ship its wasm: the built pkg is reachable through the package exports, loads, and is
// part of the tarball (dry-run pack, nothing published). Requires `bun run build:wasm`.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(import.meta.dir, "..");
const built = existsSync(join(root, "pkg/aphrody_shell_web_bg.wasm"));

test("the build is present (bun run build:wasm)", () => {
  expect(built).toBe(true);
});

test.skipIf(!built)(
  "exports resolve to the wasm and its glue, and the module instantiates",
  async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@aphrody/shell-web/wasm"));
    const gluePath = import.meta.resolve("@aphrody/shell-web/wasm-glue");
    expect(dirname(wasmPath)).toBe(join(root, "pkg"));
    const bytes = readFileSync(wasmPath);
    expect(WebAssembly.validate(bytes)).toBe(true);
    const glue = (await import(gluePath)) as {
      default(o: { module_or_path: BufferSource }): Promise<unknown>;
      WebTerminal: new (c: number, r: number) => { ingest(b: Uint8Array): void; lines(): string[] };
    };
    await glue.default({ module_or_path: bytes });
    const term = new glue.WebTerminal(20, 3);
    term.ingest(new TextEncoder().encode("loaded"));
    expect(term.lines()[0]).toContain("loaded");
  },
);

test.skipIf(!built)("the tarball contains the wasm, the glue, the typings and the sources", () => {
  const packed = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {
    windowsHide: true,
    cwd: root,
  });
  const listing = packed.stdout.toString() + packed.stderr.toString();
  for (const file of [
    "pkg/aphrody_shell_web_bg.wasm",
    "pkg/aphrody_shell_web.js",
    "pkg/aphrody_shell_web.d.ts",
    "src/index.ts",
  ]) {
    expect(listing).toContain(file);
  }
});
