/**
 * `yolo ops|workspace|optimize|update|google|doc-ai|browser`: the command lines of the Bun owner packages,
 * folded into yolo. Each command imports its owner's CLI module in-process and returns the runner's exit status;
 * the owners keep their code and no longer publish a binary of their own.
 *
 * The module path is computed, so a compiled yolo does not bundle the owners (and their dependencies): it loads
 * them from the Aphrody checkout at run time.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findCheckout, isCompiled } from "./home";

export interface PackageCommand {
  /** Owner CLI module, relative to the checkout root. */
  readonly module: string;
  /** Exported runner `(argv: string[]) => number | Promise<number>`. */
  readonly run: string;
  /** One-line description for `yolo help`. */
  readonly summary: string;
}

export const PACKAGE_COMMANDS = {
  ops: {
    module: "packages/infra/workspace/src/ops.ts",
    run: "runOps",
    summary:
      "Workspace operations (gates, docs, build factory, audits); other commands go to aphrody-infra",
  },
  workspace: {
    module: "packages/infra/workspace/src/cli.ts",
    run: "runWorkspace",
    summary: "optimize | plugins | code-edit; other commands go to aphrody-infra unchanged",
  },
  optimize: {
    module: "packages/infra/workspace/src/optimize.ts",
    run: "runOptimize",
    summary: "Run the optimize-workspace skill through `aphrody exec` (--print previews it)",
  },
  update: {
    module: "packages/infra/update/src/cli.ts",
    run: "runUpdate",
    summary: "Tool pins, dependencies, Cargo lock, user systemd units, upstream sources",
  },
  google: {
    module: "packages/google/google/src/cli.ts",
    run: "runGoogle",
    summary: "Google Drive projection and Fonts proxy (Gemini runtime: aphrody google)",
  },
  "doc-ai": {
    module: "packages/ai/doc-ai/src/cli.ts",
    run: "main",
    summary: "Translate Markdown, generate Lit API guides, sync docs/",
  },
  browser: {
    module: "packages/web/agent-browser/src/cli.ts",
    run: "runAgentBrowser",
    summary: "One CDP browser command on the Obscura endpoint, as a JSON line",
  },
} as const satisfies Record<string, PackageCommand>;

export type PackageCommandName = keyof typeof PACKAGE_COMMANDS;

export function isPackageCommand(name: string): name is PackageCommandName {
  return Object.hasOwn(PACKAGE_COMMANDS, name);
}

/**
 * The checkout that holds the owner packages: this source tree when yolo runs from source; for a compiled yolo,
 * the checkout enclosing the working directory, else `YOLO_APHRODY_ROOT` (default `~/aphrody`).
 */
export function packageRoot(cwd: string = process.cwd()): string {
  if (!isCompiled()) return resolve(import.meta.dir, "../../../..");
  return (
    findCheckout(cwd) ?? resolve(process.env["YOLO_APHRODY_ROOT"] ?? join(homedir(), "aphrody"))
  );
}

type Runner = (argv: string[]) => number | Promise<number>;

/** Runs `yolo <name> ...args` in-process and returns the exit status. */
export async function runPackageCommand(
  name: string,
  args: readonly string[],
  root: string = packageRoot(),
): Promise<number> {
  if (!isPackageCommand(name)) {
    console.error(`yolo: ${name} is not a package command`);
    return 2;
  }
  const { module, run } = PACKAGE_COMMANDS[name];
  const path = join(root, module);
  if (!existsSync(path)) {
    console.error(
      `yolo ${name}: ${module} is missing under ${root}; run inside an Aphrody checkout or set YOLO_APHRODY_ROOT`,
    );
    return 127;
  }
  const owner = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const runner = owner[run];
  if (typeof runner !== "function") {
    console.error(`yolo ${name}: ${module} does not export ${run}()`);
    return 70;
  }
  try {
    const status = await (runner as Runner)([...args]);
    return typeof status === "number" ? status : 0;
  } catch (error) {
    console.error(`yolo ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
