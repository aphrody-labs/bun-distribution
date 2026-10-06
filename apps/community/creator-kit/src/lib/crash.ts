import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { VERSION } from "./update.ts";

export function crashLogPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), ".cache");
  return join(base, "creator-kit", "crash.log");
}

/** Append the error to the crash log and return the log path ("" when it cannot be written). */
export function logCrash(
  error: unknown,
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
): string {
  const path = crashLogPath(env);
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `[${new Date().toISOString()}] creator-kit ${VERSION} ${process.platform}-${process.arch} args=${JSON.stringify(argv)}\n${text}\n\n`,
    );
    return path;
  } catch {
    return "";
  }
}

/** Split a command line typed in the interactive prompt (double quotes group words, no escapes). */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line))
    out.push(match[1] ?? match[2] ?? "");
  return out;
}
