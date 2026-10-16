// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const PRIVATE_OWNER_ROOT = resolve(import.meta.dir, "../../..");

/** Private packages resolve only in their declared source owner workspace. */
export function assertPrivateOwnerWorkspace(outDir: string): void {
  const manifest = JSON.parse(
    readFileSync(resolve(PRIVATE_OWNER_ROOT, "package.json"), "utf8"),
  ) as {
    name: string;
    private?: boolean;
    workspaces?: { packages?: string[] };
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
  const destination = relative(PRIVATE_OWNER_ROOT, resolve(outDir)).replaceAll(
    "\\",
    "/",
  );
  const patterns = manifest.workspaces?.packages ?? [];
  const included = patterns.some(
    (pattern) =>
      !pattern.startsWith("!") && new Bun.Glob(pattern).match(destination),
  );
  const excluded = patterns.some(
    (pattern) =>
      pattern.startsWith("!") &&
      new Bun.Glob(pattern.slice(1)).match(destination),
  );
  let existing = resolve(outDir);
  while (!existsSync(existing)) existing = dirname(existing);
  const canonical = relative(
    realpathSync(PRIVATE_OWNER_ROOT),
    realpathSync(existing),
  );
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
