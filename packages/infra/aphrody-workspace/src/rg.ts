import { join, resolve } from "node:path";
import { infraRoot } from "./runtime.ts";
import { runRustBridge } from "./bridges.ts";

const CHECKS = ["format", "lint", "typecheck", "test", "build"] as const;
type Check = (typeof CHECKS)[number];
const ROOTS = ["apps/rg", "packages/rg"] as const;

export function rgRoots(root = infraRoot()): string[] {
  return ROOTS.map((path) => join(root, path));
}

async function manifests(root = infraRoot()) {
  const found: Array<{ name: string; path: string; scripts: Record<string, string> }> = [];
  for (const workspace of rgRoots(root)) {
    for await (const path of new Bun.Glob("*/package.json").scan({ cwd: workspace, absolute: true })) {
      const manifest = (await Bun.file(path).json()) as { name?: string; scripts?: Record<string, string> };
      found.push({ name: manifest.name ?? path, path: path.slice(0, -"/package.json".length), scripts: manifest.scripts ?? {} });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** RG command facade: checks run declared package scripts; release operations use Aphrody Infra. */
export async function runRg(args: string[], root = infraRoot()): Promise<number> {
  const [action = "status", ...rest] = args;
  if (action === "status") {
    const packages = await manifests(root);
    console.log(JSON.stringify({ module: "rg", roots: rgRoots(root), packages: packages.map(({ name, path, scripts }) => ({ name, path, scripts: Object.keys(scripts).sort() })) }, null, 2));
    return 0;
  }
  if (action === "check") {
    const [check, ...options] = rest;
    if (!CHECKS.includes(check as Check)) throw new Error(`usage: aphrody-ops rg check <${CHECKS.join("|")}> [--package <name>]`);
    let selected = await manifests(root);
    const packageIndex = options.indexOf("--package");
    if (packageIndex !== -1) {
      const name = options[packageIndex + 1];
      if (!name || options.length !== 2) throw new Error("usage: aphrody-ops rg check <check> [--package <name>]");
      selected = selected.filter((item) => item.name === name || item.name.endsWith(`/${name}`));
      if (!selected.length) throw new Error(`unknown RG package: ${name}`);
    } else if (options.length) throw new Error("usage: aphrody-ops rg check <check> [--package <name>]");
    const scriptNames: Record<Check, string[]> = { format: ["format:check"], lint: ["lint"], typecheck: ["type-check", "typecheck"], test: ["test"], build: ["build"] };
    let status = 0;
    for (const item of selected) {
      const script = scriptNames[check as Check].find((candidate) => item.scripts[candidate]);
      if (!script) continue;
      console.error(`RG ${check}: ${item.name} (${script})`);
      const child = Bun.spawn([process.execPath, "run", script], { cwd: item.path, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
      const code = await child.exited;
      if (code !== 0) status = code;
    }
    return status;
  }
  if (action === "deploy") {
    const targetIndex = rest.indexOf("--target");
    const target = targetIndex < 0 ? undefined : rest[targetIndex + 1];
    const apply = rest.includes("--apply");
    if (!target || rest.some((arg, index) => arg === "--target" ? index !== targetIndex : index !== targetIndex + 1 && arg !== "--apply")) {
      throw new Error("usage: aphrody-ops rg deploy --target <infra-target> [--apply]");
    }
    return runRustBridge("aphrody-infra", ["deploy", "--stack", "rg", "--target", target, ...(apply ? ["--apply"] : [])], { stdout: "inherit", stderr: "inherit" });
  }
  if (action === "migrate") {
    const [operation = "inventory", ...options] = rest;
    const map: Record<string, string> = { inventory: "inventory", scripts: "scripts-import", docs: "docs-import", infra: "infra-scripts-import" };
    const targetRoot = resolve(root);
    const sourceRoot = resolve(targetRoot, "../src");
    if (!map[operation]) throw new Error("usage: aphrody-ops rg migrate <inventory|scripts|docs|infra>");
    if (options.length) throw new Error("RG migration paths are resolved from the Aphrody workspace configuration");
    const command = join(targetRoot, "packages/infra/aphrody-workspace/src/ops.ts");
    const child = Bun.spawn([process.execPath, command, "consolidation", map[operation]!, "--source-root", sourceRoot, "--aphrody-root", targetRoot], { cwd: targetRoot, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    return child.exited;
  }
  throw new Error("usage: aphrody-ops rg <status|check|deploy|migrate> ...");
}
