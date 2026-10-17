// SPDX-License-Identifier: MIT
/**
 * Console ROM, disc, executable and BIOS loader. Detection, parsers, streams and disassembly are
 * owned by packages/bun-engine/src/formats (`bun-engine formats`); this module is the single
 * Bun.plugin entry that exposes them as `import rom from "./game.nes"`.
 */
import type { PluginBuilder } from "bun";
import {
  BinaryImage,
  type ImageSummary,
} from "../../bun-engine/src/formats/index.ts";

/** Extensions routed to the console loader; content detection decides the real format. */
export const romExtensions = [
  "nes",
  "fds",
  "gb",
  "gbc",
  "gba",
  "agb",
  "mb",
  "nds",
  "dsi",
  "srl",
  "n64",
  "z64",
  "v64",
  "dol",
  "elf",
  "axf",
  "iso",
  "gcm",
  "wbfs",
  "wia",
  "rvz",
  "bin",
  "cue",
  "chd",
  "pbp",
  "psx",
  "3ds",
  "cci",
  "cxi",
  "nsp",
  "xci",
  "nro",
  "rom",
  "bios",
  "firmware",
  "md",
  "gen",
  "smd",
] as const;

export function extensionFilter(extensions: readonly string[]): RegExp {
  return new RegExp(
    `\\.(${extensions.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
    "i",
  );
}

export interface RomInfo extends ImageSummary {
  sha256: string;
}

/** Full inspection: parsed image, streaming SHA-256 and a Magika content type through `re`. */
export async function inspectRom(input: string): Promise<RomInfo> {
  const image = await BinaryImage.open(input, { magika: true });
  return { ...image.toJSON(), sha256: (await image.digest()).sha256 };
}

/** Module namespace for one image: the live BinaryImage plus its header, sections and summary. */
export async function romExports(
  path: string,
): Promise<Record<string, unknown>> {
  const image = await BinaryImage.open(path);
  return {
    default: image,
    image,
    format: image.format,
    platform: image.platform,
    header: image.header,
    sections: image.sections,
    entry: image.entry,
    arch: image.arch,
    summary: image.toJSON(),
  };
}

/**
 * Registers the console loader on a runtime (Bun.plugin) or bundler (Bun.build) builder. At
 * runtime the module exports the live object with lazy accessors; under Bun.build it inlines the
 * JSON summary so a bundle or single-file executable carries metadata without the ROM bytes.
 */
export function setupRomLoader(
  build: PluginBuilder,
  extensions: readonly string[] = romExtensions,
): void {
  const bundling = "config" in build && build.config !== undefined;
  build.onLoad(
    { filter: extensionFilter(extensions), namespace: "file" },
    async ({ path }) =>
      bundling
        ? {
            contents: JSON.stringify((await BinaryImage.open(path)).toJSON()),
            loader: "json",
          }
        : { exports: await romExports(path), loader: "object" },
  );
}
