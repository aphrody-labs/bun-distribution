/** Deterministic local release gate for Aphrody AI's maintained Bun and Rust surfaces. */
import { resolve } from "node:path";

type Check = { name: string; command: string[] };

function run(check: Check, root: string): boolean {
  console.log(`\n=== ${check.name} ===`);
  const result = Bun.spawnSync(check.command, {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`.trim();
  if (output) console.log(output.slice(-4000));
  if (result.exitCode === 0) {
    console.log(`PASS ${check.name}`);
    return true;
  }
  console.error(`FAIL ${check.name} (exit ${result.exitCode})`);
  return false;
}

export function runAiReleaseGate(args: string[]): number {
  let root = process.cwd();
  let scoped = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--scoped") scoped = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops ai-release-gate [--root <repository>] [--scoped]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a repository path");
  root = resolve(root);
  const checks: Check[] = [
    { name: "git diff --check", command: ["git", "diff", "--check"] },
    { name: "Bun typecheck", command: ["bun", "run", "typecheck"] },
    {
      name: "Rust maintained crate tests",
      command: [
        "scripts/build/rust/cargo-serial.sh",
        "test",
        "-p",
        "aphrody-config",
        "-p",
        "aphrody-mcp",
        "-p",
        "aphrody-a2a-coord",
        "-p",
        "aphrody-agent-runtime",
        "--locked",
        "--offline",
      ],
    },
  ];
  if (!scoped)
    checks.push({
      name: "Rust complete workspace check",
      command: [
        "scripts/build/rust/cargo-serial.sh",
        "check",
        "--workspace",
        "--all-targets",
        "--locked",
        "--offline",
      ],
    });
  const failures = checks.filter((check) => !run(check, root)).length;
  console.log(`\nRelease gate: ${failures === 0 ? "PASS" : "FAILED"} (${failures} failure(s))`);
  return failures === 0 ? 0 : 1;
}
