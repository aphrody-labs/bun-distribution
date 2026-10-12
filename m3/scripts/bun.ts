#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Root task runner: M3 packages build, serve and compile through Bun-native commands.
//   bun scripts/bun.ts <build|serve|compile|test|lint|update|security|research|typecheck|bench|bench:check|install:theme> [args...]
// on every platform through Bun directly.
//   build    the canonical cached package/app pipeline (every package and app)
//   serve    apps/example `dev`      (m3 dev: App Router, RSC refresh on change)
//   compile  apps/example `compile`  (m3 compile: one executable embedding the App Router build)
//   test / lint / typecheck     workspace gates; typecheck is scripts/build.ts;
//                               test runs every package, the script tests and check-exports, check-assets, check-links
//   bench / bench:check         scripts/bench/run.ts: measure the startup, install, bundle and compile numbers of
//                               docs/reports/PERF.md; `bench:check` fails past docs/reports/perf-budget.json + 10%
//   install:theme               packages/m3-os-themes CLI (dry-run unless --apply)
// apps/example (App Router) replaces apps/showcase, removed on 2026-10-09.
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { workspacePackages } from "./lib/workspace.ts";
import { resolveRustAphrody } from "../../bin/aphrody.ts";

export const REPO = resolve(import.meta.dir, "..");
/** The enclosing Aphrody monorepo is the native owner of shared Bun tooling. */
const MONOREPO = resolve(REPO, "..");
export const BUN_ROOT = process.env["BUN_ROOT"] || process.env["APHRODY_ROOT"] || MONOREPO;

export type Step = { cmd: string[]; cwd?: string; env?: Record<string, string> };

/** Test selection: every package of this repository (path filter: the enclosing Aphrody workspace has many more).
 * The nested repository packages/nie-ui (its own workspace, install and `bun test`) is excluded explicitly, since
 * `--filter` alone still selects it. */
const EXCLUDED = ["@aphrody/nie-ui"];
const ALL = ["--filter", "./packages/*", ...EXCLUDED.flatMap((name) => ["--filter", `!${name}`])];

/** Lint scope: m3 packages (not the nested app submodules), apps and scripts. */
const lintPaths = (): string[] => [
  ...[...new Bun.Glob("m3*").scanSync({ cwd: join(REPO, "packages"), onlyFiles: false })]
    .toSorted()
    .map((d) => `packages/${d}`),
  "apps",
  "scripts",
];

const bun = (cwd: string, ...args: string[]): Step => ({ cmd: ["bun", ...args], cwd });

/** Select real workspace members before forwarding flags to the capability owner. */
function selection(rest: string[]) {
  const index = rest.indexOf("--only");
  if (index < 0) return { packages: undefined, args: rest };
  const names = rest[index + 1]?.split(",").filter(Boolean);
  if (!names?.length || names.some((name) => name.startsWith("-")))
    throw new Error("--only requires comma-separated M3 package names");
  const members = workspacePackages(REPO);
  const packages = names.map((name) => {
    const member = members.find((item) => item.name === name);
    if (!member) throw new Error(`Unknown M3 workspace package: ${name}`);
    return member;
  });
  return { packages, args: rest.filter((_, offset) => offset !== index && offset !== index + 1) };
}

/** Bun's package manager reads the single enclosing workspace lock. */
function installRoot() {
  let directory = REPO;
  while (!existsSync(join(directory, "bun.lock")) && !existsSync(join(directory, "bun.lockb"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("No Bun lockfile above the selected M3 workspace; install its owner first");
    directory = parent;
  }
  return directory;
}

/** The example app of the framework. */
export const EXAMPLE = join(REPO, "apps/example");

/** The steps of one task, in order. */
export function plan(task: string, rest: string[] = []): Step[] {
  switch (task) {
    case "build":
      return [bun(REPO, "scripts/build.ts", "build", ...rest)];
    case "serve":
      return [bun(EXAMPLE, "run", "dev")];
    case "compile":
      return [bun(EXAMPLE, "run", "compile")];
    case "test":
      return [
        bun(
          REPO,
          "test",
          "./scripts/bun.test.ts",
          "./scripts/bench/lib.test.ts",
          "./scripts/check-exports.test.ts",
          "./scripts/check-assets.test.ts",
          "./scripts/check-links.test.ts",
          "./scripts/native.test.ts",
          "./scripts/forks.test.ts",
          "./scripts/build.test.ts",
        ),
        // Package tests do not need each other's results: `--parallel` runs them all at once, where `--filter` alone
        // waits for the workspace dependencies' scripts first (5.3 s -> 2.9 s, docs/reports/PERF.md). A failing package fails the task.
        bun(REPO, "run", "--parallel", "--no-exit-on-error", ...ALL, "--if-present", "test"),
        // Repository gates: manifests and first-party imports, asset references and app icons, docs links.
        bun(REPO, "scripts/check-exports.ts"),
        bun(REPO, "scripts/check-assets.ts"),
        bun(REPO, "scripts/check-links.ts"),
      ];
    case "lint": {
      const { packages, args } = selection(rest);
      return [
        {
          cmd: ["oxlint", ...(packages?.map((item) => item.rel) ?? lintPaths()), ...args],
          cwd: REPO,
        },
      ];
    }
    case "update": {
      const { packages, args } = selection(rest);
      const allowed = new Set(["--apply", "--dry-run"]);
      if (args.some((arg) => !allowed.has(arg)))
        throw new Error(
          "m3 update accepts --apply, --dry-run and --only; major/range rewrites need separate qualification",
        );
      const root = installRoot();
      const scope = relative(root, REPO).replaceAll("\\", "/");
      const filters = packages?.map((item) => `./${scope ? `${scope}/` : ""}${item.rel}`) ?? [
        `./${scope ? `${scope}/` : ""}packages/*`,
      ];
      return [
        bun(
          root,
          "update",
          "--ignore-scripts",
          ...filters.flatMap((filter) => ["--filter", filter]),
          ...(!args.includes("--apply") || args.includes("--dry-run") ? ["--dry-run"] : []),
        ),
      ];
    }
    case "security":
      if (rest.includes("fix") || rest.includes("--fix"))
        throw new Error(
          "Bun audit fix has no M3 workspace filter; use the shared lock owner's qualified security correction",
        );
      return [bun(installRoot(), "audit", ...rest)];
    case "research": {
      const root = resolve(process.env.APHRODY_WORKSPACE_ROOT ?? MONOREPO);
      const native = resolveRustAphrody(root);
      if (!native)
        throw new Error(
          "Install the native Aphrody CLI or set APHRODY_BIN before acquiring the design corpus",
        );
      return [{ cmd: [native, "web", "design-sync", "--workspace", root, ...rest], cwd: root }];
    }
    case "typecheck":
      return [bun(REPO, "scripts/build.ts", "typecheck", ...rest)];
    case "bench":
      return [bun(REPO, "scripts/bench/run.ts", ...rest)];
    case "bench:check":
      return [bun(REPO, "scripts/bench/run.ts", "--check", ...rest)];
    case "install:theme":
      return [
        bun(
          REPO,
          "packages/m3-os-themes/src/cli.ts",
          ...(rest.length > 0 ? rest : ["install", "--target", "all"]),
        ),
      ];
    default:
      throw new Error(`unknown task "${task}"`);
  }
}

if (import.meta.main) {
  const [task = "", ...rest] = process.argv.slice(2);
  try {
    if (
      (task === "serve" || task === "compile") &&
      !(await Bun.file(join(EXAMPLE, "package.json")).exists())
    )
      throw new Error(
        `${task}: no example app at ${EXAMPLE} (m3/apps/example is the App Router example app)`,
      );
    for (const step of plan(task, rest)) {
      const code = Bun.spawnSync(step.cmd, {
        windowsHide: true,
        cwd: step.cwd,
        env: { ...process.env, ...step.env },
        stdio: ["inherit", "inherit", "inherit"],
      }).exitCode;
      if (code !== 0) process.exit(code ?? 1);
    }
  } catch (e) {
    console.error(`bun.ts: ${(e as Error).message}`);
    process.exit(2);
  }
}
