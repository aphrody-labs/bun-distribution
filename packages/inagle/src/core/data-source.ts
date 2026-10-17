export type InagleDataSource = "vfs" | "sqlite" | "postgres";
export type InagleDataSourceOption = InagleDataSource | "auto";

export function configuredDataSource(): string | undefined {
  return process.env.NIE_DATA_SOURCE ?? process.env.INAGLE_DATA_SOURCE;
}

export function ownedPostgresUrl(): string {
  const value = (process.env.INAGLE_DATABASE_URL ?? process.env.NIE_PG_URL)?.trim();
  if (!value) throw new Error("INAGLE_DATABASE_URL is required for the selected IECODE PostgreSQL source");
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname === "/")
      throw new Error();
  } catch {
    throw new Error("INAGLE_DATABASE_URL must identify an IECODE PostgreSQL host and database");
  }
  return value;
}

export function localMirrorPath(): string | undefined {
  const explicit = process.env.NIE_WIKI_DB || process.env.NIE_MIRROR_DB;
  const path = explicit ?? join(process.env.IECODE_ROOT || process.cwd(), "var", "mirror.sqlite");
  try {
    const info = statSync(path);
    if (info.isFile() && info.size > 0) return resolve(path);
  } catch {
    // Discovery does not create an empty database or search another profile.
  }
  if (explicit) throw new Error("The explicitly selected Inagle SQLite mirror is unavailable");
  return undefined;
}

/** Whether the Neon gameplay database (INAGLE_DATABASE_URL or its alias NIE_PG_URL) is configured. */
export function postgresConfigured(): boolean {
  return Boolean((process.env.INAGLE_DATABASE_URL ?? process.env.NIE_PG_URL)?.trim());
}

/**
 * `auto` prefers the Neon gameplay database when it is configured, then a local SQLite mirror
 * (offline development), then the native VFS.
 */
export function selectDataSource(options: {
  explicit?: string;
  sqliteAvailable?: boolean;
  postgresAvailable?: boolean;
  postgresDisabled?: boolean;
}): InagleDataSource {
  const explicit = options.explicit?.trim() || "auto";
  if (!["auto", "vfs", "sqlite", "postgres"].includes(explicit))
    throw new Error("INAGLE_DATA_SOURCE must be auto, vfs, sqlite or postgres");
  if (explicit === "postgres" && options.postgresDisabled)
    throw new Error("PostgreSQL was selected but IEVR_CFGBIN_POSTGRES=0 disables it");
  if (explicit !== "auto") return explicit as InagleDataSource;
  if (options.postgresAvailable && !options.postgresDisabled) return "postgres";
  return options.sqliteAvailable ? "sqlite" : "vfs";
}
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
