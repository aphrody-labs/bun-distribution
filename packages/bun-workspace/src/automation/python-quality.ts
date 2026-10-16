import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function command(args: string[], cwd: string): number {
  const result = Bun.spawnSync(args, {
    windowsHide: true,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
}

export type PythonQualityRunner = (args: string[], cwd: string) => number;

function configuredTestPaths(root: string): string[] {
  const manifest = resolve(root, "pyproject.toml");
  if (!existsSync(manifest)) return [];
  const parsed = Bun.TOML.parse(readFileSync(manifest, "utf8")) as {
    tool?: { pytest?: { ini_options?: { testpaths?: unknown } } };
  };
  const paths = parsed.tool?.pytest?.ini_options?.testpaths;
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !path))
    throw new Error("tool.pytest.ini_options.testpaths must contain non-empty paths");
  return paths as string[];
}

export function runPythonQuality(args: string[], run: PythonQualityRunner = command): number {
  let root = process.cwd();
  let action: "lint" | "test" = "lint";
  let noBuild = process.env.APHRODY_NO_BUILD === "1";
  const roots: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "lint" || arg === "test") action = arg;
    else if (arg === "--no-build") noBuild = true;
    else if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--source") roots.push(args[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops python-quality <lint|test> [--root <repository>] [--source <directory>]... [--no-build]\n--no-build uses the existing environment without dependency installation or native builds.",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || roots.some(entry => !entry)) throw new Error("--root and --source require paths");
  root = resolve(root);
  const uv = ["uv", "run", ...(noBuild ? ["--frozen", "--no-sync"] : ["--only-group", "dev"])];
  if (action === "lint") return run([...uv, "ruff", "check"], root);
  const configuredRoots = roots.length ? [] : configuredTestPaths(root);
  const testRoots = roots.length
    ? roots
    : configuredRoots.length
      ? configuredRoots
      : ["tests", "src"].filter(path => existsSync(resolve(root, path)));
  if (!testRoots.length) throw new Error("No Python test roots found; use --source or pytest testpaths");
  for (const path of testRoots) {
    if (!existsSync(resolve(root, path))) throw new Error(`Python test root does not exist: ${path}`);
  }
  const sourceRoots = roots.length ? roots : existsSync(resolve(root, "src")) ? ["src"] : testRoots;
  if (run([...uv, "python", "-m", "compileall", "-q", ...sourceRoots], root) !== 0) return 1;
  // pytest's exit code 5 (no tests collected) must remain a failure.
  return run([...uv, "pytest", "-q", ...testRoots], root);
}
