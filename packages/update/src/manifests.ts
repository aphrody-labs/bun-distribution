// SPDX-License-Identifier: Apache-2.0
/** First-party workspace manifests, shared by the update planner and the Workspace gates. */
import { Glob } from "bun";
import { join } from "node:path";

/** Imported upstream packages: workspace members that keep their upstream manifests. */
export const UPSTREAM = ["packages/aphrody-spaceui/", "third_party/"];

/** Manifests actually selected by the root Bun workspace globs, inside this repository: members
 *  linked from a sibling checkout (`../bun/...`) follow the contract of the repository that owns them. */
export async function firstPartyManifests(repo: string, patternsOverride?: readonly string[]): Promise<string[]> {
  const root = await Bun.file(join(repo, "package.json")).json();
  const patterns: readonly string[] =
    patternsOverride ?? (Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? []));
  const includes = patterns.filter(pattern => !pattern.startsWith("!"));
  const excludes = patterns
    .filter(pattern => pattern.startsWith("!"))
    .map(pattern => new Glob(`${pattern.slice(1).replace(/\/$/, "")}/package.json`));
  const found = await Promise.all(
    includes.map(async pattern => {
      const manifestPattern = `${pattern.replace(/\/$/, "")}/package.json`;
      if (!/[?*{[]/.test(pattern)) {
        return (await Bun.file(join(repo, manifestPattern)).exists()) ? [manifestPattern] : [];
      }
      return Array.fromAsync(new Glob(manifestPattern).scan({ cwd: repo, onlyFiles: true }));
    }),
  );
  return [...new Set(found.flat().map(path => path.replaceAll("\\", "/")))]
    .filter(path => !path.startsWith("../"))
    .filter(path => !excludes.some(exclude => exclude.match(path)))
    .filter(path => !UPSTREAM.some(prefix => path.startsWith(prefix)))
    .toSorted();
}
