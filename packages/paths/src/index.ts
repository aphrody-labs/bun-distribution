// SPDX-License-Identifier: Apache-2.0
import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ExternalCheckout = "aphrody-py" | "iecode" | "rg" | "source" | "bxc" | "yolo" | "m3" | "bun" | "material";

const rootMarkers = ["rust-toolchain.toml", "Cargo.toml", "package.json"] as const;
const envNames: Record<ExternalCheckout, readonly string[]> = {
  "aphrody-py": ["APHRODY_PY_ROOT"],
  iecode: ["APHRODY_IECODE_ROOT", "IECODE_ROOT", "NIE_ROOT"],
  rg: ["APHRODY_RG_ROOT", "RG_REPO_ROOT"],
  source: ["APHRODY_SOURCE_ROOT"],
  bxc: ["APHRODY_BXC_ROOT", "BXC_ROOT"],
  yolo: ["APHRODY_YOLO_ROOT", "YOLO_ROOT"],
  m3: ["APHRODY_MATERIAL_CHECKOUT", "APHRODY_M3_ROOT", "M3_ROOT"],
  material: ["APHRODY_MATERIAL_CHECKOUT", "APHRODY_M3_ROOT", "M3_ROOT"],
  bun: ["APHRODY_BUN_CHECKOUT"],
};

/** Find this Aphrody checkout by its root manifests, starting at a file or directory. */
export function findWorkspaceRoot(from?: string, env: Record<string, string | undefined> = process.env): string {
  const explicit = from === undefined && (env.APHRODY_WORKSPACE_ROOT?.trim() || env.APHRODY_ROOT?.trim());
  if (explicit) {
    const root = resolve(explicit);
    if (!isDirectory(root)) throw new Error(`Configured Aphrody root is not a directory: ${root}`);
    return root;
  }
  const start = from ?? process.cwd();
  let current = resolve(start);
  if (!existsSync(current) || !isDirectory(current)) current = dirname(current);
  while (true) {
    if (rootMarkers.every(marker => existsSync(join(current, marker)))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Aphrody workspace root not found above ${start}`);
    current = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve a repository-owned path without assuming the user's checkout location. */
export function workspacePath(...parts: string[]): string {
  return resolve(findWorkspaceRoot(), ...parts);
}

/** Resolve explicit checkouts first, then the selected workspace's source layout. */
export function checkoutRoot(
  checkout: ExternalCheckout,
  env: Record<string, string | undefined> = process.env,
): string {
  for (const name of envNames[checkout]) {
    const value = env[name]?.trim();
    if (value) return resolve(value);
  }
  const root = findWorkspaceRoot(undefined, env);
  const parent = dirname(root);
  switch (checkout) {
    case "aphrody-py":
      return existsSync(join(root, "py")) ? join(root, "py") : resolve(parent, "aphrody-py");
    case "iecode":
      return resolve(parent, "iecode");
    case "rg":
      return root;
    case "source":
      return resolve(root, ".cache", "upstream");
    case "bxc":
      return join(homedir(), "bxc");
    case "yolo":
      return resolve(parent, "yolo");
    case "m3":
    case "material":
      return resolve(parent, "material");
    case "bun":
      return isDirectory(join(root, "toolchains/bun")) ? join(root, "toolchains/bun") : resolve(parent, "bun");
  }
}

/** Root of the Rose Griffon website within the consolidated monorepo or legacy checkout. */
export function rgWebsiteRoot(): string {
  const override = process.env.RG_REPO_ROOT?.trim() || process.env.APHRODY_RG_ROOT?.trim();
  if (override) {
    const legacy = resolve(override, "apps", "website");
    return existsSync(legacy) ? legacy : resolve(override, "apps", "rg", "website");
  }
  return workspacePath("apps", "rg", "website");
}

/** Root of the Inazuma game checkout (`NIE_ROOT` remains a compatibility override). */
export function iecodeRoot(): string {
  return checkoutRoot("iecode");
}

/** Game data root, relocatable independently from the game source checkout. */
export function iecodeDataPath(...parts: string[]): string {
  const explicit = process.env.DATA_PATH?.trim() || process.env.DATA_ROOT?.trim() || process.env.NIE_DATA_ROOT?.trim();
  return resolve(explicit || checkoutPath("iecode", "data"), ...parts);
}

/** Inagle package root in either the consolidated Aphrody tree or legacy RG checkout. */
export function inagleRoot(): string {
  const legacy = process.env.RG_REPO_ROOT?.trim();
  if (legacy) {
    const oldLayout = resolve(legacy, "packages", "inagle");
    const currentLayout = resolve(legacy, "packages", "rg", "inagle");
    return existsSync(oldLayout) ? oldLayout : currentLayout;
  }
  const root = findWorkspaceRoot();
  const currentLayout = resolve(root, "packages", "rg", "inagle");
  return existsSync(currentLayout) ? currentLayout : resolve(root, "packages", "inagle");
}

/** Resolve under a sibling checkout. */
export function checkoutPath(checkout: ExternalCheckout, ...parts: string[]): string {
  return resolve(checkoutRoot(checkout), ...parts);
}

/** Resolve under the current account's home directory. */
export function homePath(...parts: string[]): string {
  return resolve(homedir(), ...parts);
}

/** Canonical user-owned agent plugin store, independent of any source checkout. */
export function pluginStorePath(...parts: string[]): string {
  return resolve(process.env.APHRODY_PLUGINS_ROOT?.trim() || statePath("plugins"), ...parts);
}

/** Resolve in the host's temporary directory (TMPDIR/TEMP aware). */
export function tempPath(...parts: string[]): string {
  return resolve(process.env.APHRODY_TMP_DIR?.trim() || tmpdir(), ...parts);
}

/** Resolve the shared Aphrody state root; matches the Rust APHRODY_HOME contract. */
export function statePath(...parts: string[]): string {
  const explicit = process.env.APHRODY_HOME?.trim();
  if (explicit) return resolve(explicit, ...parts);
  return homePath(".aphrody", ...parts);
}

/** Resolve in the host's cache directory. */
export function cachePath(...parts: string[]): string {
  const explicit = process.env.APHRODY_CACHE_DIR?.trim();
  if (explicit) return resolve(explicit, ...parts);
  if (process.platform === "win32")
    return resolve(process.env.LOCALAPPDATA || homePath("AppData", "Local"), "Aphrody", "cache", ...parts);
  if (process.platform === "darwin") return homePath("Library", "Caches", "Aphrody", ...parts);
  return resolve(process.env.XDG_CACHE_HOME || homePath(".cache"), "aphrody", ...parts);
}

/** Read the host/user environment home, including Windows USERPROFILE fallback. */
export function userHome(): string {
  return homedir();
}

/** Convert a platform path to a stable slash-separated representation for manifests. */
export function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

// Keep an eager module URL helper available to callers that are launched outside cwd.
export function moduleDirectory(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl));
}
