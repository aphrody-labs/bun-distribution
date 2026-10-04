// SPDX-License-Identifier: Apache-2.0
/** Run executable UI gates. Passing commands do not complete the deduplication plan. */
import { resolve } from "node:path";

type Gate = {
  name: string;
  command: [string, ...string[]];
  cwd?: string;
  quick?: boolean;
};

const gates: Gate[] = [
  { name: "Bun workspace contract", command: ["bun", "run", "bun:check"], quick: true },
  { name: "Frozen Bun install", command: ["bun", "install", "--frozen-lockfile"] },
  { name: "Native Bun bridge", command: ["bun", "run", "bun:native"] },
  { name: "Bun workspace typecheck", command: ["bun", "run", "typecheck"], quick: true },
  {
    name: "M3 explorer tests",
    command: ["bun", "run", "test"],
    cwd: "m3/packages/m3-explorer",
    quick: true,
  },
  {
    name: "Desktop UI tests",
    command: ["bun", "run", "test"],
    cwd: "m3/packages/app-ui",
    quick: true,
  },
  {
    name: "Next.js production build",
    command: ["bun", "run", "build"],
    cwd: "examples/m3-next",
    quick: true,
  },
  { name: "Full Bun test gate", command: ["bun", "run", "test"] },
  { name: "Cargo check", command: ["cargo", "check", "--workspace", "--all-targets"] },
  {
    name: "Cargo clippy",
    command: ["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  },
  { name: "Cargo tests", command: ["cargo", "test", "--workspace"] },
  { name: "Cargo deny", command: ["cargo", "deny", "check"] },
  { name: "Git whitespace check", command: ["git", "diff", "--check"], quick: true },
];

export async function runUiVerify(args: string[]): Promise<number> {
  let root = process.cwd();
  let quick = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--quick") quick = true;
    else if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops ui-verify [--root <aphrody-ui>] [--quick]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires an aphrody-ui repository path");
  root = resolve(root);
  let failed = 0;
  for (const gate of gates) {
    if (quick && !gate.quick) continue;
    const started = performance.now();
    const result = Bun.spawnSync(gate.command, {
      cwd: resolve(root, gate.cwd ?? "."),
      env: { ...Bun.env, RUSTC_WRAPPER: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim();
    const passed = result.exitCode === 0;
    if (!passed) failed++;
    console.log(
      `${passed ? "PASS" : "FAIL"} ${gate.name} (${Math.round(performance.now() - started)} ms)`,
    );
    if (!passed) console.log(output.split(/\r?\n/).slice(-12).join("\n"));
  }

  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await runUiVerify(process.argv.slice(2)));
