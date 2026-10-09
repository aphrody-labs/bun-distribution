#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Root task runner: the m3 packages build, serve and compile through the yolo CLI.
//   bun scripts/yolo.ts <build|serve|compile|test|lint|typecheck|bench|bench:check|install:theme> [args...]
// yolo is resolved from $YOLO_ROOT (default $HOME/yolo) and run as the Bun CLI `bun run $YOLO_ROOT/packages/engine/yolo/src/index.ts`
// on every platform (bin/yolo is only a bash launcher around that entry).
//   build    the canonical cached package/app pipeline (every package and app)
//   serve    apps/example `dev`      (m3 dev: App Router, RSC refresh on change)
//   compile  apps/example `compile`  (m3 compile: one executable embedding the App Router build)
//   test / lint / typecheck     workspace gates, after a yolo preflight (`yolo version --json`); typecheck is scripts/build.ts;
//                               test runs every package, the script tests and check-exports, check-assets, check-links
//   bench / bench:check         scripts/bench/run.ts: measure the startup, install, bundle and compile numbers of
//                               docs/reports/PERF.md; `bench:check` fails past docs/reports/perf-budget.json + 10%
//   install:theme               packages/m3-os-themes CLI (dry-run unless --apply)
// apps/example is the framework example app (it replaced apps/showcase on 2026-10-09).
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "..");
/** The Bun entry of the yolo CLI inside a yolo root. */
const entryOf = (root: string) => join(root, "packages", "engine", "yolo", "src", "index.ts");
/** The enclosing Aphrody monorepo carries yolo since m3 was fused into it; a standalone checkout uses $HOME/yolo. */
const MONOREPO = resolve(REPO, "..");
export const YOLO_ROOT =
  process.env["YOLO_ROOT"] ||
  ((await Bun.file(entryOf(MONOREPO)).exists()) ? MONOREPO : join(homedir(), "yolo"));
/** yolo is a Bun CLI: its entry is run by bun directly, never through the bash launcher. */
export const YOLO_CLI = entryOf(YOLO_ROOT);
export const YOLO_COMMAND = ["bun", "run", YOLO_CLI];

export type Step = { cmd: string[]; cwd?: string; env?: Record<string, string> };

/** `<yolo cli> ...args` with yolo's home set to this repository. */
export const yolo = (...args: string[]): Step => ({
  cmd: [...YOLO_COMMAND, ...args],
  cwd: REPO,
  env: { YOLO_HOME: REPO },
});

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

/** The example app of the framework. */
export const EXAMPLE = join(REPO, "apps/example");

/** The steps of one task, in order. */
export function plan(task: string, rest: string[] = []): Step[] {
  switch (task) {
    case "build":
      return [yolo("version", "--json"), bun(REPO, "scripts/build.ts", "build")];
    case "serve":
      return [bun(EXAMPLE, "run", "dev")];
    case "compile":
      return [bun(EXAMPLE, "run", "compile")];
    case "test":
      return [
        yolo("version", "--json"),
        bun(
          REPO,
          "test",
          "./scripts/yolo.test.ts",
          "./scripts/bench/lib.test.ts",
          "./scripts/check-exports.test.ts",
          "./scripts/check-assets.test.ts",
          "./scripts/check-links.test.ts",
          "./scripts/native.test.ts",
          "./scripts/forks.test.ts",
          "./scripts/build.test.ts",
        ),
        // Package tests do not need each other's results: `--parallel` runs them all at once, where `--filter` alone
        // waits for the workspace dependencies' scripts first (5.3 s -> 2.9 s). A failing package fails the task.
        bun(REPO, "run", "--parallel", "--no-exit-on-error", ...ALL, "--if-present", "test"),
        // Repository gates: manifests and first-party imports, asset references and app icons, docs links.
        bun(REPO, "scripts/check-exports.ts"),
        bun(REPO, "scripts/check-assets.ts"),
        bun(REPO, "scripts/check-links.ts"),
      ];
    case "lint":
      return [yolo("version", "--json"), { cmd: ["oxlint", ...lintPaths()], cwd: REPO }];
    case "typecheck":
      return [yolo("version", "--json"), bun(REPO, "scripts/build.ts", "typecheck")];
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
    if (task !== "install:theme" && !(await Bun.file(YOLO_CLI).exists()))
      throw new Error(`yolo CLI not found at ${YOLO_CLI}; set YOLO_ROOT`);
    for (const step of plan(task, rest)) {
      const code = Bun.spawnSync(step.cmd, {
        cwd: step.cwd,
        env: { ...process.env, ...step.env },
        stdio: ["inherit", "inherit", "inherit"],
      }).exitCode;
      if (code !== 0) process.exit(code ?? 1);
    }
  } catch (e) {
    console.error(`yolo.ts: ${(e as Error).message}`);
    process.exit(2);
  }
}
