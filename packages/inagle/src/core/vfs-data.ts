import { ptr } from "bun:ffi";
import { readOwnedJson } from "@aphrody/runtime-sdk/ffi";
import { NieVfsHandle, freeNieBytes, getNativeLib, locateGameSource } from "../ffi/nie.js";
import type { ConfigDocument } from "./config-contract.js";

let selectedRoot: string | undefined;
let mounted: NieVfsHandle | undefined;
let entries: string[] | undefined;
const documents = new Map<string, ConfigDocument>();
export function configureGameVfs(gameDir?: string): void {
  const root = gameDir || undefined;
  if (root === selectedRoot) return;
  mounted?.close();
  mounted = undefined;
  entries = undefined;
  documents.clear();
  selectedRoot = root;
}

export function gameDataDirectory(): string {
  return locateGameSource(selectedRoot).source;
}

export function gameVfs(): NieVfsHandle {
  return (mounted ??= new NieVfsHandle(gameDataDirectory()));
}

export function gameVfsPaths(): string[] {
  if (!entries) {
    const vfs = gameVfs();
    entries = [];
    const count = Number(vfs.count());
    for (let offset = 0; offset < count; offset += 4096) {
      entries.push(...vfs.listRange(offset, 4096).map((entry) => String(entry.path)));
    }
  }
  return entries;
}

export function findVfsConfig(category: string, prefix: string): string | null {
  const base = `data/common/gamedata/${category}/`;
  const match = gameVfsPaths()
    .filter((path) => path.startsWith(base + prefix) && path.endsWith(".cfg.bin"))
    .sort()
    .at(-1);
  return match ? match.slice(base.length) + ".json" : null;
}

export function readVfsConfig(path: string): ConfigDocument | null {
  const normalized = path.replaceAll("\\", "/");
  const common = normalized.indexOf("/common/");
  const internal =
    common >= 0
      ? `data${normalized.slice(common)}`.replace(/\.json$/, "")
      : normalized.replace(/\.json$/, "");
  if (documents.has(internal)) return documents.get(internal)!;
  const bytes = gameVfs().read(internal);
  if (!bytes) return null;
  const lib = getNativeLib();
  if (!lib) throw new Error("Native libiecode is required for direct VFS decoding.");
  const output = new Uint8Array(24);
  lib.nie_cfgbin_typed_json_out(ptr(bytes), bytes.length, ptr(output));
  const document = readOwnedJson<ConfigDocument>(output, freeNieBytes(lib));
  if (!document) return null;
  documents.set(internal, document);
  return document;
}
