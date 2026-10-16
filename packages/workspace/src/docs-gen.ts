// SPDX-License-Identifier: Apache-2.0
/**
 * One entry point for every generated document, so hand-written docs never carry counts.
 *
 *   yolo ops docs-gen [--root <repo>] [--check] [--deps] [--skip-ecosystem]
 *
 * Writes (or, with --check, compares against the committed copy):
 *   docs/reference/workspace/STATE.md  crates, packages and apps per domain from `cargo metadata`,
 *                                      the Bun workspaces and the git log
 *   docs/README.md                     generated documentation index
 *   docs/reference/ai/llms.txt         llms.txt index of the canonical docs
 *   docs/ecosystem/*                   delegated to scripts/tools/workspace/ecosystem.ts
 *   docs/reference/infra/UPSTREAMS.md  delegated to `yolo update upstream docs`
 *   docs/reference/workspace/DEPS-INVENTORY.md  only with --deps (network, registry-dependent, never checked)
 *
 * `cargo metadata --no-deps` is read-only: it never builds.
 */
import { loadRootDocs, renderMemory, renderPlan, renderReadme } from "./root-docs.ts";
import { spawnSync } from "@aphrody/update/process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type CargoTarget = { name: string; kind: string[]; src_path: string };
type CargoPackage = {
  name: string;
  version: string;
  manifest_path: string;
  targets: CargoTarget[];
};
type CargoMetadata = { packages: CargoPackage[]; workspace_root: string };

export type Unit = {
  ecosystem: "rust" | "bun";
  name: string;
  path: string;
  domain: string;
  role: "crate" | "package" | "app";
  version: string;
  kinds: string[];
  tests: boolean;
  todos: number;
  lastCommit: string;
};

const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", ".turbo", ".next", "build"]);
const posix = (path: string): string => path.replaceAll("\\", "/");

function run(cmd: string, args: string[], cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function walkFiles(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, accept, out);
    } else if (entry.isFile() && accept(entry.name)) out.push(full);
  }
  return out;
}

/** Domain of a first-party path: `crates/<domain>/..`, `packages/<domain>/..`, `apps/<domain>/..`. */
export function domainOf(path: string): string {
  const parts = posix(path).split("/");
  if (parts[0] === "apps" && parts.length === 2) return parts[1] ?? "apps";
  return parts[1] ?? parts[0] ?? "root";
}

/** Last commit date (YYYY-MM-DD) per path, from a single `git log` pass over HEAD. */
function lastCommitDates(root: string, paths: string[]): Map<string, string> {
  const pending = new Set(paths);
  const found = new Map<string, string>();
  const log = spawnSync(
    "git",
    ["log", "--format=@%cs", "--name-only", "--no-renames", "--", ...paths],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 },
  ).stdout;
  let date = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) {
      date = line.slice(1);
      continue;
    }
    if (!line || pending.size === 0) continue;
    const parts = line.split("/");
    for (let depth = parts.length; depth > 0; depth--) {
      const prefix = parts.slice(0, depth).join("/");
      if (pending.has(prefix)) {
        found.set(prefix, date);
        pending.delete(prefix);
      }
    }
  }
  return found;
}

function rustFacts(dir: string): { tests: boolean; todos: number } {
  let tests = existsSync(join(dir, "tests"));
  let todos = 0;
  for (const file of walkFiles(dir, (name) => name.endsWith(".rs"))) {
    const text = readFileSync(file, "utf8");
    todos += (text.match(/\b(?:todo|unimplemented)!\s*\(/g) ?? []).length;
    if (!tests && /#\[(?:[\w:]+::)?test\b/.test(text)) tests = true;
  }
  return { tests, todos };
}

function bunFacts(dir: string, manifest: Record<string, unknown>): { tests: boolean } {
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  if (typeof scripts.test === "string" && !/no test|exit 0/.test(scripts.test))
    return { tests: true };
  const found = walkFiles(dir, (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name));
  return { tests: found.length > 0 };
}

function cargoMetadata(root: string): CargoMetadata {
  return JSON.parse(
    run("cargo", ["metadata", "--format-version", "1", "--no-deps", "--locked"], root),
  ) as CargoMetadata;
}

function workspaceExcludes(root: string): string[] {
  const text = readFileSync(join(root, "Cargo.toml"), "utf8");
  const block = /\[workspace\][\s\S]*?\bexclude\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "").filter(Boolean);
}

function bunWorkspaceDirs(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    for (const hit of new Bun.Glob(`${pattern}/package.json`).scanSync({
      cwd: root,
      onlyFiles: true,
    })) {
      const dir = posix(dirname(hit));
      if (!dir.split("/").some((part) => SKIP_DIRS.has(part))) dirs.add(dir);
    }
  }
  return [...dirs].toSorted();
}

export function collectUnits(root: string): {
  units: Unit[];
  excludes: string[];
  outside: string[];
} {
  const meta = cargoMetadata(root);
  const units: Unit[] = [];
  for (const pkg of meta.packages) {
    const dir = dirname(pkg.manifest_path);
    const path = posix(relative(root, dir));
    const kinds = [
      ...new Set(
        pkg.targets
          .flatMap((t) => t.kind)
          .filter((k) => !["test", "bench", "example", "custom-build"].includes(k)),
      ),
    ].toSorted();
    const facts = rustFacts(dir);
    units.push({
      ecosystem: "rust",
      name: pkg.name,
      path,
      domain: domainOf(path),
      role: path.startsWith("apps/") ? "app" : "crate",
      version: pkg.version,
      kinds,
      tests: facts.tests || pkg.targets.some((t) => t.kind.includes("test")),
      todos: facts.todos,
      lastCommit: "",
    });
  }
  for (const path of bunWorkspaceDirs(root)) {
    const manifest = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const bin = manifest.bin;
    const kinds = [
      bin ? "bin" : "",
      manifest.exports || manifest.main || manifest.module ? "lib" : "",
    ].filter(Boolean);
    units.push({
      ecosystem: "bun",
      name: String(manifest.name ?? path),
      path,
      domain: domainOf(path),
      role: path.startsWith("apps/") ? "app" : "package",
      version: String(manifest.version ?? "-"),
      kinds: kinds.length ? kinds : ["private"],
      tests: bunFacts(join(root, path), manifest).tests,
      todos: 0,
      lastCommit: "",
    });
  }
  const dates = lastCommitDates(
    root,
    units.map((u) => u.path),
  );
  for (const unit of units) unit.lastCommit = dates.get(unit.path) ?? "uncommitted";
  units.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));

  // Cargo manifests that are not members of the root workspace (excluded or nested workspaces).
  const members = new Set(units.filter((u) => u.ecosystem === "rust").map((u) => u.path));
  const tracked = run("git", ["ls-files", "--", "*Cargo.toml"], root)
    .split("\n")
    .filter((f) => f && !f.startsWith("docs/") && existsSync(join(root, f)))
    .map((f) => posix(dirname(f)))
    .filter((d) => d !== "." && !members.has(d));
  return { units, excludes: workspaceExcludes(root), outside: tracked.toSorted() };
}

const cell = (s: string): string => s.replaceAll("|", "\\|");

export function renderState(units: Unit[], excludes: string[], outside: string[]): string {
  const domains = [...new Set(units.map((u) => u.domain))].toSorted();
  const count = (d: string, role: Unit["role"]) =>
    units.filter((u) => u.domain === d && u.role === role).length;
  const total = (role: Unit["role"]) => units.filter((u) => u.role === role).length;
  const out: string[] = [
    "<!-- SPDX-License-Identifier: Apache-2.0 -->",
    "<!-- @generated by `bun run docs:gen` (packages/infra/workspace/src/docs-gen.ts). Do not edit; `bun run docs:check` fails when stale. -->",
    "# Workspace state",
    "",
    "Facts read from `cargo metadata --no-deps`, the root `package.json` Bun workspaces and the git log.",
    "Crates are Rust workspace members outside `apps/`; packages are Bun workspaces outside `apps/`;",
    "apps are Rust or Bun members under `apps/`. `todo!` counts `todo!(` and `unimplemented!(` in `.rs` files.",
    "",
    `Totals: **${total("crate")} crates**, **${total("package")} packages**, **${total("app")} apps** (${units.filter((u) => u.ecosystem === "rust").length} Rust, ${units.filter((u) => u.ecosystem === "bun").length} Bun).`,
    "",
    "## Per domain",
    "",
    "| Domain | Crates | Packages | Apps | `todo!` |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...domains.map(
      (d) =>
        `| [${d}](#${d}) | ${count(d, "crate")} | ${count(d, "package")} | ${count(d, "app")} | ${units.filter((u) => u.domain === d).reduce((n, u) => n + u.todos, 0)} |`,
    ),
    "",
    "## Workspace exclusions",
    "",
    "Root `Cargo.toml` `[workspace] exclude`:",
    "",
    ...(excludes.length ? excludes.map((e) => `- \`${e}\``) : ["- none"]),
    "",
    "Tracked Cargo manifests outside the root workspace (excluded, nested workspaces or fixtures):",
    "",
    ...(outside.length ? outside.map((e) => `- \`${e}\``) : ["- none"]),
    "",
  ];
  for (const d of domains) {
    out.push(
      `## ${d}`,
      "",
      "| Name | Path | Kind | Version | Targets | Tests | `todo!` | Last commit |",
      "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    );
    for (const u of units.filter((x) => x.domain === d)) {
      out.push(
        `| \`${cell(u.name)}\` | [${u.path}](../../../${u.path}) | ${u.ecosystem} ${u.role} | ${cell(u.version)} | ${u.kinds.join(", ")} | ${u.tests ? "yes" : "no"} | ${u.todos} | ${u.lastCommit} |`,
      );
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const CATEGORIES = [
  "architecture",
  "apis",
  "decisions",
  "guides",
  "operations",
  "plans",
  "products",
  "reference",
  "research",
];

function titleOf(file: string): string {
  try {
    const head = readFileSync(file, "utf8").slice(0, 4000);
    return /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

function docsFiles(root: string): string[] {
  return run("git", ["ls-files", "-z", "--", "docs"], root)
    .split("\0")
    .filter((f) => f && existsSync(join(root, f)) && statSync(join(root, f)).isFile());
}

export function renderDocsIndex(root: string): string {
  const files = docsFiles(root).filter((f) => f !== "docs/README.md");
  const byTop = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    const top = parts.length > 2 ? (parts[1] ?? "") : "(root)";
    byTop.set(top, [...(byTop.get(top) ?? []), f]);
  }
  const out = [
    "<!-- SPDX-License-Identifier: Apache-2.0 -->",
    "<!-- @generated by `bun run docs:gen`. Do not edit; `bun run docs:check` fails when stale. -->",
    "# Documentation index",
    "",
    "Canonical documentation lives under `docs/<category>/<domain>` (rules: [CLAUDE.md](../CLAUDE.md)).",
    "Counts and inventories are never hand-written; read the generated files:",
    "",
    "| Generated | Content |",
    "| --- | --- |",
    "| [STATE.md](reference/workspace/STATE.md) | crates, packages, apps per domain; versions, targets, tests, `todo!`, last commit |",
    "| [ecosystem/ECOSYSTEM.md](ecosystem/ECOSYSTEM.md) | crates, binaries, features, Bun and uv packages |",
    "| [ecosystem/CLI.md](ecosystem/CLI.md) | exact CLI command trees |",
    "| [ecosystem/MCP-TOOLS.md](ecosystem/MCP-TOOLS.md) | every registered MCP tool |",
    "| [UPSTREAMS.md](reference/infra/UPSTREAMS.md) | upstream catalogue (read live, never vendored) |",
    "| [DEPS-INVENTORY.md](reference/workspace/DEPS-INVENTORY.md) | dependency freshness and advisories (`bun run docs:gen -- --deps`) |",
    "| [HISTORY.md](operations/workspace/HISTORY.md) | dated reports archived to git history |",
    "",
    "Regenerate with `bun run docs:gen`; `bun run docs:check` gates drift; the `aphrody-docs.timer` user unit refreshes daily.",
    "",
    "## Categories",
    "",
    "| Category | Domain | Files | Entry |",
    "| --- | --- | ---: | --- |",
  ];
  const tops = [...byTop.keys()].toSorted((a, b) => {
    const ia = CATEGORIES.indexOf(a);
    const ib = CATEGORIES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const top of tops) {
    const list = byTop.get(top) ?? [];
    const domains = new Map<string, string[]>();
    for (const f of list) {
      const parts = f.split("/");
      const domain = parts.length > 3 ? (parts[2] ?? "") : "(files)";
      domains.set(domain, [...(domains.get(domain) ?? []), f]);
    }
    for (const [domain, dl] of [...domains].toSorted((a, b) => a[0].localeCompare(b[0]))) {
      const dir = top === "(root)" ? "." : domain === "(files)" ? top : `${top}/${domain}`;
      const entry = ["README.md", "INDEX.md", "PLAN.md"]
        .map((n) => `docs/${dir}/${n}`)
        .find((p) => dl.includes(p));
      const label = CATEGORIES.includes(top) ? top : `${top} (outside the category layout)`;
      const vendored = domain.startsWith("upstream-") ? " vendored upstream copy" : "";
      out.push(
        `| ${label} | [${domain}](${dir}/)${vendored} | ${dl.length} | ${entry ? `[${titleOf(join(root, entry)) || entry.split("/").pop()}](${posix(relative("docs", entry))})` : "-"} |`,
      );
    }
  }
  out.push("", `Total: ${files.length + 1} files.`);
  return `${out.join("\n")}\n`;
}

export function renderLlms(root: string): string {
  const files = docsFiles(root).filter(
    (f) =>
      /\/(README|PLAN|INDEX)\.md$/.test(f) && !f.includes("/upstream-") && f.split("/").length <= 4,
  );
  const lines = [
    "# Aphrody",
    "",
    "> Rust + Bun monorepo: Rust crates under crates/<domain>, Bun packages under packages/<domain>, canonical UI under m3/packages/app-ui. Development and builds follow the current context. Generated by `bun run docs:gen`; do not edit.",
    "",
    "## Start here",
    "",
    "- [Rules](../../../CLAUDE.md): repository rules, ownership, build policy",
    "- [Plan](../../../PLAN.md): active migration plan",
    "- [Documentation index](../../README.md): categories and domains",
    "- [Workspace state](../workspace/STATE.md): generated crate, package and app inventory",
    "- [Ecosystem catalog](../../ecosystem/ECOSYSTEM.md): crates, binaries, features, packages",
    "- [CLI trees](../../ecosystem/CLI.md): exact command trees",
    "- [MCP tools](../../ecosystem/MCP-TOOLS.md): every MCP tool",
    "- [Upstreams](../infra/UPSTREAMS.md): upstream catalogue, read live",
    "",
    "## Docs",
    "",
    ...files
      .toSorted()
      .map((f) => `- [${titleOf(join(root, f)) || f}](${relative("docs/reference/ai", f)})`),
    "",
  ];
  return lines.join("\n");
}

function delegate(root: string, label: string, cmd: string[]): number {
  const result = spawnSync(cmd[0] ?? "bun", cmd.slice(1), { cwd: root, stdio: "inherit" });
  const code = result.status ?? 1;
  console.log(`${label}: exit ${code}`);
  return code;
}

export async function runDocsGen(args: string[]): Promise<number> {
  let root = process.cwd();
  let check = false;
  let deps = false;
  let ecosystem = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--check") check = true;
    else if (arg === "--deps") deps = true;
    else if (arg === "--skip-ecosystem") ecosystem = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops docs-gen [--root <repository>] [--check] [--deps] [--skip-ecosystem]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  root = resolve(root);
  const { units, excludes, outside } = collectUnits(root);
  const outputs: Record<string, string> = {
    "docs/reference/workspace/STATE.md": renderState(units, excludes, outside),
    "docs/reference/ai/llms.txt": renderLlms(root),
  };
  const rootDocs = loadRootDocs(root);
  const totals = `Totals: ${units.filter((u) => u.role === "crate").length} crates, ${units.filter((u) => u.role === "package").length} packages, ${units.filter((u) => u.role === "app").length} apps.`;
  outputs["README.md"] = renderReadme(rootDocs, totals);
  outputs["PLAN.md"] = renderPlan(rootDocs);
  outputs["MEMORY.md"] = renderMemory(rootDocs);
  // The index counts files, so it is rendered after the other outputs exist.
  let failures = 0;
  const apply = (path: string, text: string): void => {
    const file = join(root, path);
    const current = existsSync(file)
      ? readFileSync(file, "utf8").replace(/\r\n/g, "\n")
      : undefined;
    if (current === text) {
      console.log(`current ${path}`);
      return;
    }
    if (check) {
      console.error(`stale   ${path} (run: bun run docs:gen)`);
      failures++;
      return;
    }
    writeFileSync(file, text);
    console.log(`wrote   ${path}`);
  };
  for (const [path, text] of Object.entries(outputs)) apply(path, text);
  apply("docs/README.md", renderDocsIndex(root));

  const bun = process.execPath;
  const upstreamArgs = [
    "packages/engine/yolo/src/index.ts",
    "update",
    "upstream",
    "docs",
    "--root",
    root,
  ];
  if (delegate(root, "UPSTREAMS.md", [bun, ...upstreamArgs, ...(check ? [] : ["--apply"])]) !== 0)
    failures++;
  if (ecosystem) {
    const ecoArgs = ["scripts/tools/workspace/ecosystem.ts", ...(check ? ["--check"] : [])];
    if (delegate(root, "docs/ecosystem", [bun, ...ecoArgs]) !== 0) failures++;
  }
  if (deps && !check) {
    if (
      delegate(root, "DEPS-INVENTORY.md", [
        bun,
        "packages/engine/yolo/src/index.ts",
        "update",
        "deps",
        "inventory",
        "--root",
        root,
      ]) !== 0
    )
      failures++;
  }
  const crates = units.filter((u) => u.role === "crate").length;
  const packages = units.filter((u) => u.role === "package").length;
  const apps = units.filter((u) => u.role === "app").length;
  console.log(
    `docs-gen: ${crates} crates, ${packages} packages, ${apps} apps; ${failures} failure(s)`,
  );
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await runDocsGen(process.argv.slice(2)));
