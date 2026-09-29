import { resolve } from "node:path";

type Gate = { name: string; command: string[] };
function run(gate: Gate, root: string): number {
  console.log(`== ${gate.name} ==`);
  return Bun.spawnSync(gate.command, { cwd: root, stdout: "inherit", stderr: "inherit" }).exitCode;
}
export function runMonorepoGate(args: string[]): number {
  let root = process.cwd();
  let docsCommand = "docs:check";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--docs-script") docsCommand = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops monorepo-gate [--root <repository>] [--docs-script <bun-script>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !docsCommand) throw new Error("--root and --docs-script require values");
  root = resolve(root);
  const gates: Gate[] = [
    { name: "cargo fmt check", command: ["cargo", "fmt", "--all", "--check"] },
    { name: "cargo check workspace tests", command: ["cargo", "check", "--workspace", "--tests"] },
    {
      name: "cargo clippy workspace",
      command: ["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
    },
    { name: "cargo test workspace", command: ["cargo", "test", "--workspace", "--tests"] },
    { name: "bun typecheck", command: ["bun", "run", "typecheck"] },
    { name: "bun test", command: ["bun", "run", "test"] },
    { name: "docs check", command: ["bun", "run", docsCommand] },
  ];
  for (const gate of gates) if (run(gate, root) !== 0) return 1;
  console.log("verify-monorepo=OK");
  return 0;
}
