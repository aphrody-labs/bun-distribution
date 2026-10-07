// SPDX-License-Identifier: Apache-2.0
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Remove anything that looks like a secret before text is logged, displayed or sent to the team. */
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      "[CLE PRIVEE MASQUEE]",
    )
    .replace(/(PrivateKey|PresharedKey)(\s*[=:]\s*)\S+/gi, "$1$2[MASQUE]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[JETON MASQUE]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[JETON MASQUE]")
    .replace(/(Authorization:\s*(?:Bearer|token)\s+)\S+/gi, "$1[MASQUE]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[MASQUE]@");
}

export interface Logger {
  (line: string): void;
  file: string;
}

/** Append-only log of what the kit did (never secrets: every line goes through `redact`). */
export function createLogger(file: string, now: () => Date = () => new Date()): Logger {
  const log = ((line: string) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `[${now().toISOString()}] ${redact(line)}\n`);
    } catch {
      // the log must never stop the kit
    }
  }) as Logger;
  log.file = file;
  return log;
}

export const noLog: Logger = Object.assign(() => undefined, { file: "" }) as Logger;
