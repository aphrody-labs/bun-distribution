import { readVfsConfig } from "./vfs-data.js";
import { cfgbinDataSource, cfgbinDbAvailable, cfgbinDbLoadByPath, cfgbinPostgresLoadByPath } from "./cfgbin-db.js";

const fileCache = new Map<string, any>();

/** Loose cfg.bin.json files are a compatibility escape hatch only. */
function allowLooseJson(): boolean {
  return process.env.IEVR_ALLOW_LOOSE_JSON === "1";
}

export function clearJsonCache(): void {
  fileCache.clear();
}

function cfgbinPathFromFile(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const match = normalized.match(/\/common\/(gamedata|text)\/(.+)$/);
  if (!match) return null;
  const filename = match[2]!.endsWith(".json") ? match[2]!.slice(0, -5) : match[2]!;
  return `data/common/${match[1]}/${filename}`;
}

/**
 * Asynchronously load a JSON file with caching.
 * Extraction-only helper: durable runtime reads use PostgreSQL projections.
 * @param path Absolute path to the file
 * @returns Parsed JSON object or null if not found/error
 */
export async function loadJsonAsync<T>(path: string | null): Promise<T | null> {
  if (!path) return null;
  if (fileCache.has(path)) {
    return fileCache.get(path) as T;
  }

  const cfgbinPath = cfgbinPathFromFile(path);
  if (cfgbinPath && cfgbinDataSource() === "vfs") return readVfsConfig(cfgbinPath) as T | null;
  if (cfgbinPath) {
    try {
      const data = await cfgbinPostgresLoadByPath(cfgbinPath);
      fileCache.set(path, data);
      return data as T;
    } catch {
      // PostgreSQL is optional for extraction/dev; try the local SQL cache.
    }
    const isTextPath = cfgbinPath.includes("/text/");
    if (cfgbinDbAvailable() && (!isTextPath || process.env.IEVR_CFGBIN_DB_TEXT === "1")) {
      try {
        const data = cfgbinDbLoadByPath(cfgbinPath);
        fileCache.set(path, data);
        return data as T;
      } catch {
        // Keep the explicit extraction filesystem fallback below.
      }
    }
  }
  if (!allowLooseJson()) return null;

  const bunFile = Bun.file(path);
  if (!(await bunFile.exists())) {
    return null;
  }

  try {
    const data = (await bunFile.json()) as T;

    fileCache.set(path, data);
    return data;
  } catch (error) {
    console.error(`[AsyncLoader] Failed to parse ${path}`, error);
    return null;
  }
}

/**
 * Helper to measure execution time
 */
export async function measureTime<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  console.log(`[Perf] ${label}: ${(end - start).toFixed(2)}ms`);
  return result;
}
