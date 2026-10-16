import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CREATOR_APP, type AppIdentity } from "./update.ts";

export function crashLogPath(
  env: Record<string, string | undefined> = process.env,
  app: AppIdentity = CREATOR_APP,
): string {
  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), ".cache");
  return join(base, app.name, "crash.log");
}

/** Append the error to the crash log and return the log path ("" when it cannot be written). */
export function logCrash(
  error: unknown,
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
  app: AppIdentity = CREATOR_APP,
): string {
  const path = crashLogPath(env, app);
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `[${new Date().toISOString()}] ${app.name} ${app.version} ${process.platform}-${process.arch} args=${JSON.stringify(argv)}\n${text}\n\n`,
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
