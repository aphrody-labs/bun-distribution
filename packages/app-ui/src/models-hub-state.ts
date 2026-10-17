// SPDX-License-Identifier: Apache-2.0
// Pure state helpers of the Models hub (models-hub.tsx): progress aggregation over the
// `aphrody://model-pull` events, measured throughput, and catalog/store joins.
import type { CatalogEntry, HardwareTelemetry, InstalledModels, PullProgress } from "./tauri-bridge";
import { FuzzySearch } from "@aphrody/fuzzy";

/** Jan hub search contract, adapted to Aphrody's existing catalog/store schema.
 * Source: janhq/jan@14a720628f9592c8e60f7e081ef733076db8a6a9,
 * web-app/src/routes/hub/-searchRanking.ts and hub/index.tsx; Apache-2.0,
 * Copyright 2025 Menlo Research. No Jan catalog, store or UI framework is copied.
 */
export function cleanModelSearchQuery(raw: string): string {
  return raw.trim().replace(/^https?:\/\/[^/]+\//i, "");
}

export function searchModelCatalog<T extends Pick<CatalogEntry, "id" | "title" | "summary" | "files">>(
  entries: T[],
  rawQuery: string,
): T[] {
  const query = cleanModelSearchQuery(rawQuery).toLowerCase();
  if (!query) return entries;
  const documents = entries.map(entry => {
    const variants = entry.files.flatMap(file => {
      const ref = file.ref.replace(/^hf:/, "").split("@")[0]!;
      return [ref, ref.split("/").at(-1)!];
    });
    const repos = entry.files.flatMap(file => {
      const match = file.ref.match(/^hf:([^/]+\/[^/]+)\//);
      return match ? [match[1]!] : [];
    });
    return {
      entry,
      names: [entry.id, entry.title, ...repos].filter(Boolean),
      variants,
      summary: entry.summary,
    };
  });
  const fuse = new FuzzySearch(documents, {
    includeScore: true,
    threshold: 0.3,
    ignoreLocation: true,
    keys: ["names", "variants", "summary"],
  });
  const rank = (document: (typeof documents)[number]) => {
    const names = document.names.map(name => name.trim().toLowerCase());
    if (names.includes(query)) return 0;
    if (document.variants.some(variant => variant.trim().toLowerCase() === query)) return 1;
    if (names.some(name => name.startsWith(query) || query.startsWith(name))) return 2;
    return 3;
  };
  return fuse
    .search(query)
    .map(({ item }, index) => ({ item, index, rank: rank(item) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item.entry);
}

export type DownloadState = {
  /** Bytes on disk per artefact role, as last reported by the CLI. */
  roles: Record<string, number>;
  downloaded: number;
  /** Catalog size of the whole entry, `null` when a file declares no size. */
  total: number | null;
  /** Measured throughput (exponential moving average), `null` before two samples. */
  speedBps: number | null;
  etaSeconds: number | null;
  status: "downloading" | "stopped" | "error";
  error?: string;
  sampledAt: number;
};

/** Total download size of a catalog entry, `null` when any file has no declared size. */
export function entryBytes(entry: Pick<CatalogEntry, "files">): number | null {
  let total = 0;
  for (const file of entry.files) {
    if (typeof file.bytes !== "number") return null;
    total += file.bytes;
  }
  return total;
}

export function startDownload(total: number | null, now: number): DownloadState {
  return {
    roles: {},
    downloaded: 0,
    total,
    speedBps: null,
    etaSeconds: null,
    status: "downloading",
    sampledAt: now,
  };
}

/** Fold one progress event into the entry's state; throughput is measured, never assumed. */
export function applyProgress(state: DownloadState, event: PullProgress, now: number): DownloadState {
  const roles = { ...state.roles, [event.role ?? "file"]: event.downloaded };
  const downloaded = Object.values(roles).reduce((sum, bytes) => sum + bytes, 0);
  const elapsed = (now - state.sampledAt) / 1000;
  const delta = downloaded - state.downloaded;
  let speedBps = state.speedBps;
  if (elapsed > 0 && delta >= 0) {
    const instant = delta / elapsed;
    speedBps = speedBps === null ? instant : speedBps * 0.7 + instant * 0.3;
  }
  const remaining = state.total === null ? null : Math.max(0, state.total - downloaded);
  const etaSeconds = remaining !== null && speedBps ? Math.ceil(remaining / speedBps) : null;
  return { ...state, roles, downloaded, speedBps, etaSeconds, sampledAt: now };
}

export function installedIds(installed: InstalledModels | null): Set<string> {
  return new Set((installed?.models ?? []).flatMap(model => (model.catalog_id ? [model.catalog_id] : [])));
}

/** Largest probed GPU memory in bytes; `null` when the GPU probe failed. */
export function maxVramBytes(hardware: HardwareTelemetry | null): number | null {
  if (!hardware || hardware.gpus === null) return null;
  const fromGpus = Math.max(0, ...hardware.gpus.map(gpu => gpu.vram_bytes));
  const fromCuda = (hardware.cudaVramTotalMb ?? 0) * 1024 * 1024;
  return Math.max(fromGpus, fromCuda);
}

/** Whether the entry fits this machine's VRAM: `null` when unknown. CPU entries always fit. */
export function fitsVram(
  entry: Pick<CatalogEntry, "vram_min_bytes">,
  hardware: HardwareTelemetry | null,
): boolean | null {
  if (!entry.vram_min_bytes) return true;
  const vram = maxVramBytes(hardware);
  return vram === null ? null : vram >= entry.vram_min_bytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** A probed MiB figure as GB, or "inconnu". */
export function formatMb(mb: number | null): string {
  return mb === null ? "inconnu" : `${(mb / 1024).toFixed(1)} GB`;
}

export type ExternalModelSourceId = "ollama" | "lm-studio" | "huggingface";

export interface ExternalModelStoreDefinition {
  id: ExternalModelSourceId;
  name: string;
  defaultSubpath: string;
  description: string;
  defaultBackend: string;
}

export const STANDARD_EXTERNAL_MODEL_DIRS: ExternalModelStoreDefinition[] = [
  {
    id: "ollama",
    name: "Ollama",
    defaultSubpath: ".ollama/models",
    description: "Standard Ollama manifests and blob models",
    defaultBackend: "ollama",
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    defaultSubpath: ".cache/lm-studio/models",
    description: "LM Studio downloaded GGUF/transformers models",
    defaultBackend: "lm-studio",
  },
  {
    id: "huggingface",
    name: "HuggingFace",
    defaultSubpath: ".cache/huggingface/hub",
    description: "HuggingFace Hub snapshot cache and weights",
    defaultBackend: "huggingface",
  },
];

export interface ExternalStoreCandidate extends ExternalModelStoreDefinition {
  path: string;
}

export interface DetectedExternalStore {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  modelCount?: number;
  description?: string;
}

/** Resolve external model store path against a base user home directory, respecting platform separators. */
export function resolveExternalModelPath(homeDir: string, defaultSubpath: string): string {
  const isWindows = homeDir.includes("\\") || /^[a-zA-Z]:/.test(homeDir);
  const sep = isWindows ? "\\" : "/";
  const cleanHome = homeDir.replace(/[/\\]+$/, "");
  const cleanSubpath = isWindows ? defaultSubpath.replace(/\//g, "\\") : defaultSubpath.replace(/\\/g, "/");
  return `${cleanHome}${sep}${cleanSubpath}`;
}

/** Given a home directory, build candidate paths for all standard external model stores. */
export function buildStandardExternalCandidates(homeDir: string): ExternalStoreCandidate[] {
  return STANDARD_EXTERNAL_MODEL_DIRS.map(def =>
    Object.assign(def, {
      path: resolveExternalModelPath(homeDir, def.defaultSubpath),
    }),
  );
}

/** Infer the home directory from an arbitrary known system path (e.g. cwd, store root, or app data dir). */
export function inferHomeFromPath(samplePath: string): string | null {
  if (!samplePath || typeof samplePath !== "string") return null;
  // Windows: C:\Users\<Username>
  const winMatch = samplePath.match(/^([a-zA-Z]:\\Users\\[^\\]+)/i);
  if (winMatch) return winMatch[1];
  // macOS: /Users/<Username>
  const macMatch = samplePath.match(/^(\/Users\/[^/]+)/);
  if (macMatch) return macMatch[1];
  // Linux: /home/<Username>
  const linuxMatch = samplePath.match(/^(\/home\/[^/]+)/);
  if (linuxMatch) return linuxMatch[1];
  return null;
}

/**
 * Pure state evaluator: given candidate stores and probe results (or known existing paths),
 * produce the list of detected external stores.
 */
export function evaluateDetectedStores(
  candidates: ExternalStoreCandidate[],
  probes: Record<string, { exists: boolean; modelCount?: number } | boolean>,
): DetectedExternalStore[] {
  return candidates.map(candidate => {
    const probe = probes[candidate.path] ?? probes[candidate.id];
    const exists = typeof probe === "boolean" ? probe : (probe?.exists ?? false);
    const modelCount = typeof probe === "object" && probe !== null ? probe.modelCount : undefined;
    return {
      id: candidate.id,
      name: candidate.name,
      path: candidate.path,
      exists,
      modelCount,
      description: candidate.description,
    };
  });
}

async function probeExternalStore(
  c: ExternalStoreCandidate,
  probeFn: (path: string, id: string) => Promise<{ exists: boolean; modelCount?: number } | boolean>,
): Promise<DetectedExternalStore> {
  try {
    const res = await probeFn(c.path, c.id);
    if (typeof res === "boolean") {
      return { ...c, exists: res };
    }
    return { ...c, exists: res.exists, modelCount: res.modelCount };
  } catch {
    return { ...c, exists: false };
  }
}

/**
 * Scan external model stores for a given home directory using a probe function.
 * If no probe function is provided, returns candidates with exists=false.
 */
export async function scanExternalModelDirectories(
  homeDir: string,
  probeFn?: (path: string, id: string) => Promise<{ exists: boolean; modelCount?: number } | boolean>,
): Promise<DetectedExternalStore[]> {
  const candidates = buildStandardExternalCandidates(homeDir);
  if (!probeFn) {
    return candidates.map(c => ({
      id: c.id,
      name: c.name,
      path: c.path,
      exists: false,
      description: c.description,
    }));
  }
  return Promise.all(candidates.map(c => probeExternalStore(c, probeFn)));
}

export type ModelKind = "chat" | "embedding" | "OCR" | "speech";

export function normalizeModelKind(taskOrName: string): ModelKind {
  const lower = (taskOrName || "").toLowerCase();
  if (
    lower === "chat" ||
    lower === "text-generation" ||
    lower.includes("chat") ||
    lower.includes("instruct") ||
    lower.includes("qwen") ||
    lower.includes("llama") ||
    lower.includes("deepseek") ||
    lower.includes("gemma") ||
    lower.includes("mistral") ||
    lower.includes("phi")
  ) {
    return "chat";
  }
  if (
    lower === "embedding" ||
    lower === "text-embedding" ||
    lower === "text-rerank" ||
    lower.includes("embed") ||
    lower.includes("bge") ||
    lower.includes("e5") ||
    lower.includes("rerank")
  ) {
    return "embedding";
  }
  if (
    lower === "ocr" ||
    lower === "visual-transcription" ||
    lower.includes("ocr") ||
    lower.includes("docling") ||
    lower.includes("vision") ||
    lower.includes("smolvlm") ||
    lower.includes("dots.ocr")
  ) {
    return "OCR";
  }
  if (
    lower === "speech" ||
    lower === "speech-to-text" ||
    lower.includes("whisper") ||
    lower.includes("speech") ||
    lower.includes("audio")
  ) {
    return "speech";
  }
  return "chat";
}

export function kindLabel(kind: ModelKind): string {
  switch (kind) {
    case "chat":
      return "Chat";
    case "embedding":
      return "Embedding";
    case "OCR":
      return "OCR";
    case "speech":
      return "Speech";
  }
}
