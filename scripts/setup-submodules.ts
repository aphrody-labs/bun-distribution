import { resolve } from "node:path";
import { runProcess } from "../packages/bun-workspace/src/process.ts";

/** Prepare a self-contained package from the pinned, versioned public contract. */
export function materialWebPreparationPlan(root: string, runtime = process.execPath) {
  const archive = resolve(root, "build/packages/material-web.tgz");
  return {
    archive,
    commands: [
      { cwd: root, argv: [runtime, "vendor/material-web/scripts/bootstrap-types.ts"] },
      {
        cwd: resolve(root, "vendor/material-web"),
        argv: [runtime, "pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"],
      },
    ],
  };
}

/** Inspect without checking out a different revision in an active source owner. */
export async function inspectSetupSources(root: string) {
  const result = await runProcess(["git", "submodule", "status"], root, {
    timeoutMs: 30_000,
    maxOutputBytes: 4 * 1024 * 1024,
    env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.code !== 0) throw new Error("Cannot inspect setup source revisions.");
  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  if (entries.some(entry => !/^[ +\-U][a-f0-9]{40} /.test(entry)))
    throw new Error("Invalid setup source revision status.");
  const retained = entries.filter(entry => entry[0] === "+" || entry[0] === "U");
  return {
    ready: retained.length === 0,
    aligned: entries.filter(entry => entry[0] === " ").length,
    uninitialized: entries.filter(entry => entry[0] === "-").length,
    retained,
  };
}
