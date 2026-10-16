import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

type Script = {
  path: string;
  kind: "check" | "release" | "sync" | "deploy" | "product";
};
type Repository = { name: string; scripts: Script[] };
const ignored = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "third_party",
  "thirdparty",
  "vendor",
  "upstream",
]);
const extensions = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".py",
  ".nu",
  ".ps1",
]);

function classify(path: string): Script["kind"] {
  const name = path.toLowerCase();
  if (/check|audit|verify|lint|test|doctor|scan|validate/.test(name))
    return "check";
  if (/release|publish|version|tag/.test(name)) return "release";
  if (/sync|update|mirror|refresh|fetch/.test(name)) return "sync";
  if (/deploy|bundle|package|build/.test(name)) return "deploy";
  return "product";
}

async function scripts(root: string, current = root): Promise<Script[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(
    () => [],
  );
  const found = await Promise.all(
    entries.map(async (entry): Promise<Script[]> => {
      if (ignored.has(entry.name)) return [];
      const full = join(current, entry.name);
      if (entry.isDirectory()) return scripts(root, full);
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (
        extensions.has(ext) &&
        relative(root, full).split(/[\\/]/).includes("scripts")
      ) {
        const path = relative(root, full).replaceAll("\\", "/");
        return [{ path, kind: classify(path) }];
      }
      return [];
    }),
  );
  return found.flat();
}

const hasGit = async (path: string) =>
  stat(join(path, ".git"))
    .then(() => true)
    .catch(() => false);

export async function collectAutomationInventory(root: string) {
  root = resolve(root);
  const repositories: Repository[] = [];
  if (await hasGit(root))
    repositories.push({ name: basename(root), scripts: await scripts(root) });
  else {
    const candidates = (await readdir(root, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && !ignored.has(entry.name),
    );
    const found = await Promise.all(
      candidates.map(async (entry): Promise<Repository | undefined> => {
        const repo = join(root, entry.name);
        if (!(await hasGit(repo))) return undefined;
        return { name: entry.name, scripts: await scripts(repo) };
      }),
    );
    repositories.push(
      ...found.filter((repo): repo is Repository => repo !== undefined),
    );
  }
  repositories.sort((a, b) => a.name.localeCompare(b.name));
  const counts = Object.fromEntries(
    ["check", "release", "sync", "deploy", "product"].map((kind) => [
      kind,
      repositories
        .flatMap((repo) => repo.scripts)
        .filter((script) => script.kind === kind).length,
    ]),
  );
  return {
    root,
    repositories,
    repositoriesWithScripts: repositories.filter((repo) => repo.scripts.length)
      .length,
    scripts: repositories.flatMap((repo) => repo.scripts).length,
    counts,
  };
}

export async function runAutomationInventory(args: string[]): Promise<number> {
  if (args.includes("--inline"))
    return (await import("./inline-interpreters.ts")).runInlineInventory(
      args.filter((arg) => arg !== "--inline"),
    );
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("--root requires a source directory");
      root = value;
    } else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops automation-inventory [--json] [--root <src>]\n       yolo ops automation-inventory --inline --help",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a source directory");
  root = resolve(root);
  const report = await collectAutomationInventory(root);
  if (json) console.log(JSON.stringify(report, null, 2));
  else
    console.log(
      `automation inventory: ${report.scripts} scripts across ${report.repositoriesWithScripts} repositories`,
    );
  return 0;
}

if (import.meta.main)
  process.exit(await runAutomationInventory(process.argv.slice(2)));
