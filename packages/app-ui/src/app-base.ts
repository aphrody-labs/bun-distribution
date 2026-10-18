// SPDX-License-Identifier: Apache-2.0
/** Deployment prefixes are local directory paths, never origins or traversal paths. */
export function normalizeAppBase(value: string): string {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) {
    throw new Error(
      "App UI base must be an absolute directory path, for example /workspace/",
    );
  }
  return value;
}

/** The generated HTML base and the router share one deployment prefix. */
export function appBasePath(
  baseURI = typeof document === "undefined"
    ? "http://localhost/"
    : document.baseURI,
): string {
  return normalizeAppBase(new URL(baseURI).pathname);
}
