// Source: packages/shenron/db/src/env.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * DATABASE_URL loading for scripts. Runtime class: `server`.
 *
 * The environment wins; otherwise each fallback file is read (inside the call)
 * and, within a file, the LAST active `NAME=` line wins — a decommissioned URL
 * left above the live one must never be picked. The value is validated by
 * `resolveDatabaseUrl` and is never logged nor echoed in a failure reason.
 */
import { readFileSync } from "node:fs";
import { lastAssignment } from "@aphrody/sql/env";
import { type EnvSource, resolveDatabaseUrl } from "./config";

/** Last active `NAME=value` of a dotenv text; shared parser of `@aphrody/sql/env`. */
export { lastAssignment };

export type DatabaseUrlSource = { kind: "env"; name: string } | { kind: "file"; path: string; varName: string };

export type LoadDatabaseUrlResult =
  { ok: true; url: string; source: DatabaseUrlSource } | { ok: false; reason: string };

export interface LoadDatabaseUrlOptions {
  env?: EnvSource;
  /** Variable names tried in order. Default `["DATABASE_URL"]`. */
  varNames?: readonly string[];
  /** Dotenv-style files tried in order after the environment. */
  fallbackFiles?: readonly { path: string; varName?: string }[];
}

function validate(raw: string): string | null {
  try {
    return resolveDatabaseUrl(raw);
  } catch {
    return null;
  }
}

export function loadDatabaseUrl(options: LoadDatabaseUrlOptions = {}): LoadDatabaseUrlResult {
  const env = options.env ?? process.env;
  const varNames = options.varNames?.length ? options.varNames : ["DATABASE_URL"];
  const rejected: string[] = [];

  for (const name of varNames) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const url = validate(raw);
    if (url) return { ok: true, url, source: { kind: "env", name } };
    rejected.push(`env ${name} invalide`);
  }

  for (const file of options.fallbackFiles ?? []) {
    let text: string;
    try {
      text = readFileSync(file.path, "utf8");
    } catch {
      continue; // missing or unreadable file: ignored
    }
    const names = file.varName ? [file.varName] : varNames;
    for (const varName of names) {
      const raw = lastAssignment(text, varName);
      if (raw === undefined || raw === "") continue;
      const url = validate(raw);
      if (url) return { ok: true, url, source: { kind: "file", path: file.path, varName } };
      rejected.push(`${file.path}:${varName} invalide`);
    }
  }

  const tried = varNames.join(", ");
  return {
    ok: false,
    reason: rejected.length
      ? `URL PostgreSQL invalide (${rejected.join("; ")}) : une URL postgres:// est requise.`
      : `Aucune URL PostgreSQL trouvée (${tried}).`,
  };
}
