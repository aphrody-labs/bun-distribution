import type { AssetKind, Dbxv2, Dbxv2Assets } from "./types.ts";

/** Kinds stored as `<path>.xz` in the assets tree (audio and video are raw). */
const XZ_KINDS: ReadonlySet<AssetKind> = new Set(["models", "textures", "text", "data"]);

/** How the tree stores a kind: `xz` for the compressible kinds, `raw` for audio and video. */
export function storedAs(kind: AssetKind): "xz" | "raw" {
  return XZ_KINDS.has(kind) ? "xz" : "raw";
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * URL of an asset on the origin: `/<kind>/<cpk>/<path>.xz` for the xz kinds (served as
 * `application/x-xz`, decode it yourself), `/<kind>/<cpk>/<path>` for audio and video.
 */
export function assetUrl(origin: string, kind: AssetKind, cpk: string, path: string): string {
  const suffix = storedAs(kind) === "xz" ? ".xz" : "";
  return `${origin.replace(/\/+$/, "")}/${kind}/${encodeURIComponent(cpk)}/${encodePath(path)}${suffix}`;
}

/**
 * Asset reader over a local directory or an `http(s)://` origin. `.xz` files are decoded with the
 * native decoder of `decoder` (the FFI or wasm loader), so Bun code needs no xz library. A stored
 * `.gz` (an interrupted conversion) and raw files are handled too.
 */
export function createAssetReader(origin: string, decoder: Pick<Dbxv2, "xzDecode">): Dbxv2Assets {
  const remote = /^https?:\/\//i.test(origin);
  return {
    async readAsset(kind, cpk, path) {
      if (remote) {
        const url = assetUrl(origin, kind, cpk, path);
        const response = await fetch(url, { headers: { "Accept-Encoding": "identity" } });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return url.endsWith(".xz") ? decoder.xzDecode(bytes) : bytes;
      }
      const base = `${origin.replace(/[\\/]+$/, "")}/${kind}/${cpk}/${path}`;
      for (const suffix of [".xz", ".gz", ""]) {
        const file = Bun.file(base + suffix);
        if (!(await file.exists())) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (suffix === ".xz") return decoder.xzDecode(bytes);
        return suffix === ".gz" ? Bun.gunzipSync(bytes) : bytes;
      }
      throw new Error(`${base}: not found (.xz, .gz or raw)`);
    },
  };
}
