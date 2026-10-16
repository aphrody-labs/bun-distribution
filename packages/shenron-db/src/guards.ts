// Source: packages/shenron/db/src/guards.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Databooks freeze gate (S11). Synchronous so scripts can call it before any
 * write. Runtime class: `server`.
 *
 * - null path in production: frozen (fail closed, `DATABOOKS_FREEZE_FILE non configuré`);
 * - null path outside production: free;
 * - absent file: free;
 * - file containing JSON with `frozen === false`: free (escape hatch);
 * - any other content, or an unreadable file: frozen, reason read from
 *   `reason` / `raison` / `motif` / `message`, else the raw text.
 */
import { existsSync, readFileSync } from "node:fs";

export const DATABOOKS_FREEZE_EXIT_CODE = 3;

export type FreezeState = { frozen: false } | { frozen: true; reason: string; path: string | null };
export type FrozenState = Extract<FreezeState, { frozen: true }>;

export interface FreezeFs {
  exists(path: string): boolean;
  read(path: string): string;
}

const DEFAULT_REASON = "gel actif (raison non précisée)";
export const MISSING_FREEZE_FILE_REASON = "DATABOOKS_FREEZE_FILE non configuré";

export class DatabooksFrozenError extends Error {
  readonly code = "DATABOOKS_FROZEN" as const;
  readonly freeze: FrozenState;
  constructor(freeze: FrozenState) {
    super(`Écritures databooks gelées : ${freeze.reason}`);
    this.name = "DatabooksFrozenError";
    this.freeze = freeze;
  }
}

const nodeFs: FreezeFs = {
  exists: path => existsSync(path),
  read: path => readFileSync(path, "utf8"),
};

/** Reason extraction identical to `apps/shenron/site/src/lib/databooks-freeze.ts`. */
export function freezeReason(raw: string): string {
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    const candidate =
      value && typeof value === "object" ? (value.reason ?? value.raison ?? value.motif ?? value.message) : undefined;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : raw.trim() || DEFAULT_REASON;
  } catch {
    return raw.trim() || DEFAULT_REASON;
  }
}

function isExplicitlyUnfrozen(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).frozen === false
    );
  } catch {
    return false;
  }
}

export function createDatabooksFreezeGate(options: { freezeFile: string | null; production: boolean; fs?: FreezeFs }): {
  state(): FreezeState;
  assertWritable(): void;
} {
  const fs = options.fs ?? nodeFs;
  const path = options.freezeFile && options.freezeFile.trim() ? options.freezeFile : null;

  const state = (): FreezeState => {
    if (path === null) {
      return options.production ? { frozen: true, reason: MISSING_FREEZE_FILE_REASON, path: null } : { frozen: false };
    }
    let exists: boolean;
    try {
      exists = fs.exists(path);
    } catch {
      return { frozen: true, reason: DEFAULT_REASON, path };
    }
    if (!exists) return { frozen: false };
    let raw: string;
    try {
      raw = fs.read(path);
    } catch {
      // Fail closed: an unreadable freeze file is still a freeze.
      return { frozen: true, reason: DEFAULT_REASON, path };
    }
    if (isExplicitlyUnfrozen(raw)) return { frozen: false };
    return { frozen: true, reason: freezeReason(raw), path };
  };

  return {
    state,
    assertWritable() {
      const current = state();
      if (current.frozen) throw new DatabooksFrozenError(current);
    },
  };
}
