#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Prepares the per-host BXC cookie store (docs/operations/infra/COOKIE-OPERATIONS.md):
 *
 *   bun --no-env-file scripts/tools/secure-cookie-layout.ts [--home <dir>] [--dir <cookies>]
 *
 * Creates `<APHRODY_HOME>/cookies` (or `--dir`), restricts it to the current user (protected
 * DACL through bun:ffi on Windows, mode 0700 elsewhere) and, on Windows, persists
 * `APHRODY_HOME` and `BXC_COOKIES_DIR` in the user environment. Elsewhere the two assignments
 * are printed for the host profile or unit. Cookie files are never opened.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type CookieLayout = { home: string; cookies: string };

const same = (a: string, b: string) =>
  process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

/**
 * Explicit options first, then `APHRODY_HOME`/`BXC_COOKIES_DIR`, then `~/.aphrody/cookies`.
 * An explicit directory that disagrees with an exported `BXC_COOKIES_DIR` is ambiguous.
 */
export function cookieLayout(
  options: { home?: string; dir?: string },
  env: NodeJS.ProcessEnv = process.env,
): CookieLayout {
  const home = options.home ?? env.APHRODY_HOME ?? join(homedir(), ".aphrody");
  const cookies = resolve(options.dir ?? env.BXC_COOKIES_DIR ?? join(home, "cookies"));
  if (env.BXC_COOKIES_DIR && !same(env.BXC_COOKIES_DIR, cookies))
    throw new Error("BXC_COOKIES_DIR désigne un autre répertoire ; ambiguïté refusée.");
  return { home, cookies };
}

/**
 * Creates the store with owner-only access and, on Windows, persists the layout in the user
 * environment unless `persist` is false. Returns the applied Windows SDDL, if any.
 */
export async function secureCookieStore(
  layout: CookieLayout,
  persist = true,
): Promise<string | null> {
  mkdirSync(layout.cookies, { recursive: true });
  if (process.platform !== "win32") {
    chmodSync(layout.cookies, 0o700);
    return null;
  }
  const { restrictToCurrentUser, setUserEnvironment } = await import("./infra/win32-user.ts");
  const sddl = restrictToCurrentUser(layout.cookies, true);
  if (persist) setUserEnvironment({ APHRODY_HOME: layout.home, BXC_COOKIES_DIR: layout.cookies });
  return sddl;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { home: { type: "string" }, dir: { type: "string" } } });
  try {
    const layout = cookieLayout(values);
    await secureCookieStore(layout);
    console.log(`APHRODY_HOME=${layout.home}`);
    console.log(`BXC_COOKIES_DIR=${layout.cookies}`);
    console.log("Cookie values were not read or copied.");
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
