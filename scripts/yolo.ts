#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Root task runner: the m3 packages build, serve and compile through the yolo CLI.
//   bun scripts/yolo.ts <build|serve|compile|test|lint|typecheck|install:theme> [args...]
// yolo is resolved from $YOLO_ROOT (default $HOME/yolo) and run from source: `bun $YOLO_ROOT/apps/cli/src/index.ts`.
//   build    yolo web build     -> apps/web `build` (cached app build), then scripts/build.ts (packages, cached)
//   serve    yolo web dev       -> apps/web `dev`   (m3 dev)
//   compile  yolo tauri build   -> apps/web `build`, then apps/web `compile` (m3 compile, single executable)
//   test / lint / typecheck     workspace gates, after a yolo preflight (`yolo version --json`); typecheck is scripts/build.ts
//   install:theme               packages/m3-os-themes CLI (dry-run unless --apply)
// yolo's web|desktop|tauri commands act on $YOLO_HOME/apps/web, so YOLO_HOME is pointed at this repository.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");
export const YOLO_ROOT = process.env["YOLO_ROOT"] ?? join(homedir(), "yolo");
export const YOLO_CLI = join(YOLO_ROOT, "apps/cli/src/index.ts");

export type Step = { cmd: string[]; cwd?: string; env?: Record<string, string> };

/** `bun <yolo cli> ...args` with yolo's home set to this repository. */
export const yolo = (...args: string[]): Step => ({
  cmd: ["bun", YOLO_CLI, ...args],
  cwd: REPO,
  env: { YOLO_HOME: REPO },
});

/** Workspace selection: the @aphrody/m3* packages (never the host-bound app-ui, whose build starts Cargo). */
const M3 = ["--filter", "@aphrody/m3*"];

/** Lint scope: m3 packages (not the nested app submodules), apps and scripts. */
const lintPaths = (): string[] => [
  ...readdirSync(join(REPO, "packages"))
    .filter((d) => d.startsWith("m3"))
    .map((d) => `packages/${d}`),
  "apps",
  "scripts",
];

const bun = (cwd: string, ...args: string[]): Step => ({ cmd: ["bun", ...args], cwd });

/** The steps of one task, in order. */
export function plan(task: string, rest: string[] = []): Step[] {
  switch (task) {
    case "build":
      return [
        yolo("web", "build"),
        bun(REPO, "scripts/build.ts", "build", "--no-apps"),
      ];
    case "serve":
      return [yolo("web", "dev")];
    case "compile":
      return [yolo("tauri", "build"), bun(join(REPO, "apps/web"), "run", "compile")];
    case "test":
      return [
        yolo("version", "--json"),
        bun(REPO, "test", "./scripts/yolo.test.ts"),
        bun(REPO, "run", ...M3, "--if-present", "test"),
      ];
    case "lint":
      return [yolo("version", "--json"), bun(REPO, "x", "oxlint", ...lintPaths())];
    case "typecheck":
      return [yolo("version", "--json"), bun(REPO, "scripts/build.ts", "typecheck")];
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
