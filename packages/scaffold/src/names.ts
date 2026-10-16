// SPDX-License-Identifier: Apache-2.0
/** Name derivation shared by every generated project. */

/** Lowercase ASCII words joined by single hyphens; never empty. */
export function slug(text: string): string {
  const out = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "app";
}

/** Valid Cargo package name: starts with a letter. */
export function crateName(name: string): string {
  const value = slug(name);
  return /^[a-z]/.test(value) ? value : `app-${value}`;
}

/** npm package name for a directory: lowercase `[a-z0-9._-]`, no leading or trailing separator; `null` when nothing is left. */
export function npmName(text: string): string | null {
  const out = text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return out || null;
}

/** Reverse-DNS Tauri identifier `<prefix>.<segment>`; a segment never starts with a digit. */
export function tauriIdentifier(
  seed: string,
  prefix = "io.aphrody.app",
): string {
  const segment = slug(seed).replace(/^(\d)/, "s$1");
  return `${prefix}.${segment}`;
}
