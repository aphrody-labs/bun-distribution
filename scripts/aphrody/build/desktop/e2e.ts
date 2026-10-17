#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//! Real-webview e2e of the desktop app: assembles the frontend (WASM package and transpiled
//! transports), builds and runs the aphrody-app example `shell_e2e` (real CEF webview,
//! permission-checked IPC through the aphrody-shell-tauri plugin) and checks its report.
//! Linux only: CEF runs on X11 (XWayland under Wayland), so Xvfb is enough on a headless host.
//!
//!   bun run desktop:e2e
import { $ } from "bun";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../docs/aphrody");
const fe = join(root, "crates/ui/app/examples/shell_e2e/frontend");
const pkg = join(root, "packages/shell/web/pkg");

if (process.platform !== "linux") {
  console.error("desktop:e2e: Linux only (CEF under X11 or Xvfb)");
  process.exit(2);
}

await $`${join(root, "scripts/build/shell/build-wasm.sh")}`.quiet();
rmSync(join(fe, "pkg"), { recursive: true, force: true });
mkdirSync(join(fe, "pkg"), { recursive: true });
for (const file of ["aphrody_shell_web.js", "aphrody_shell_web_bg.wasm"])
  await Bun.write(join(fe, "pkg", file), Bun.file(join(pkg, file)));
await $`bun build ${join(root, "packages/shell/web/src/index.ts")} --outfile ${join(fe, "index.js")}`.quiet();
await $`${join(root, "scripts/build/rust/cargo-serial.sh")} build -p aphrody-app --example shell_e2e --features custom-protocol`;

let xvfb: Bun.Subprocess | undefined;
if (!Bun.env.DISPLAY) {
  const display = Bun.env.APHRODY_E2E_DISPLAY ?? ":97";
  xvfb = Bun.spawn(["Xvfb", display, "-screen", "0", "1280x800x24"], {
    windowsHide: true,
    stdout: "ignore",
    stderr: "ignore",
  });
  await Bun.sleep(1000);
  process.env.DISPLAY = display;
}

try {
  // Containers and CI images usually offer neither the setuid chrome-sandbox nor user namespaces.
  const env = {
    ...process.env,
    APHRODY_SHELL_E2E_FRONTEND: fe,
    APHRODY_CEF_UNSAFE_NO_SANDBOX: Bun.env.APHRODY_CEF_UNSAFE_NO_SANDBOX ?? "1",
  };
  const run = Bun.spawn([join(root, "target/debug/examples/shell_e2e")], {
    windowsHide: true,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  const out = (await new Response(run.stdout).text()) + (await new Response(run.stderr).text());
  await run.exited;
  const result = out.split("\n").filter(line => line.includes("E2E_RESULT"));
  if (result.length === 0) {
    console.error(out.split("\n").slice(-20).join("\n"));
    process.exit(1);
  }
  console.log(result.join("\n"));
  const ok = /LOCAL\[.*tauri-wasm/.test(out) && /REMOTE\[.*pty-42/.test(out);
  process.exitCode = ok ? 0 : 1;
} finally {
  xvfb?.kill();
}
