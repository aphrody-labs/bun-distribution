#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../../docs/aphrody");
const checkpoint = "6f7b0805f9afb0c92dcb18c091960cdb373345dc";
const roots = [
  "apps/web",
  "crates/ui",
  "crates/tauri",
  "crates/web/site",
  "crates/aphrody-webos-wasm",
  "m3",
  "packages/web",
];
const begin = "<!-- BEGIN generated uirust inventory -->";
const end = "<!-- END generated uirust inventory -->";
const output = resolve(root, "docs/ui-rust-migration.md");

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function sourceFiles(list: string): string[] {
  return [
    ...new Set(
      list
        .split("\0")
        .filter(
          path =>
            /\.(?:ts|tsx|js|jsx|html|css)$/.test(path) &&
            !/(?:^|\/)(?:node_modules|\.cache|target|\.coord)\//.test(path),
        ),
    ),
  ].toSorted();
}

function classify(path: string): {
  surface: string;
  role: string;
  target: string;
  status: string;
} {
  const role = /(?:^|\/)(?:test|tests|fixtures|test-dom)(?:\/)|\.(?:test|spec)\./.test(path)
    ? "test / fixture"
    : /(?:server|site)\.ts$/.test(path)
      ? "HTTP server / launcher"
      : /(?:build|config|scripts)(?:\/|\.)/.test(path)
        ? "build / tooling"
        : path.endsWith(".css")
          ? "styles / tokens"
          : path.endsWith(".html")
            ? "HTML document"
            : path.endsWith(".tsx") || path.endsWith(".jsx")
              ? "component / view"
              : path.endsWith(".d.ts")
                ? "type contract"
                : "module / behavior";
  if (path.startsWith("apps/web/"))
    return {
      surface: "retired app",
      role,
      target: "crates/web/site + canonical m3/packages/app-ui; WebOS fork owner",
      status: "removed unused legacy source; NOT Rust frontend parity",
    };
  if (path.includes("/ui-dist/"))
    return {
      surface: "desktop artifact",
      role,
      target: "crates/ui/app + crates/ui/m3 + crates/aphrody-webos-wasm",
      status: "generated active TS frontend artifact; Rust migration pending",
    };
  if (path.startsWith("m3/packages/app-ui/"))
    return {
      surface: path.includes("/showcase/") ? "M3 showcase" : "canonical app",
      role,
      target:
        role === "HTTP server / launcher"
          ? "crates/web/site (HTTP implemented); native CLI entry pending"
          : "crates/ui/m3 + crates/ui/app + crates/aphrody-webos-wasm",
      status: "active TS frontend / tooling; Rust frontend parity pending",
    };
  if (path.startsWith("m3/"))
    return {
      surface: "M3 framework / example / template",
      role,
      target: "crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet}",
      status: "TS source; Rust component parity pending",
    };
  if (path.startsWith("packages/web/"))
    return {
      surface: "web capability",
      role,
      target: "crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner",
      status: "TS capability / tests; file-level Rust parity pending",
    };
  if (path.startsWith("crates/web/"))
    return {
      surface: "native site / WASM",
      role,
      target: "crates/web/site + crates/aphrody-webos-wasm",
      status: "JS/HTML/CSS asset or bridge; native HTTP present, frontend parity pending",
    };
  return {
    surface: "desktop / Tauri / renderer",
    role,
    target: "crates/ui/app + crates/ui/m3 + existing crates/tauri owner",
    status: "JS/TS/HTML/CSS bridge or asset; Rust-only parity pending",
  };
}

const current = sourceFiles(
  git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...roots),
).filter(path => existsSync(resolve(root, path)));
const retired = sourceFiles(git(root, "ls-tree", "-r", "--name-only", "-z", checkpoint, "--", "apps/web")).filter(
  path => !existsSync(resolve(root, path)),
);
const deletedTotal = git(root, "ls-tree", "-r", "--name-only", checkpoint, "--", "apps/web")
  .split("\n")
  .filter(Boolean).length;
const fork = process.env.APHRODY_BUN_CHECKOUT;
if (!fork) throw new Error("Set APHRODY_BUN_CHECKOUT to inspect the actual Bun Rust owners.");
const originMain = git(fork, "rev-parse", "origin/main");
const forkHead = git(fork, "rev-parse", "HEAD");
const workspace = readFileSync(resolve(fork, "Cargo.toml"), "utf8");
const crates = [
  "bun_core",
  "bun_sys",
  "bun_paths",
  "bun_collections",
  "bun_alloc",
  "bun_threading",
  "bun_css",
  "bun_parsers",
  "bun_js_parser",
  "bun_js_printer",
  "bun_bundler",
  "bun_http",
  "bun_sourcemap",
  "bun_semver",
];
const crateRows = crates.map(name => {
  const match = workspace.match(new RegExp(`^${name}\\s*=\\s*\\{[^\\n]*path\\s*=\\s*"([^"]+)"`, "m"));
  if (!match) throw new Error(`Missing Bun workspace owner: ${name}`);
  const manifest = readFileSync(resolve(fork, match[1]!, "Cargo.toml"), "utf8");
  const actualName = manifest.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (actualName !== name) throw new Error(`Bun crate identity mismatch: ${name} != ${actualName}`);
  return `| ${name} | ${match[1]}/Cargo.toml | verified manifest; downstream integration pending |`;
});
const textCell = (value: string) => value.replaceAll("|", "\\|");
const rows = [...current, ...retired].toSorted().map(path => {
  const record = classify(path);
  return `| ${path} | ${record.surface} | ${record.role} | ${textCell(record.target)} | ${record.status} |`;
});
const section = `${begin}\n## Generated file inventory\n\nRegenerate: \`bun scripts/audit/ui/rust-migration.ts\`; validate reproducibility: append \`--check\`. Git-tracked and unignored new source files are enumerated under ${roots.map(path => `\`${path}\``).join(", ")}; caches and node_modules are excluded. Generated tracked ui-dist files remain explicit artifact rows.\n\nCurrent files: **${current.length}**. Retired TS/TSX/JS/HTML/CSS files: **${retired.length}**, from **${deletedTotal}** checkpointed apps/web files at \`${checkpoint}\`. Retired files had no active consumer in the native site launcher or canonical build. Their deletion does not establish Rust frontend parity.\n\nActive app-ui, M3 showcase and Bun WebOS remain TypeScript. Native Rust owns the site HTTP routes and catalogs; the canonical app consumer/build and native public routes are qualified. Rust-only component, rendering and desktop parity remains open. \`crates/ui/m3\` ${existsSync(resolve(root, "crates/ui/m3/Cargo.toml")) ? "exists; consult its separate owner's gates" : "is absent; reserved to lot uirust-m3"}. No competing framework is created.\n\n## Actual Bun Rust owners\n\nConfigured fork HEAD: \`${forkHead}\`. Locally verified origin/main ref: \`${originMain}\` (tracking-ref observation, not a remote fetch or a new dependency integration). Use this exact rev only after downstream qualification; no Git dependency was added by this inventory.\n\nFork toolchain is nightly-2026-09-15 and edition 2024. Direct consumption must qualify the allocator API and generic experimental/nightly feature gates. CSS, HTTP and bundler/JSC boundaries require their own build/link checks against the native Bun engine; manifest existence does not qualify standalone reuse. No native engine build runs in this inventory.\n\n| Crate | Actual owner manifest | State |\n| --- | --- | --- |\n${crateRows.join("\n")}\n\n## Per-file state\n\n| File | Surface | Role | Target Rust owner | State |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n${end}`;
const previous = existsSync(output) ? readFileSync(output, "utf8") : "# Aphrody UI Rust migration\n\n";
const beginAt = previous.indexOf(begin);
const endAt = previous.indexOf(end);
if (beginAt < 0 !== endAt < 0) throw new Error("Incomplete inventory marker; preserve existing agent sections.");
const next =
  beginAt < 0
    ? `${previous.trimEnd()}\n\n${section}\n`
    : `${previous.slice(0, beginAt)}${section}${previous.slice(endAt + end.length)}`;
if (process.argv.includes("--check")) {
  if (next !== previous) throw new Error("UI Rust inventory differs; regenerate it.");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, next);
}
console.log(
  `UI Rust inventory: ${current.length} current + ${retired.length} retired files; ${crates.length} verified Bun crate names; ${output}`,
);
