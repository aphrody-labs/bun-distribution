import { findVfsConfig, readVfsConfig } from "./vfs-data.js";
/**
 * @file data-loader.ts
 * @description Central data loader for all game data sources
 *
 * This module provides unified access to:
 * - Raw config rows (PostgreSQL JSONB; SQLite extraction cache for dev)
 * - Pre-processed SQL projections
 * - Text localization files
 * - Lua script data
 *
 * PostgreSQL est la source durable. SQLite et les fichiers `.cfg.bin.json`
 * servent uniquement à l'extraction/dev ou à une migration de secours ; ils ne
 * sont jamais la source canonique de l'API de production.
 */

import { join } from "node:path";
import { clearJsonCache, loadJsonAsync } from "./async-loader.js";
import {
  cfgbinDbAvailable,
  cfgbinDataSource,
  cfgbinDbFindLatest,
  cfgbinDbLoad,
  cfgbinDbLoadText,
  cfgbinPostgresFindLatest,
  cfgbinPostgresLoad,
} from "./cfgbin-db.js";
import type { ConfigDocument, ConfigFile, ConfigNode, RawConfigFile } from "./config-parser.js";
import { DATA_ROOT, FILES, PATHS } from "./paths.js";

/**
 * Supported locales for text files
 */
export const LOCALES = ["ja", "en", "fr", "de", "es", "it", "pt", "zh_hans", "zh_hant"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Cache for loaded data files
 */
const dataCache = new Map<string, unknown>();

/** Legacy loose JSON is disabled by default; extraction must use SQL/SQLite. */
function allowLooseJson(): boolean {
  return process.env.IEVR_ALLOW_LOOSE_JSON === "1";
}

/**
 * Clear the data cache
 */
export function clearCache(): void {
  dataCache.clear();
  clearJsonCache();
}

/**
 * Get the root data path
 */
export function getDataPath(): string {
  return DATA_ROOT;
}

/**
 * Read and parse a local extraction artifact with caching (synchronous compatibility).
 * Async callers use the SQL-first `loadJsonAsync` boundary. Bun n'a pas de Bun.file sync, on
 * route via require() qui supporte JSON nativement et reste sync.
 */
export function loadJSON<T>(filePath: string): T {
  if (cfgbinDataSource() === "vfs" && filePath.replaceAll("\\", "/").includes("/common/"))
    return readVfsConfig(filePath) as T;
  if (dataCache.has(filePath)) {
    return dataCache.get(filePath) as T;
  }
  if (!allowLooseJson()) return { data: [], _meta: { count: 0 } } as unknown as T;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const data = require(filePath) as T;
    dataCache.set(filePath, data);
    return data;
  } catch {
    return { data: [], _meta: { count: 0 } } as unknown as T;
  }
}

/**
 * Find a config file in a category directory matching a prefix.
 * Tries the durable PostgreSQL cfgbin projection first in async callers;
 * synchronous callers retain the explicit offline SQLite/filesystem path.
 */
export function findConfigFile(category: string, prefix: string): string | null {
  if (cfgbinDataSource() === "vfs") return findVfsConfig(category, prefix);
  // 1. cfgbin SQLite DB (opt-in)
  if (cfgbinDbAvailable()) {
    const fromDb = cfgbinDbFindLatest(category, prefix);
    if (fromDb) return fromDb;
  }
  if (!allowLooseJson()) return null;

  // 2. Filesystem fallback (loose .cfg.bin.json files)
  const dir = join(PATHS.gamedata, category);
  try {
    const found = [
      ...new Bun.Glob(`${prefix}*.cfg.bin.json`).scanSync({
        cwd: dir,
        onlyFiles: true,
      }),
    ]
      .sort()
      .pop();
    return found ?? null;
  } catch {
    return null;
  }
}

/**
 * Load a raw config file from common/gamedata (Async), PostgreSQL-first.
 */
export async function loadConfigAsync(category: string, filename: string): Promise<ConfigFile> {
  if (cfgbinDataSource() === "vfs") return loadConfig(category, filename);
  try {
    const raw = (await cfgbinPostgresLoad(category, filename)) as Partial<RawConfigFile>;
    return { name: filename, variables: [], children: raw.entries || [] };
  } catch {
    // PostgreSQL absent/not imported: use the local extraction cache.
  }
  if (cfgbinDbAvailable()) {
    try {
      const raw = cfgbinDbLoad(category, filename) as Partial<RawConfigFile>;
      return {
        name: filename,
        variables: [],
        children: raw.entries || [],
      };
    } catch {
      // Fallback to filesystem on miss
    }
  }
  if (!allowLooseJson()) return { name: filename, variables: [], children: [] };

  const filePath = join(PATHS.gamedata, category, filename);
  const raw = (await loadJsonAsync<ConfigDocument>(filePath)) ?? { entries: [] };

  return {
    name: filename,
    variables: [],
    children: raw.entries || [],
  };
}

/** Async discovery counterpart: durable PostgreSQL, then explicit offline caches. */
export async function findConfigFileAsync(
  category: string,
  prefix: string,
): Promise<string | null> {
  if (cfgbinDataSource() === "vfs") return findVfsConfig(category, prefix);
  const fromPostgres = await cfgbinPostgresFindLatest(category, prefix);
  if (fromPostgres) return fromPostgres;
  if (cfgbinDbAvailable()) {
    const fromDb = cfgbinDbFindLatest(category, prefix);
    if (fromDb) return fromDb;
  }
  if (!allowLooseJson()) return null;
  const dir = join(PATHS.gamedata, category);
  try {
    return (
      [...new Bun.Glob(`${prefix}*.cfg.bin.json`).scanSync({ cwd: dir, onlyFiles: true })]
        .sort()
        .pop() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Legacy Sync Loaders (kept for transitional compatibility).
 * Tries cfgbin SQLite DB first, falls back to filesystem.
 */
export function loadConfig(category: string, filename: string): ConfigFile {
  if (cfgbinDataSource() === "vfs") {
    const raw = readVfsConfig(`data/common/gamedata/${category}/${filename}`);
    return { name: filename, variables: [], children: raw?.entries ?? [] };
  }
  if (cfgbinDbAvailable()) {
    try {
      const raw = cfgbinDbLoad(category, filename) as Partial<RawConfigFile>;
      return { name: filename, variables: [], children: raw.entries || [] };
    } catch {
      // Fallback to filesystem
    }
  }
  if (!allowLooseJson()) return { name: filename, variables: [], children: [] };
  const filePath = join(PATHS.gamedata, category, filename);
  const raw = loadJSON<ConfigDocument>(filePath);
  return { name: filename, variables: [], children: raw.entries || [] };
}

/**
 * Load a raw cfgbin projection for parsers whose format uses `lists` instead
 * of the normalized `entries` tree. SQLite is the synchronous extraction
 * source; loose JSON remains an explicit compatibility escape hatch.
 */
export function loadConfigData<T = ConfigDocument>(category: string, filename: string): T | null {
  if (cfgbinDataSource() === "vfs")
    return readVfsConfig(`data/common/gamedata/${category}/${filename}`) as T | null;
  if (cfgbinDbAvailable()) {
    try {
      return cfgbinDbLoad(category, filename) as T;
    } catch {
      // Continue to the explicit legacy fallback below.
    }
  }
  if (!allowLooseJson()) return null;
  return loadJSON<T>(join(PATHS.gamedata, category, filename));
}

/**
 * Load character param config
 */
export function loadCharaParam(): ConfigFile {
  const filename = findConfigFile("character", "chara_param_1") || FILES.charaParam;
  return loadConfig("character", filename);
}

/**
 * Load character base config
 */
export function loadCharaBase(): ConfigFile {
  const filename = findConfigFile("character", "chara_base_1") || FILES.charaBase;
  return loadConfig("character", filename);
}

/**
 * Load character details config
 */
export function loadCharaDetailsConfig(): ConfigFile {
  const filename = findConfigFile("character", "chara_details_config_0") || FILES.charaDetails;
  return loadConfig("character", filename);
}

/**
 * Load skill config (prefers highest version: v5 DLC Orion > v4 > v3 > v2 > v1)
 */
export function loadSkillConfig(): ConfigFile {
  const filename =
    findConfigFile("skill", "skill_config_5") ||
    findConfigFile("skill", "skill_config_4") ||
    findConfigFile("skill", "skill_config_3") ||
    findConfigFile("skill", "skill_config_2") ||
    findConfigFile("skill", "skill_config_1") ||
    FILES.skillBase;
  return loadConfig("skill", filename);
}

/**
 * Load team config
 */
export function loadTeamConfig(): ConfigFile {
  const filename = findConfigFile("team", "team_config") || FILES.teamConfig;
  return loadConfig("team", filename);
}

/**
 * Load character text for a specific locale.
 * Tries cfgbin SQLite DB first (gated par IEVR_CFGBIN_DB_TEXT), fallback FS.
 */
export function loadCharaText(locale: Locale): ConfigFile {
  if (cfgbinDataSource() === "vfs")
    return {
      name: FILES.charaText,
      variables: [],
      children: readVfsConfig(`data/common/text/${locale}/${FILES.charaText}`)?.entries ?? [],
    };
  if (cfgbinDbAvailable()) {
    try {
      const raw = cfgbinDbLoadText(locale, FILES.charaText) as {
        entries?: ConfigNode[];
      };
      return {
        name: `chara_text_${locale}`,
        variables: [],
        children: raw.entries || [],
      };
    } catch {
      // Fallback to filesystem
    }
  }
  if (!allowLooseJson()) return { name: `chara_text_${locale}`, variables: [], children: [] };
  const filePath = join(PATHS.textRoot, locale, FILES.charaText);
  const raw = loadJSON<{ entries?: ConfigNode[] }>(filePath);
  return {
    name: `chara_text_${locale}`,
    variables: [],
    children: raw.entries || [],
  };
}

/**
 * Load character romanized names for a locale.
 * Tries cfgbin SQLite DB first (gated par IEVR_CFGBIN_DB_TEXT), fallback FS.
 */
export function loadCharaTextRoma(locale: Locale): ConfigFile {
  if (cfgbinDataSource() === "vfs")
    return {
      name: FILES.charaTextRoma,
      variables: [],
      children: readVfsConfig(`data/common/text/${locale}/${FILES.charaTextRoma}`)?.entries ?? [],
    };
  if (cfgbinDbAvailable()) {
    try {
      const raw = cfgbinDbLoadText(locale, FILES.charaTextRoma) as {
        entries?: ConfigNode[];
      };
      return {
        name: `chara_text_roma_${locale}`,
        variables: [],
        children: raw.entries || [],
      };
    } catch {
      // Fallback to filesystem
    }
  }
  if (!allowLooseJson()) return { name: `chara_text_roma_${locale}`, variables: [], children: [] };
  const filePath = join(PATHS.textRoot, locale, FILES.charaTextRoma);
  const raw = loadJSON<{ entries?: ConfigNode[] }>(filePath);
  return {
    name: `chara_text_roma_${locale}`,
    variables: [],
    children: raw.entries || [],
  };
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Convert signed 32-bit int to hex string
 */
export function toHex(value: number): string {
  if (value < 0) {
    // Convert negative to unsigned 32-bit
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  }
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Parse hex string to signed 32-bit int
 */
export function fromHex(hex: string): number {
  const unsigned = Number.parseInt(hex.replace("0x", ""), 16);
  // Convert to signed 32-bit if needed
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

/**
 * Sanitize text from game data files
 *
 * Cleans up escape sequences and special characters:
 * - \\n -> newline
 * - \\r -> removed
 * - \\t -> tab
 * - \\" -> "
 * - \\' -> '
 * - Trims whitespace
 * - Normalizes multiple spaces
 * - Removes control characters
 */
export function sanitizeText(text: string): string {
  if (!text) return "";

  return (
    text
      // Remove furigana: [Kanji/Reading] -> Kanji
      .replace(/\[([^/]+)\/[^\]]+\]/g, "$1")
      // Handle game tags
      // 1. Extract value from tags like <FLA:SAKAMAKI>, <FUL:DAISUKE>, <VAL:10> -> SAKAMAKI / DAISUKE / 10
      // We keep the value after the colon for all tags except COL (color)
      .replace(/<(?!COL:)[^:>]+:([^>]+)>/g, "$1")
      // 2. Remove any remaining tags like <COL:FFAA00>, <CLO>, <TX0>, etc.
      .replace(/<[^>]+>/g, "")
      // Handle escape sequences
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      // Remove control characters (except newline and tab)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char removal
      // oxlint-disable-next-line eslint/no-control-regex -- Remove binary control codes while preserving tabs and newlines.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Normalize multiple spaces (but preserve newlines)
      .replace(/[ ]+/g, " ")
      // Normalize multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      // Trim each line
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      // Final trim
      .trim()
  );
}

/**
 * Get available locales for text files (sync, uses Bun.Glob.scanSync).
 */
export function getAvailableLocales(): Locale[] {
  try {
    const entries = [...new Bun.Glob("*").scanSync({ cwd: PATHS.textRoot, onlyFiles: false })];
    return entries.filter((d) => LOCALES.includes(d as Locale)) as Locale[];
  } catch {
    return [];
  }
}
