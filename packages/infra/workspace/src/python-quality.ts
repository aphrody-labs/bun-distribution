import { existsSync } from "node:fs";
import { resolve } from "node:path";

function command(args: string[], cwd: string): number {
  const result = Bun.spawnSync(args, { cwd, stdout: "inherit", stderr: "inherit" });
  return result.exitCode;
}

export function runPythonQuality(args: string[]): number {
  let root = process.cwd();
  let action: "lint" | "test" = "lint";
  const roots: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "lint" || arg === "test") action = arg;
    else if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--source") roots.push(args[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops python-quality <lint|test> [--root <repository>] [--source <directory>]...",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || roots.some((entry) => !entry)) throw new Error("--root and --source require paths");
  root = resolve(root);
  if (action === "lint")
    return command(["uv", "run", "--only-group", "dev", "ruff", "check"], root);
  const sourceRoots = roots.length ? roots : ["src"];
  if (
    command(
      ["uv", "run", "--only-group", "dev", "python", "-m", "compileall", "-q", ...sourceRoots],
      root,
    ) !== 0
  )
    return 1;
  const tests = resolve(root, "tests");
  return existsSync(tests)
    ? command(["uv", "run", "--only-group", "dev", "pytest", "-q"], root)
    : 0;
}
