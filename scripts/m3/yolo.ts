#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Root task runner: the m3 packages build, serve and compile through the yolo CLI.
//   bun scripts/yolo.ts <build|serve|compile|test|lint|typecheck|bench|bench:check|install:theme> [args...]
// yolo is resolved from $YOLO_ROOT (default $HOME/yolo) and run through `$YOLO_ROOT/bin/yolo`.
//   build    yolo web build     -> apps/web `build`, then the canonical cached package/app pipeline
//   serve    yolo web dev       -> apps/web `dev`   (m3 dev)
//   compile  yolo tauri build   -> apps/web `build`, then apps/web `compile` (m3 compile, single executable)
//   test / lint / typecheck     workspace gates, after a yolo preflight (`yolo version --json`); typecheck is scripts/build.ts;
//                               test runs every package, the script tests and check-exports, check-assets, check-links
//   bench / bench:check         scripts/bench/run.ts: measure the startup, install, bundle and compile numbers of
//                               docs/reports/PERF.md; `bench:check` fails past docs/reports/perf-budget.json + 10%
//   install:theme               packages/m3-os-themes CLI (dry-run unless --apply)
// yolo's web|desktop|tauri commands act on $YOLO_HOME/apps/web, so YOLO_HOME is pointed at this repository.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");
export const YOLO_ROOT = process.env["YOLO_ROOT"] ?? join(homedir(), "yolo");
export const YOLO_CLI = join(YOLO_ROOT, "bin/yolo");

export type Step = {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
};

/** `<yolo cli> ...args` with yolo's home set to this repository. */
export const yolo = (...args: string[]): Step => ({
  cmd: [YOLO_CLI, ...args],
  cwd: REPO,
  env: { YOLO_HOME: REPO },
});

/** Test selection: every workspace package. The packages excluded from the workspace are named explicitly, since
 * `--filter "*"` alone still selects them: the host-bound ones (installed and tested by aphrody or iecode) and the
 * nested repository packages/nie-ui (its own workspace, install and `bun test`). */
const EXCLUDED = [
  "@aphrody/app-ui",
  "@rosegriffon/ui",
  "@shenron/ui",
  "@aphrody/web-to-tauri",
  "@aphrody/nie-ui",
];
const ALL = [
  "--filter",
  "*",
  ...EXCLUDED.flatMap((name) => ["--filter", `!${name}`]),
];

const bun = (cwd: string, ...args: string[]): Step => ({
  cmd: ["bun", ...args],
  cwd,
});

/** The steps of one task, in order. */
export function plan(task: string, rest: string[] = []): Step[] {
  switch (task) {
    case "build":
      return [yolo("web", "build"), bun(REPO, "scripts/build.ts", "build")];
    case "serve":
      return [yolo("web", "dev")];
    case "compile":
      return [
        yolo("tauri", "build"),
        bun(join(REPO, "apps/web"), "run", "compile"),
      ];
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
        bun(
          REPO,
          "run",
          "--parallel",
          "--no-exit-on-error",
          ...ALL,
          "--if-present",
          "test",
        ),
        // Repository gates: manifests and first-party imports, asset references and app icons, docs links.
        bun(REPO, "scripts/check-exports.ts"),
        bun(REPO, "scripts/check-assets.ts"),
        bun(REPO, "scripts/check-links.ts"),
      ];
    case "lint":
      return [bun(REPO, "lint", "packages", "apps", "scripts")];
    case "typecheck":
      return [bun(REPO, "check", "packages", "apps", "scripts")];
    case "bench":
      return [bun(REPO, "scripts/bench/run.ts", ...rest)];
    case "bench:check":
      return [bun(REPO, "scripts/bench/run.ts", "--check", ...rest)];
    case "install:theme":
      return [
        bun(
          REPO,
          join(REPO, "packages/m3-os-themes/src/cli.ts"),
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
    if (task !== "install:theme" && !existsSync(YOLO_CLI))
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
