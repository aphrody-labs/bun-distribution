// SPDX-License-Identifier: Apache-2.0
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith("../") &&
    !path.startsWith("..\\") &&
    !isAbsolute(path)
  );
}

/** Serve only existing files in the public dist tree, including symlink resolution. */
export async function resolvePublicAsset(
  root: string,
  requestPath: string,
): Promise<string | null> {
  try {
    const decoded = decodeURIComponent(requestPath);
    if (isAbsolute(decoded) || decoded.includes("\0")) return null;
    const base = resolve(root);
    const candidate = resolve(base, decoded);
    if (!contained(base, candidate)) return null;
    const [canonicalBase, canonicalFile] = await Promise.all([realpath(base), realpath(candidate)]);
    if (!contained(canonicalBase, canonicalFile) || !(await stat(canonicalFile)).isFile())
      return null;
    return canonicalFile;
  } catch {
    return null;
  }
}
