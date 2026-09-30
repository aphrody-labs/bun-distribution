import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type Script = { path: string; kind: "check" | "release" | "sync" | "deploy" | "product" };
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
  if (/check|audit|verify|lint|test|doctor|scan|validate/.test(name)) return "check";
  if (/release|publish|version|tag/.test(name)) return "release";
  if (/sync|update|mirror|refresh|fetch/.test(name)) return "sync";
  if (/deploy|bundle|package|build/.test(name)) return "deploy";
  return "product";
}

async function scripts(root: string, current = root): Promise<Script[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  const result: Script[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "scripts" || current.includes(`${root}/scripts/`))
        result.push(...(await scripts(root, full)));
      else if (current === root) result.push(...(await scripts(root, full)));
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    if (extensions.has(ext) && relative(root, full).split("/").includes("scripts")) {
      const path = relative(root, full).replaceAll("\\", "/");
      result.push({ path, kind: classify(path) });
    }
  }
  return result;
}

export async function runAutomationInventory(args: string[]): Promise<number> {
  let root = process.cwd();
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops automation-inventory [--json] [--root <src>]");
      return 0;
    }
  }
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0) root = args[rootIndex + 1] ?? "";
  if (!root) throw new Error("--root requires a source directory");
  root = resolve(root);
  const entries = await readdir(root, { withFileTypes: true });
  const repositories: Repository[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const repo = join(root, entry.name);
    if (
      !(await readdir(join(repo, ".git"))
        .then(() => true)
        .catch(() => false))
    )
      continue;
    repositories.push({ name: entry.name, scripts: await scripts(repo) });
  }
  repositories.sort((a, b) => a.name.localeCompare(b.name));
  const counts = Object.fromEntries(
    ["check", "release", "sync", "deploy", "product"].map((kind) => [
      kind,
      repositories.flatMap((repo) => repo.scripts).filter((script) => script.kind === kind).length,
    ]),
  );
  const report = {
    root,
    repositories,
    repositoriesWithScripts: repositories.filter((repo) => repo.scripts.length).length,
    scripts: repositories.flatMap((repo) => repo.scripts).length,
    counts,
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else
    console.log(
      `automation inventory: ${report.scripts} scripts across ${report.repositoriesWithScripts} repositories`,
    );
  return 0;
}

if (import.meta.main) process.exit(await runAutomationInventory(process.argv.slice(2)));
