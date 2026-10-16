import type { BunPlugin } from "bun";

export interface BinaryFormatLoader {
  id: string;
  extensions: readonly string[];
  plugin: BunPlugin;
}

const formats = [
  ["nintendo-ds", ["nds", "dsi"]],
  ["game-boy", ["gb", "gbc"]],
  ["game-boy-advance", ["gba"]],
  ["nintendo-nes", ["nes", "fds"]],
  ["nintendo-64", ["n64", "z64", "v64"]],
  ["nintendo-3ds", ["3ds", "cci", "cxi"]],
  ["nintendo-switch", ["nsp", "xci", "nro"]],
  ["gamecube-wii-disc", ["iso", "gcm", "wbfs", "rvz"]],
  ["powerpc-executable", ["dol"]],
  ["playstation-disc", ["cue", "chd", "pbp"]],
  ["android-package", ["apk", "apks", "aab"]],
  ["webassembly", ["wasm"]],
  ["firmware", ["firmware", "rom", "bios"]],
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLoader(id: string, extensions: readonly string[]): BinaryFormatLoader {
  const filter = new RegExp(`\\.(${extensions.map(escapeRegExp).join("|")})$`, "i");
  const plugin: BunPlugin = {
    name: `bun-engine:loader:${id}`,
    setup(build) {
      build.onLoad({ filter, namespace: "file" }, async ({ path }) => ({
        contents: await Bun.file(path).arrayBuffer(),
        loader: "file",
      }));
    },
  };
  return { id, extensions, plugin };
}

export const binaryFormatLoaders = formats.map(([id, extensions]) => formatLoader(id, extensions));
export const formatPlugins = binaryFormatLoaders.map(({ plugin }) => plugin);
