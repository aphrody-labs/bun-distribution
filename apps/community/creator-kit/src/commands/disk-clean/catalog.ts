import { join } from "node:path";

import { cacheLocations } from "../adobe-clean.ts";

export interface CacheTarget {
  id: string;
  label: string;
  patterns: string[];
  /** Process names (lower-case, no .exe) that lock these files: the target is skipped while they run. */
  lockedBy?: string[];
  /** Only entries older than this many days are removed (protects files of running programs). */
  minAgeDays?: number;
}

type Env = Record<string, string | undefined>;

/** Caches that every program regenerates by itself. Nothing here holds user documents. */
export function catalog(env: Env, platform: NodeJS.Platform = process.platform): CacheTarget[] {
  if (platform === "win32") return windows(env);
  return unix(env);
}

function windows(env: Env): CacheTarget[] {
  const local = env.LOCALAPPDATA;
  const roaming = env.APPDATA;
  const home = env.USERPROFILE;
  const temp = env.TEMP ?? env.TMP;
  const out: CacheTarget[] = [];
  if (temp)
    out.push({
      id: "temp",
      label: "Fichiers temporaires utilisateur",
      patterns: [temp],
      minAgeDays: 1,
    });
  if (local) {
    out.push(
      { id: "crash-dumps", label: "Rapports de plantage", patterns: [join(local, "CrashDumps")] },
      {
        id: "gpu-shaders",
        label: "Caches de shaders GPU (DirectX, NVIDIA, AMD)",
        patterns: [
          join(local, "D3DSCache"),
          join(local, "NVIDIA", "DXCache"),
          join(local, "NVIDIA", "GLCache"),
          join(local, "AMD", "DxCache"),
        ],
      },
      {
        id: "chrome",
        label: "Cache Google Chrome",
        patterns: ["Cache", "Code Cache", "GPUCache"].map((d) =>
          join(local, "Google", "Chrome", "User Data", "*", d),
        ),
        lockedBy: ["chrome"],
      },
      {
        id: "edge",
        label: "Cache Microsoft Edge",
        patterns: ["Cache", "Code Cache", "GPUCache"].map((d) =>
          join(local, "Microsoft", "Edge", "User Data", "*", d),
        ),
        lockedBy: ["msedge"],
      },
      {
        id: "firefox",
        label: "Cache Firefox",
        patterns: [join(local, "Mozilla", "Firefox", "Profiles", "*", "cache2")],
        lockedBy: ["firefox"],
      },
      { id: "pip", label: "Cache pip", patterns: [join(local, "pip", "Cache")] },
      { id: "npm", label: "Cache npm", patterns: [join(local, "npm-cache")] },
    );
  }
  if (roaming) {
    out.push({
      id: "discord",
      label: "Cache Discord",
      patterns: ["Cache", "Code Cache", "GPUCache"].map((d) => join(roaming, "discord", d)),
      lockedBy: ["discord"],
    });
  }
  if (home)
    out.push({ id: "bun", label: "Cache Bun", patterns: [join(home, ".bun", "install", "cache")] });
  out.push({
    id: "adobe",
    label: "Caches Adobe (voir aussi adobe-clean)",
    patterns: cacheLocations(env).map((l) => l.pattern),
    lockedBy: ["photoshop", "afterfx", "adobe premiere pro", "adobe media encoder", "illustrator"],
  });
  return out;
}

function unix(env: Env): CacheTarget[] {
  const home = env.HOME;
  if (!home) return [];
  const cache = env.XDG_CACHE_HOME ?? join(home, ".cache");
  return [
    { id: "thumbnails", label: "Miniatures", patterns: [join(cache, "thumbnails")] },
    { id: "pip", label: "Cache pip", patterns: [join(cache, "pip")] },
    { id: "npm", label: "Cache npm", patterns: [join(home, ".npm", "_cacache")] },
    { id: "bun", label: "Cache Bun", patterns: [join(home, ".bun", "install", "cache")] },
    {
      id: "trash",
      label: "Corbeille",
      patterns: [join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "Trash", "files")],
    },
  ];
}
