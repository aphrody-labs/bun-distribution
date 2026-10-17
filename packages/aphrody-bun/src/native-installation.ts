// SPDX-License-Identifier: Apache-2.0
import { suffix } from "bun:ffi";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

function ownerControlled(path: string): void {
  const info = statSync(path);
  const uid = process.getuid?.();
  if ((uid !== undefined && info.uid !== uid) || (info.mode & 0o022) !== 0)
    throw new Error(`Installed Aphrody path is not owner-controlled: ${path}`);
}

/** The Unix package installer owns this exact alias. Never search PATH, other
 * multicall aliases, checkout targets or unrelated SDK installations. Native
 * artifact provenance, hash, target and ABI are verified before dlopen. */
export function resolveInstalledNativeLibraryPath(home = homedir()): string | undefined {
  if (process.platform === "win32") return undefined;
  const alias = join(home, ".local", "bin", "aphrody");
  if (!existsSync(alias)) return undefined;
  if (!lstatSync(alias).isSymbolicLink())
    throw new Error(`Installed Aphrody alias is not a package-owned symlink: ${alias}`);
  ownerControlled(dirname(alias));
  const binary = realpathSync(alias);
  if (basename(binary) !== "aphrody" || !statSync(binary).isFile())
    throw new Error(`Installed Aphrody alias selects an unexpected binary: ${alias}`);
  const directory = dirname(binary);
  ownerControlled(directory);
  ownerControlled(binary);
  const artifact = join(directory, `libaphrody_ffi.${suffix}`);
  if (!existsSync(artifact)) return undefined;
  // The companion must belong to this pin, not point into another version.
  if (!lstatSync(artifact).isFile()) throw new Error(`Installed Aphrody companion is not a regular file: ${artifact}`);
  ownerControlled(artifact);
  const manifest = join(directory, "manifest.json");
  if (!existsSync(manifest) || !lstatSync(manifest).isFile())
    throw new Error(`Installed Aphrody companion manifest is missing or invalid: ${manifest}`);
  ownerControlled(manifest);
  return artifact;
}
