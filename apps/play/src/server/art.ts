// SPDX-License-Identifier: Apache-2.0
/**
 * Real Steam library art for play.aphrody.app: the host's Steam library cache first
 * (appcache/librarycache/<appid>/), else the public Steam CDN. Each requested width is transcoded
 * once with Bun.Image to WebP (AVIF encode is not available on Linux) and cached under
 * <PLAY_DATA>/art/steam; responses are immutable.
 */
import { resolveSteamRoot } from "@aphrody/bun-steam";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config, dataRoot } from "./config";

/** Art kinds: Steam file names and the widths the client asks for (srcset). */
export const STEAM_ART = {
  capsule: { file: "library_600x900.jpg", widths: [200, 300, 600] },
  hero: { file: "library_hero.jpg", widths: [960, 1920] },
  logo: { file: "logo.png", widths: [320, 640] },
  header: {
    file: "header.jpg",
    cacheFile: "library_header.jpg",
    widths: [230, 460],
  },
} as const;
export type SteamArtKind = keyof typeof STEAM_ART;

const CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";
const MISSING_TTL_MS = 24 * 3_600_000;
const cacheRoot = join(dataRoot, "art", "steam");
const pending = new Map<string, Promise<Uint8Array | null>>();

const immutable = {
  "cache-control": "private, max-age=31536000, immutable",
  "content-type": "image/webp",
};

/**
 * A file of the client's library cache. Recent clients nest the files in content-hash
 * directories (librarycache/<appid>/<hash>/library_600x900.jpg), older ones keep them flat.
 */
export function libraryCacheFile(appId: number, name: string): string | null {
  let dir: string;
  try {
    dir = join(
      resolveSteamRoot(config.steamRoot),
      "appcache",
      "librarycache",
      String(appId),
    );
  } catch {
    return null;
  }
  if (existsSync(join(dir, name))) return join(dir, name);
  let children: string[] = [];
  try {
    children = readdirSync(dir);
  } catch {
    return null;
  }
  for (const child of children)
    if (existsSync(join(dir, child, name))) return join(dir, child, name);
  return null;
}

async function source(
  appId: number,
  kind: SteamArtKind,
): Promise<Uint8Array | null> {
  const art = STEAM_ART[kind];
  for (const name of "cacheFile" in art
    ? [art.cacheFile, art.file]
    : [art.file]) {
    const local = libraryCacheFile(appId, name);
    if (local) return new Uint8Array(await Bun.file(local).arrayBuffer());
  }
  const response = await fetch(`${CDN}/${appId}/${art.file}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

async function render(
  appId: number,
  kind: SteamArtKind,
  width: number,
): Promise<Uint8Array | null> {
  const dir = join(cacheRoot, String(appId));
  const cached = Bun.file(join(dir, `${kind}-${width}.webp`));
  if (await cached.exists()) return new Uint8Array(await cached.arrayBuffer());
  const missing = Bun.file(join(dir, `${kind}.missing`));
  if (
    (await missing.exists()) &&
    Date.now() - missing.lastModified < MISSING_TTL_MS
  )
    return null;
  mkdirSync(dir, { recursive: true });
  const bytes = await source(appId, kind).catch(() => null);
  if (!bytes) {
    await Bun.write(missing, "");
    return null;
  }
  const webp = await new Bun.Image(bytes, { maxPixels: 4096 * 4096 })
    .resize(width, width * 4, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: kind === "logo" ? 90 : 82 })
    .bytes();
  await Bun.write(cached, webp);
  return webp;
}

export function artRoutes() {
  return {
    "/art/steam/:appid/:kind": {
      GET: async (request: Bun.BunRequest<"/art/steam/:appid/:kind">) => {
        const appId = Number(request.params.appid);
        const kind = request.params.kind as SteamArtKind;
        const art = STEAM_ART[kind];
        const width = Number(
          new URL(request.url).searchParams.get("w") ?? art?.widths.at(-1),
        );
        if (
          !Number.isInteger(appId) ||
          appId <= 0 ||
          !art ||
          !(art.widths as readonly number[]).includes(width)
        )
          return new Response(null, { status: 404 });
        const key = `${appId}/${kind}/${width}`;
        let job = pending.get(key);
        if (!job) {
          job = render(appId, kind, width).finally(() => pending.delete(key));
          pending.set(key, job);
        }
        const webp = await job;
        return webp
          ? new Response(Buffer.from(webp), { headers: immutable })
          : new Response(null, {
              status: 404,
              headers: { "cache-control": "public, max-age=3600" },
            });
      },
    },
  };
}
