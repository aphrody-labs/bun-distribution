// SPDX-License-Identifier: Apache-2.0
/**
 * Native privilege elevation and verification layer for YOLO (Bun / TypeScript).
 *
 * Implements strict NHITL (No-Human-In-The-Loop) execution doctrine:
 * checks effective UID / token elevation without blocking, probes passwordless
 * non-interactive `sudo -n`, and wraps commands automatically.
 */
import { dlopen, FFIType } from "bun:ffi";

export interface ElevationState {
  readonly isElevated: boolean;
  readonly canSudo: boolean;
  readonly uid: number | null;
  readonly euid: number | null;
  readonly platform: string;
}

let nativeGeteuid: (() => number) | null = null;
let nativeGetuid: (() => number) | null = null;

if (process.platform !== "win32") {
  try {
    const libc = dlopen("libc.so.6", {
      geteuid: { args: [], returns: FFIType.u32 },
      getuid: { args: [], returns: FFIType.u32 },
    });
    nativeGeteuid = libc.symbols.geteuid;
    nativeGetuid = libc.symbols.getuid;
  } catch {
    // Fall back to process.geteuid or process.getuid if available
  }
}

/**
 * Checks whether the current process is running with elevated privileges (root or Administrator).
 * Calls libc `geteuid` through FFI on Unix when available.
 */
export function isElevated(): boolean {
  if (process.platform === "win32") {
    try {
      const proc = Bun.spawnSync(["net", "session"], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  if (nativeGeteuid) {
    return nativeGeteuid() === 0;
  }
  if (typeof process.geteuid === "function") {
    return process.geteuid() === 0;
  }
  return false;
}

/**
 * Probes whether passwordless, non-interactive sudo (`sudo -n true`) is available.
 * Essential for NHITL execution without hanging on password prompts.
 */
export function canSudoNonInteractive(): boolean {
  if (isElevated()) return true;
  if (process.platform === "win32") return false;

  try {
    const proc = Bun.spawnSync(["sudo", "-n", "true"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Returns full elevation state for the current process.
 */
export function getElevationState(): ElevationState {
  const elevated = isElevated();
  const uid = nativeGetuid
    ? nativeGetuid()
    : typeof process.getuid === "function"
      ? process.getuid()
      : null;
  const euid = nativeGeteuid
    ? nativeGeteuid()
    : typeof process.geteuid === "function"
      ? process.geteuid()
      : null;

  return {
    isElevated: elevated,
    canSudo: elevated || canSudoNonInteractive(),
    uid,
    euid,
    platform: process.platform,
  };
}

/**
 * Wraps a command and its arguments to run with elevated privileges without interactive prompting.
 * If already elevated, leaves the command unchanged.
 * On Unix, if not elevated, wraps with `sudo -n`.
 */
export function wrapElevatedCommand(
  program: string,
  args: readonly string[] = [],
): { program: string; args: string[] } {
  if (isElevated()) {
    return { program, args: [...args] };
  }

  if (process.platform !== "win32") {
    return {
      program: "sudo",
      args: ["-n", program, ...args],
    };
  }

  return { program, args: [...args] };
}
