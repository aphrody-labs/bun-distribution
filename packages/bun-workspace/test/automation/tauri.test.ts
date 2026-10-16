// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTauriLayout, runTauri } from "../../src/automation/tauri";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("Tauri check uses only the current app and serialized Cargo wrapper", async () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-tauri-owner-"));
  roots.push(root);
  const app = join(root, "crates/ui/app");
  const scripts = join(root, "scripts/build/rust");
  mkdirSync(app, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(app, "Cargo.toml"), '[package]\nname = "test-app"\n');
  const windows = process.platform === "win32";
  const wrapper = join(scripts, windows ? "cargo-serial.ts" : "cargo-serial.sh");
  if (windows)
    writeFileSync(
      wrapper,
      [
        `const root = ${JSON.stringify(root)};`,
        'await Bun.write(`${root}/invocation`, Bun.argv.slice(2).map((arg) => `${arg}\\n`).join(""));',
        'await Bun.write(`${root}/cargo-env`, process.env.CARGO ?? "");',
        'await Bun.write(`${root}/rustc-env`, process.env.RUSTC_WRAPPER ?? "");',
        "",
      ].join("\n"),
    );
  else {
    writeFileSync(
      wrapper,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/invocation"\nprintf '%s' "$CARGO" > "${root}/cargo-env"\nprintf '%s' "\${RUSTC_WRAPPER-}" > "${root}/rustc-env"\n`,
    );
    chmodSync(wrapper, 0o755);
  }
  const previous = Bun.env.RUSTC_WRAPPER;
  Bun.env.RUSTC_WRAPPER = "test-sccache-wrapper";
  try {
    const layout = resolveTauriLayout(root);
    expect(layout.uiDir).toBe(join(root, "m3/packages/app-ui"));
    expect(layout.appDir).toBe(app);
    expect(await runTauri(["check", "--root", root])).toBe(0);
    expect(readFileSync(join(root, "invocation"), "utf8")).toBe("check\n--locked\n");
    // Tauri's internal Cargo is routed through CARGO only where the wrapper is an executable.
    expect(readFileSync(join(root, "cargo-env"), "utf8")).toBe(windows ? (process.env.CARGO ?? "") : wrapper);
    expect(readFileSync(join(root, "rustc-env"), "utf8")).toBe("test-sccache-wrapper");
  } finally {
    if (previous === undefined) delete Bun.env.RUSTC_WRAPPER;
    else Bun.env.RUSTC_WRAPPER = previous;
  }
});

test("legacy app-only checkout is not a Tauri root", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-tauri-legacy-"));
  roots.push(root);
  mkdirSync(join(root, "crates/aphrody-app"), { recursive: true });
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");
  writeFileSync(join(root, "crates/aphrody-app/Cargo.toml"), '[package]\nname = "legacy"\n');
  expect(() => resolveTauriLayout(root)).toThrow("active Aphrody monorepo");
});
