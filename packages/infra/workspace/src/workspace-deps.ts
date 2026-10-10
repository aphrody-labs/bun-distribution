// SPDX-License-Identifier: Apache-2.0
/**
 * Keep Bun workspace dependencies right when packages move between aphrody and aphrody-os.
 *
 *   bun scripts/fix-workspace-deps.ts --root <repo> --sibling <repo> [--apply]
 *
 * A `workspace:` dependency of a member of `root` that now lives in `sibling`'s workspace cannot
 * stay a dependency: Bun installs neither `workspace:` nor `file:` packages across workspace
 * roots when they carry their own `workspace:` / `catalog:` dependencies. The dependency is
 * removed and the member's tsconfig.json gains `paths` aliases to the sibling package's source,
 * which Bun honours at run time; the sibling's own dependencies resolve from its node_modules.
 * Dry run by default. Indentation and line endings are preserved.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** Workspace members of a repository: package name -> directory. */
function members(repo: string): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const globs: string[] = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const found = new Map<string, string>();
  for (const pattern of globs) {
    for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync({
      cwd: repo,
      onlyFiles: true,
    })) {
      if (file.includes("node_modules")) continue;
      const pkg = JSON.parse(readFileSync(join(repo, file), "utf8"));
      if (pkg.name) found.set(pkg.name, join(repo, dirname(file)));
    }
  }
  return found;
}

/** Entry file of a package, relative to its directory. */
function entry(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const candidates = [
    pkg.exports?.["."]?.import,
    pkg.exports?.["."]?.default,
    typeof pkg.exports === "string" ? pkg.exports : undefined,
    pkg.module,
    pkg.main,
    "src/index.ts",
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && existsSync(join(dir, candidate)))
      return candidate.replace(/^\.\//, "");
  }
  return "src/index.ts";
}

function write(path: string, text: string, value: unknown) {
  const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(path, JSON.stringify(value, null, indent).replaceAll("\n", eol) + eol);
}

const fwd = (p: string) => p.replaceAll("\\", "/");

export async function runWorkspaceDeps(args: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = flag("--root");
  const sibling = flag("--sibling");
  const apply = args.includes("--apply");
  if (!root || !sibling) {
    console.error("usage: yolo ops workspace-deps --root <repo> --sibling <repo> [--apply]");
    return 2;
  }
  const local = members(root);
  const remote = members(sibling);
  const SECTIONS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const;
  const changes: string[] = [];

  for (const [name, dir] of local) {
    const manifestPath = join(dir, "package.json");
    const manifestText = readFileSync(manifestPath, "utf8");
    const pkg = JSON.parse(manifestText);
    const moved: string[] = [];
    for (const section of SECTIONS) {
      for (const [dep, spec] of Object.entries<string>(pkg[section] ?? {})) {
        if (
          (spec.startsWith("workspace:") || spec.startsWith("file:")) &&
          !local.has(dep) &&
          remote.has(dep)
        ) {
          delete pkg[section][dep];
          moved.push(dep);
          changes.push(
            `${name}: ${section}.${dep} (${spec}) removed; resolved through tsconfig paths`,
          );
        }
      }
    }
    if (moved.length === 0) continue;
    const tsconfigPath = join(dir, "tsconfig.json");
    let tsconfig: { text: string; value: any } | undefined;
    if (existsSync(tsconfigPath)) {
      const text = readFileSync(tsconfigPath, "utf8");
      try {
        tsconfig = { text, value: JSON.parse(text) };
      } catch {
        changes.push(
          `${name}: tsconfig.json is not plain JSON; add the paths by hand for ${moved.join(", ")}`,
        );
      }
    } else {
      changes.push(`${name}: no tsconfig.json; add one with paths for ${moved.join(", ")}`);
    }
    if (tsconfig) {
      const options = (tsconfig.value.compilerOptions ??= {});
      const paths = (options.paths ??= {});
      for (const dep of moved) {
        const target = fwd(relative(dir, remote.get(dep)!));
        const main = entry(remote.get(dep)!);
        const srcDir = dirname(main) === "." ? "" : `${dirname(main)}/`;
        paths[dep] = [`${target}/${main}`];
        paths[`${dep}/*`] = [`${target}/${srcDir}*`];
        changes.push(`${name}: tsconfig paths ${dep} -> ${target}/${main}`);
      }
    }
    if (apply) {
      write(manifestPath, manifestText, pkg);
      if (tsconfig) write(tsconfigPath, tsconfig.text, tsconfig.value);
    }
  }

  for (const change of changes) console.log(`dependency\t${change}`);
  console.log(
    `${changes.length} dependency change(s)${apply || changes.length === 0 ? "" : " (dry run: pass --apply)"}`,
  );
  return 0;
}

if (import.meta.main) process.exit(await runWorkspaceDeps(process.argv.slice(2)));
