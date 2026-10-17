// SPDX-License-Identifier: Apache-2.0
/**
 * Build-time real art for the public catalog (no generated or placeholder imagery):
 *
 * - Games: libretro-thumbnails (Named_Boxarts, Named_Snaps, Named_Titles) of the system's
 *   repository, matched from the title the Bun Engine library resolved through the indexed
 *   libretro-database DAT. The thumbnail repositories use their own naming (aftermarket tags,
 *   dates), so a DAT title matches the entry with the same base name and region that shares the
 *   most tags.
 * - Systems: the Systematic theme of libretro/retroarch-assets (CC BY 4.0), by playlist name.
 *
 * Downloads are cached in apps/play/.cache; images are transcoded with Bun.Image to WebP (and
 * AVIF where the platform encoder exists) with content-hashed names under /assets/art/.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ArtImage {
  src: string;
  srcset: string;
  avifSrcset: string | null;
  width: number;
  height: number;
  pixelated: boolean;
}

const KINDS = {
  boxart: "Named_Boxarts",
  snap: "Named_Snaps",
  title: "Named_Titles",
} as const;
export type ThumbnailKind = keyof typeof KINDS;

export class ArtBuilder {
  #avif: boolean | null = null;
  readonly #trees = new Map<string, Promise<string[]>>();

  constructor(
    readonly cacheDir: string,
    readonly publicDir: string,
  ) {}

  async #cached(url: string, file: string): Promise<Uint8Array | null> {
    const path = join(this.cacheDir, file);
    const hit = Bun.file(path);
    if (await hit.exists())
      return hit.size ? new Uint8Array(await hit.arrayBuffer()) : null;
    mkdirSync(dirname(path), { recursive: true });
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) {
      await Bun.write(path, "");
      return null;
    }
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await Bun.write(path, bytes);
    return bytes;
  }

  /** File paths of a GitHub repository (one cached tree listing per repository). */
  tree(repository: string): Promise<string[]> {
    let tree = this.#trees.get(repository);
    if (!tree) {
      tree = (async () => {
        const file = join(
          this.cacheDir,
          "trees",
          `${repository.replaceAll("/", "__")}.json`,
        );
        if (await Bun.file(file).exists())
          return (await Bun.file(file).json()) as string[];
        const headers: Record<string, string> = {
          accept: "application/vnd.github+json",
        };
        if (Bun.env.GITHUB_TOKEN)
          headers.authorization = `Bearer ${Bun.env.GITHUB_TOKEN}`;
        const response = await fetch(
          `https://api.github.com/repos/${repository}/git/trees/HEAD?recursive=1`,
          {
            headers,
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (response.status === 404) return [];
        if (!response.ok)
          throw new Error(`${repository} tree: HTTP ${response.status}`);
        const body = (await response.json()) as {
          tree: { path: string; type: string }[];
        };
        const paths = body.tree
          .filter((entry) => entry.type === "blob")
          .map((entry) => entry.path);
        await Bun.write(file, JSON.stringify(paths));
        return paths;
      })();
      this.#trees.set(repository, tree);
    }
    return tree;
  }

  async #encode(
    bytes: Uint8Array,
    base: string,
    widths: number[],
    pixelated: boolean,
  ): Promise<ArtImage> {
    const { width, height } = await new Bun.Image(bytes).metadata();
    const steps = [...new Set(widths.map((w) => Math.min(w, width)))];
    const hash = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 10);
    const webp: string[] = [];
    const avif: string[] = [];
    for (const w of steps) {
      const image = () =>
        new Bun.Image(bytes).resize(w, Math.round((w / width) * height), {
          filter: pixelated ? "nearest" : "lanczos3",
        });
      const name = `/assets/art/${base}-${w}-${hash}`;
      await Bun.write(
        join(this.publicDir, `${name}.webp`),
        await image()
          .webp(pixelated ? { lossless: true } : { quality: 82 })
          .bytes(),
      );
      webp.push(`${name}.webp ${w}w`);
      if (this.#avif !== false) {
        try {
          await Bun.write(
            join(this.publicDir, `${name}.avif`),
            await image().avif({ quality: 55 }).bytes(),
          );
          avif.push(`${name}.avif ${w}w`);
          this.#avif = true;
        } catch (error) {
          if (
            (error as { code?: string }).code !== "ERR_IMAGE_FORMAT_UNSUPPORTED"
          )
            throw error;
          this.#avif = false;
        }
      }
    }
    const largest = webp.at(-1)!.split(" ")[0]!;
    return {
      src: largest,
      srcset: webp.join(", "),
      avifSrcset: avif.length ? avif.join(", ") : null,
      width,
      height,
      pixelated,
    };
  }

  /** Whether AVIF encoding was available on this build host. */
  get avif(): boolean {
    return this.#avif === true;
  }

  /** The libretro-thumbnails entry matching a DAT title, or null. */
  async thumbnail(
    playlist: string,
    title: string,
    kind: ThumbnailKind,
    base: string,
  ): Promise<ArtImage | null> {
    const repository = `libretro-thumbnails/${playlist.replaceAll(" ", "_")}`;
    const folder = `${KINDS[kind]}/`;
    const names = (await this.tree(repository))
      .filter((path) => path.startsWith(folder) && path.endsWith(".png"))
      .map((path) => path.slice(folder.length, -4));
    const match = matchTitle(title, names);
    if (!match) return null;
    const url = `https://raw.githubusercontent.com/${repository}/master/${encodeURI(`${folder}${match}.png`).replaceAll("#", "%23")}`;
    const bytes = await this.#cached(
      url,
      `thumbnails/${playlist}/${kind}/${match}.png`,
    );
    return bytes
      ? this.#encode(
          bytes,
          `games/${base}-${kind}`,
          kind === "boxart" ? [200, 400] : [256, 512],
          kind !== "boxart",
        )
      : null;
  }

  /** The Systematic icon of a playlist name, or null when the theme has none. */
  async systemIcon(
    names: string[],
    base: string,
  ): Promise<{ image: ArtImage; playlist: string } | null> {
    const available = new Set(
      (await this.tree("libretro/retroarch-assets"))
        .filter((path) => path.startsWith("xmb/systematic/png/"))
        .map((path) => path.slice("xmb/systematic/png/".length, -4)),
    );
    const playlist = names.find((name) => available.has(name));
    if (!playlist) return null;
    const url = `https://raw.githubusercontent.com/libretro/retroarch-assets/master/xmb/systematic/png/${encodeURIComponent(playlist)}.png`;
    const bytes = await this.#cached(url, `systematic/${playlist}.png`);
    return bytes
      ? {
          image: await this.#encode(bytes, `systems/${base}`, [48, 96], false),
          playlist,
        }
      : null;
  }
}

/** Base name and parenthesised tags of a No-Intro/Redump style name. */
function parts(name: string): { base: string; tags: string[] } {
  const index = name.indexOf(" (");
  const base = (index < 0 ? name : name.slice(0, index)).trim().toLowerCase();
  const tags = [...name.matchAll(/\(([^)]*)\)/g)].map((match) =>
    match[1]!.toLowerCase(),
  );
  return { base, tags };
}

/** Same base name and first (region) tag; the candidate sharing the most tags wins. */
export function matchTitle(title: string, candidates: string[]): string | null {
  if (candidates.includes(title)) return title;
  const wanted = parts(title);
  let best: string | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const other = parts(candidate);
    if (other.base !== wanted.base || other.tags[0] !== wanted.tags[0])
      continue;
    const shared = other.tags.filter((tag) => wanted.tags.includes(tag)).length;
    const penalty = other.tags.some(
      (tag) =>
        ["beta", "demo", "proto", "alt"].includes(tag) &&
        !wanted.tags.includes(tag),
    )
      ? 1
      : 0;
    const score = shared * 2 - penalty;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** "Legends of Owlia, The (World)" -> "The Legends of Owlia". */
export function displayTitle(title: string): string {
  const base = title.replace(/\s*\(.*$/, "").trim();
  const article = /^(.*), (The|A|An)$/.exec(base);
  return article ? `${article[2]} ${article[1]}` : base;
}
