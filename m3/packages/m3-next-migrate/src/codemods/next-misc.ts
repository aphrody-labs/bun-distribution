// SPDX-License-Identifier: Apache-2.0
// The rest of the Next 14/15 -> 16 changes that are mechanical: the legacy image import and package.json.
import { type CodemodResult, unchanged } from "./types";

/** `next/legacy/image` is gone: `next/image` is the only image component. */
export function legacyImage(source: string): CodemodResult {
  if (!/["']next\/legacy\/image["']/.test(source)) return unchanged(source);
  const code = source.replace(/(["'])next\/legacy\/image\1/g, "$1next/image$1");
  const warnings: string[] = [];
  if (
    /\blayout\s*=/.test(code) ||
    /\bobjectFit\s*=/.test(code) ||
    /\bobjectPosition\s*=/.test(code)
  )
    warnings.push(
      "the legacy layout, objectFit and objectPosition props are gone: use `fill` or width and height, and the style or className for fit",
    );
  return { code, changes: ["next/legacy/image -> next/image"], warnings };
}

/** Versions a Next 16 app targets. */
export const TARGET_VERSIONS: Record<string, string> = {
  next: "^16.0.0",
  react: "^19.2.0",
  "react-dom": "^19.2.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
  "eslint-config-next": "^16.0.0",
};

/** package.json for Next 16: dependency versions, `next lint` and the `--turbo` flags. */
export function packageJsonTo16(source: string): CodemodResult {
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(source);
  } catch {
    return { code: source, changes: [], warnings: ["package.json is not valid JSON"] };
  }
  if (!pkg.dependencies?.["next"] && !pkg.devDependencies?.["next"]) return unchanged(source);
  const changes: string[] = [];
  const warnings: string[] = [];
  for (const group of [pkg.dependencies, pkg.devDependencies]) {
    if (!group) continue;
    for (const [name, version] of Object.entries(TARGET_VERSIONS)) {
      if (
        group[name] !== undefined &&
        group[name] !== version &&
        !/^(workspace:|catalog:|npm:|file:|link:)/.test(group[name]!)
      ) {
        changes.push(`${name} ${group[name]} -> ${version}`);
        group[name] = version;
      }
    }
  }
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    let next = script;
    if (/\bnext\s+lint\b/.test(next)) {
      next = next.replace(/\bnext\s+lint\b[^&|;]*/, "oxlint .");
      warnings.push(
        `script ${name}: \`next lint\` is removed in Next 16; it now runs oxlint (use eslint if the project is configured for it)`,
      );
    }
    next = next.replace(/(\bnext\s+(?:dev|build))\s+--turbo(?:pack)?\b/g, "$1");
    if (next !== script) {
      pkg.scripts![name] = next;
      changes.push(`script ${name}: ${script} -> ${next}`);
    }
  }
  if (changes.length === 0 && warnings.length === 0) return unchanged(source);
  const indent = /^\{\n([ \t]+)/.exec(source)?.[1] ?? "  ";
  const text = JSON.stringify(pkg, null, indent) + (source.endsWith("\n") ? "\n" : "");
  return { code: text, changes, warnings };
}
