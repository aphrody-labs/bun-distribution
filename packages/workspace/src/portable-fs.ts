// SPDX-License-Identifier: Apache-2.0
import { lstat, rename, unlink } from "node:fs/promises";

/** POSIX permission bits are synthesized on Windows (always 0o666/0o444), so mode checks only apply elsewhere. */
export const POSIX_MODES = process.platform !== "win32";

/** True when `mode` carries exactly `expected` permission bits, or when the platform has no POSIX modes. */
export function hasMode(mode: number, expected: number): boolean {
  return !POSIX_MODES || (mode & 0o777) === expected;
}

/** True when group/other bits are clear, or when the platform has no POSIX modes. */
export function isOwnerOnly(mode: number): boolean {
  return !POSIX_MODES || (mode & 0o077) === 0;
}

/**
 * Rename `temporary` (a fresh symlink) over the existing symlink `pointer`. POSIX does this atomically;
 * Windows refuses to rename over a directory link (EPERM), so the old link is unlinked first there.
 */
export async function replaceSymlink(temporary: string, pointer: string): Promise<void> {
  try {
    await rename(temporary, pointer);
  } catch (error) {
    if (POSIX_MODES || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    if (!(await lstat(pointer)).isSymbolicLink()) throw error;
    await unlink(pointer);
    await rename(temporary, pointer);
  }
}

/** True when `uid` is the current user's, or when the platform has no POSIX owners (Windows reports uid 0). */
export function isOwnedByCurrentUser(uid: number): boolean {
  return !process.getuid || uid === process.getuid();
}
