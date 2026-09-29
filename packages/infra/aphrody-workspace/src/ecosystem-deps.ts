// SPDX-License-Identifier: Apache-2.0
/** Keep local Cargo paths, and the Bun path to aphrody-web's @aphrody/x, valid when checkouts move. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

type Owner = "ai" | "os" | "infra";
type Roots = Record<Owner, string> & { web: string };

const owners: Record<string, Owner> = {
  "aphrody-gemini-web": "ai",
  "aphrody-embed": "ai",
};

function slash(path: string): string {
  return path.split(sep).join("/");
}

function repoPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  const index = parts.findIndex((part) => part === "aphrody-os" || part === "aphrody-infra");
  return index < 0 ? path : parts.slice(index + 1).join("/");
}

function currentOwner(path: string, manifestOwner: Owner): Owner {
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.includes("aphrody-os")) return "os";
  if (parts.includes("aphrody-infra")) return "infra";
  return manifestOwner;
}

export function syncManifest(
  source: string,
  manifestOwner: Owner,
  roots: Roots,
): { text: string; changes: string[]; missing: string[] } {
  const changes: string[] = [];
  const missing: string[] = [];
  const manifest = join(roots[manifestOwner], "Cargo.toml");
  const text = source.replace(
    /^(\s*([\w-]+)\s*=\s*\{[^\r\n]*?\bpath\s*=\s*")([^"]+)(")/gm,
    (line, before: string, name: string, oldPath: string, after: string) => {
      const owner = owners[name] ?? currentOwner(oldPath, manifestOwner);
      const suffix = repoPath(oldPath);
      const target = resolve(roots[owner], suffix);
      if (!existsSync(join(target, "Cargo.toml"))) {
        missing.push(`${name}: ${slash(target)}`);
        return line;
      }
      const newPath = slash(relative(dirname(manifest), target)) || ".";
      if (newPath !== oldPath) changes.push(`${name}: ${oldPath} -> ${newPath}`);
      return `${before}${newPath}${after}`;
    },
  );
  return { text, changes, missing };
}

/**
 * Point @aphrody/xai at the web layer's @aphrody/x (it re-exports XTools from there): the sibling
 * checkout path for development, or the version aphrody-web declares for a registry build.
 */
export function syncXaiPackage(
  source: string,
  roots: Roots,
  registry: boolean,
): { text: string; change?: string } {
  const manifest = join(roots.ai, "packages", "xai", "package.json");
  const packageManifest = join(roots.web, "packages", "x", "package.json");
  if (!existsSync(packageManifest)) throw new Error(`Missing package: ${slash(packageManifest)}`);
  const version = JSON.parse(readFileSync(packageManifest, "utf8")).version as string;
  const value = registry
    ? version
    : `file:${slash(relative(dirname(manifest), dirname(packageManifest)))}`;
  const matcher = /("@aphrody\/x"\s*:\s*")([^"]+)(")/;
  const match = source.match(matcher);
  if (!match) throw new Error(`Missing @aphrody/x dependency: ${slash(manifest)}`);
  return {
    text: source.replace(
      matcher,
      (_match, before: string, _old: string, after: string) => `${before}${value}${after}`,
    ),
    change: match[2] === value ? undefined : `@aphrody/x: ${match[2]} -> ${value}`,
  };
}

export async function runEcosystemDeps(args: string[]): Promise<number> {
  const arg = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const ai = resolve(arg("--ai-root") ?? process.env.APHRODY_AI_ROOT ?? process.cwd());
  const parent = dirname(ai);
  const roots: Roots = {
    ai,
    os: resolve(arg("--os-root") ?? process.env.APHRODY_OS_ROOT ?? join(parent, "aphrody-os")),
    infra: resolve(
      arg("--infra-root") ?? process.env.APHRODY_INFRA_ROOT ?? join(parent, "aphrody-infra"),
    ),
    web: resolve(arg("--web-root") ?? process.env.APHRODY_WEB_ROOT ?? join(parent, "aphrody-web")),
  };
  const write = args.includes("--write");
  const registry = args.includes("--registry");
  let failures = 0;
  const pending: Array<{ path: string; text: string }> = [];
  for (const owner of ["ai", "os", "infra"] as const) {
    const manifest = join(roots[owner], "Cargo.toml");
    if (!existsSync(manifest)) {
      console.error(`Missing manifest: ${slash(manifest)}`);
      failures++;
      continue;
    }
    const source = readFileSync(manifest, "utf8");
    const result = syncManifest(source, owner, roots);
    for (const missing of result.missing) console.error(`${owner}: missing ${missing}`);
    for (const change of result.changes) console.log(`${owner}: ${change}`);
    failures += result.missing.length;
    if (write && result.changes.length) pending.push({ path: manifest, text: result.text });
    else if (!write) failures += result.changes.length;
  }
  const xaiManifest = join(roots.ai, "packages", "xai", "package.json");
  try {
    const result = syncXaiPackage(readFileSync(xaiManifest, "utf8"), roots, registry);
    if (result.change) {
      console.log(`ai: ${result.change}`);
      if (write) pending.push({ path: xaiManifest, text: result.text });
      else failures++;
    }
  } catch (error) {
    console.error(String(error));
    failures++;
  }
  if (write && failures === 0) for (const entry of pending) writeFileSync(entry.path, entry.text);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await runEcosystemDeps(process.argv.slice(2)));
