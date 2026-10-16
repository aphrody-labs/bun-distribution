/* SPDX-License-Identifier: Apache-2.0 */

import { resolve } from "node:path";

/**
 * One bounded, native runtime gate for critical Bun and uv surfaces.
 *
 * It intentionally targets maintained roots only: vendored/third-party trees
 * are not package managers' workspaces and must not silently mutate here.
 */

type Check = { name: string; command: string; args: string[]; cwd?: string };

export async function runRuntimeGate(args: string[]): Promise<number> {
  let root = process.cwd();
  let pythonRoot = process.env.APHRODY_PY_ROOT;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--python-root") pythonRoot = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops runtime-gate [--root <aphrody>] [--python-root <py>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires an aphrody-ai repository path");
  pythonRoot = resolve(root, pythonRoot ?? "py");
  const checks: Check[] = [
    { name: "Bun runtime", command: "bun", args: ["--version"] },
    {
      name: "Bun Google tests",
      command: "bun",
      args: ["test", "packages/google/test"],
    },
    {
      name: "Bun Google bundle",
      command: "bun",
      args: [
        "build",
        "packages/google/src/index.ts",
        "--outdir",
        "packages/google/dist",
        "--target",
        "bun",
        "--format",
        "esm",
      ],
    },
    { name: "uv runtime", command: "uv", args: ["--version"] },
    {
      name: "uv Python workspace lock",
      command: "uv",
      args: ["lock", "--check"],
      cwd: pythonRoot,
    },
    {
      name: "uv training import",
      command: "uv",
      args: ["run", "--locked", "--package", "aphrody-train", "python", "-c", "import aphrody_train"],
      cwd: pythonRoot,
    },
    {
      name: "uv Aphrody import",
      command: "uv",
      args: [
        "run",
        "--locked",
        "--project",
        pythonRoot,
        "--package",
        "aphrody",
        "python",
        "-c",
        "import aphrody; print(aphrody.__name__)",
      ],
      cwd: pythonRoot,
    },
  ];

  let failures = 0;
  for (const check of checks) {
    const cwd = check.cwd ? resolve(check.cwd) : root;
    const result = Bun.spawnSync([check.command, ...check.args], {
      windowsHide: true,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, RUSTC_WRAPPER: "" },
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    if (result.exitCode === 0) {
      console.log(`PASS ${check.name}${output ? `: ${output.split("\n").at(-1)}` : ""}`);
    } else {
      failures += 1;
      console.error(`FAIL ${check.name} (exit ${result.exitCode})`);
      if (output) console.error(output.slice(-2000));
    }
  }

  console.log(`Runtime gate: ${failures === 0 ? "PASS" : "FAILED"} (${failures} failure(s))`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await runRuntimeGate(process.argv.slice(2)));
