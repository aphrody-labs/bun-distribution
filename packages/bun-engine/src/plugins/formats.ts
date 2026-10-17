import type { BunPlugin } from "bun";
import { extensionFilter, setupRomLoader } from "../../../bun-loaders/src/rom.ts";

export interface BinaryFormatLoader {
  id: string;
  extensions: readonly string[];
  /** "image": typed BinaryImage through the @aphrody/bun-loaders console loader; "file": Bun's asset `file` loader. */
  kind: "image" | "file";
  plugin: BunPlugin;
}

const formats = [
  ["nintendo-ds", ["nds", "dsi", "srl"], "image"],
  ["game-boy", ["gb", "gbc"], "image"],
  ["game-boy-advance", ["gba", "agb", "mb"], "image"],
  ["nintendo-nes", ["nes", "fds"], "image"],
  ["nintendo-64", ["n64", "z64", "v64"], "image"],
  ["nintendo-3ds", ["3ds", "cci", "cxi"], "image"],
  ["nintendo-switch", ["nsp", "xci", "nro"], "image"],
  ["gamecube-wii-disc", ["iso", "gcm", "wbfs", "rvz", "wia"], "image"],
  ["powerpc-executable", ["dol"], "image"],
  ["elf-executable", ["elf", "axf"], "image"],
  ["playstation-disc", ["cue", "chd", "pbp", "psx"], "image"],
  ["raw-binary", ["bin"], "image"],
  ["sega-genesis", ["md", "gen", "smd"], "image"],
  ["firmware", ["firmware", "rom", "bios"], "image"],
  ["android-package", ["apk", "apks", "aab"], "file"],
  ["webassembly", ["wasm"], "file"],
] as const;

function formatLoader(id: string, extensions: readonly string[], kind: "image" | "file"): BinaryFormatLoader {
  const plugin: BunPlugin = {
    name: `bun-engine:loader:${id}`,
    setup(build) {
      if (kind === "image") return setupRomLoader(build, extensions);
      build.onLoad({ filter: extensionFilter(extensions), namespace: "file" }, async ({ path }) => ({
        contents: await Bun.file(path).arrayBuffer(),
        loader: "file",
      }));
    },
  };
  return { id, extensions, kind, plugin };
}

export const binaryFormatLoaders = formats.map(([id, extensions, kind]) => formatLoader(id, extensions, kind));
export const formatPlugins = binaryFormatLoaders.map(({ plugin }) => plugin);
