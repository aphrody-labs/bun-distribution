// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const PRIVATE_OWNER_ROOT = resolve(import.meta.dir, "../../..");
/** The repository that folds the M3 owner into its single Bun workspace (`m3/packages/app-ui/showcase/*`, ...). */
const REPOSITORY_ROOT = resolve(PRIVATE_OWNER_ROOT, "..");

/** Private packages resolve only in their declared source owner workspace. */
export function assertPrivateOwnerWorkspace(outDir: string): void {
  const manifest = JSON.parse(
    readFileSync(resolve(PRIVATE_OWNER_ROOT, "package.json"), "utf8"),
  ) as {
    name: string;
    private?: boolean;
  };
  const requiredOwners = ["m3", "m3-bun", "m3-config", "m3-next-migrate"];
  if (
    manifest.name !== "aphrody-m3" ||
    manifest.private !== true ||
    !requiredOwners.every((name) =>
      existsSync(resolve(PRIVATE_OWNER_ROOT, "packages", name, "package.json")),
    )
  )
    throw new Error(
      "Aphrody/M3 private owner workspace required; qualify native SDK source acquisition before scaffolding elsewhere",
    );
  const workspace = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8")) as {
    workspaces?: { packages?: string[] };
  };
  const destination = relative(REPOSITORY_ROOT, resolve(outDir)).replaceAll("\\", "/");
  const destinationInOwner = relative(PRIVATE_OWNER_ROOT, resolve(outDir)).replaceAll("\\", "/");
  const patterns = workspace.workspaces?.packages ?? [];
  // The root declares only the committed apps (stray `m3/apps/*` directories must not join `bun install`),
  // so a new direct `apps/*` child of the owner is its app slot even before it is declared.
  const included =
    new Bun.Glob("apps/*").match(destinationInOwner) ||
    patterns.some(
      (pattern) =>
        !pattern.startsWith("!") &&
        (new Bun.Glob(pattern).match(destination) ||
          new Bun.Glob(pattern).match(destinationInOwner)),
    );
  const excluded = patterns.some(
    (pattern) =>
      pattern.startsWith("!") &&
      (new Bun.Glob(pattern.slice(1)).match(destination) ||
        new Bun.Glob(pattern.slice(1)).match(destinationInOwner)),
  );
  let existing = resolve(outDir);
  while (!existsSync(existing)) existing = dirname(existing);
  const canonical = relative(realpathSync(PRIVATE_OWNER_ROOT), realpathSync(existing));
  if (
    !destination ||
    !included ||
    excluded ||
    isAbsolute(canonical) ||
    canonical === ".." ||
    canonical.startsWith(`..${sep}`)
  )
    throw new Error(
      "Aphrody/M3 private owner workspace required; choose a direct declared apps/* member and preserve the private source owner",
    );
}

export function assertNativeShellOwner(target: "tauri" | "vite"): void {
  if (target === "tauri")
    throw new Error(
      "A canonical registered Aphrody Rust shell owner and Workspace build factory are required before Tauri activation; use the native Bun web target to inspect frontend behavior",
    );
}
