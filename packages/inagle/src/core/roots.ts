// SPDX-License-Identifier: MIT
/**
 * Checkout roots shared by the inagle/azalee CLIs and maintenance scripts.
 *
 * Bun OS owns the IEVR libraries and game data; Rose Griffon product apps live
 * in the separate `aphrody-labs/rosegriffon` repository. The checkouts are
 * siblings (`../iecode` and `../rosegriffon`). Environment overrides keep
 * relocated or legacy checkouts working without hard-coded host paths.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return path.resolve(value);
  }
  return undefined;
}

function moduleDir(): string {
  return typeof import.meta.dir === "string" ? import.meta.dir : path.dirname(fileURLToPath(import.meta.url));
}

/** IECODE checkout root (`packages/inagle/src/core` → four levels up). */
export function iecodeRoot(): string {
  return (
    firstEnv(["APHRODY_IECODE_ROOT", "IECODE_ROOT", "NIE_ROOT", "NIERS_ROOT"]) ??
    path.resolve(moduleDir(), "../../../..")
  );
}

/** Path inside the IECODE checkout. */
export function iecodePath(...parts: string[]): string {
  return path.join(iecodeRoot(), ...parts);
}

/** IECODE game data root (`<iecode>/data`), relocatable on its own. */
export function iecodeDataRoot(): string {
  return firstEnv(["DATA_ROOT", "DATA_PATH", "NIE_DATA_ROOT"]) ?? path.join(iecodeRoot(), "data");
}

/** Path inside the IECODE game data root. */
export function iecodeDataPath(...parts: string[]): string {
  return path.join(iecodeDataRoot(), ...parts);
}

/** Rose Griffon source root: the canonical repository sibling or a legacy checkout. */
export function rgRoot(): string {
  return firstEnv(["APHRODY_RG_ROOT", "RG_REPO_ROOT"]) ?? path.resolve(iecodeRoot(), "../rosegriffon");
}

/** Rose Griffon website root in the canonical repository, with the old layout as a fallback. */
export function rgWebsiteRoot(): string {
  const root = rgRoot();
  const current = path.join(root, "apps", "rg-website");
  const legacy = path.join(root, "apps", "website");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

/** Path inside the Rose Griffon website root. */
export function rgWebsitePath(...parts: string[]): string {
  return path.join(rgWebsiteRoot(), ...parts);
}

/** Current user's home directory, without assuming a host account name. */
export function userHome(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir();
}
