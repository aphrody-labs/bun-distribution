// SPDX-License-Identifier: Apache-2.0
/**
 * Platform layout inside the Bun OS root (`usr/`, the bep root of packages/bun-engine/src/usr.ts):
 *   usr/share/bun-os/locale/<tag>/*.ftl   installed or overriding catalogs
 *   usr/share/bun-os/themes/*.{json,toml,css}   installed themes
 *   usr/lib/bun-os/plugins/<name>/plugin.json   plugin discovery
 *   usr/etc/bun-os/settings.json          user choices (locale, theme, bandwidth)
 *   usr/etc/bun-os/plugins.lock.json      pinned plugin digests
 *   usr/etc/bun-os/trusted-keys/*.jwk     Ed25519 keys accepted for signed plugins
 *   usr/var/lib/bun-os/transfers.db       transfer queue (bun:sqlite)
 *   usr/var/cache/bun-os/downloads/       partial and finished downloads
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const packageRoot = resolve(import.meta.dir, "..");
export const repoRoot = resolve(packageRoot, "..", "..");

export function usrRoot(): string {
  return resolve(
    Bun.env.BUN_OS_USR ?? Bun.env.BEP_ROOT ?? join(repoRoot, "usr"),
  );
}

export const platformPaths = () => {
  const usr = usrRoot();
  return {
    usr,
    /** Catalogs shipped with the platform (source of truth, read by Rust too). */
    baseLocales: join(packageRoot, "locales"),
    baseThemes: join(packageRoot, "themes"),
    builtinPlugins: join(packageRoot, "plugins"),
    locales: join(usr, "share", "bun-os", "locale"),
    themes: join(usr, "share", "bun-os", "themes"),
    plugins: join(usr, "lib", "bun-os", "plugins"),
    etc: join(usr, "etc", "bun-os"),
    settings: join(usr, "etc", "bun-os", "settings.json"),
    pluginLock: join(usr, "etc", "bun-os", "plugins.lock.json"),
    trustedKeys: join(usr, "etc", "bun-os", "trusted-keys"),
    state: join(usr, "var", "lib", "bun-os"),
    transfersDb: join(usr, "var", "lib", "bun-os", "transfers.db"),
    downloads: join(usr, "var", "cache", "bun-os", "downloads"),
  };
};

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export interface PlatformSettings {
  /** Explicit UI locale; absent follows the OS / Accept-Language. */
  locale?: string;
  /** Theme id or path; absent uses the baseline. */
  theme?: string;
  /** "system" follows forced colors / high contrast of the OS. */
  contrast?: "standard" | "high" | "system";
  /** Download bandwidth cap in bytes per second (0 = unlimited). */
  bandwidth?: number;
  /** R2/S3 bucket for uploads (saves, screenshots, user themes and plugins). */
  uploadBucket?: string;
}

export async function readSettings(): Promise<PlatformSettings> {
  const file = Bun.file(platformPaths().settings);
  return (await file.exists()) ? ((await file.json()) as PlatformSettings) : {};
}

export async function writeSettings(
  patch: Partial<PlatformSettings>,
): Promise<PlatformSettings> {
  const next = { ...(await readSettings()), ...patch };
  for (const [k, v] of Object.entries(next))
    if (v === undefined || v === null)
      delete (next as Record<string, unknown>)[k];
  ensureDir(platformPaths().etc);
  await Bun.write(
    platformPaths().settings,
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}
