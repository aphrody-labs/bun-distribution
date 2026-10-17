// SPDX-License-Identifier: MIT
import type { BunPlugin } from "bun";
import { parseApk } from "./apk.ts";
import { csharpExports } from "./dotnet.ts";
import { inspectMedia } from "./media.ts";
import { parsePe } from "./pe.ts";
import { powershellExports } from "./pwsh.ts";
import { setupRomLoader } from "./rom.ts";
import { inspectScene } from "./scene.ts";

type Exports = Record<string, unknown>;

const metadata = (value: object): Exports => ({
  ...value,
  default: value,
  metadata: value,
});

/**
 * Ordered (extension filter, exports factory) table; `import x from "./file.ext"` yields its
 * inspection. Console binaries (ROM, disc, executable, BIOS) are registered first by
 * setupRomLoader so `.3ds` and `.bin` resolve to the console parser.
 */
const LOADERS: [RegExp, (path: string) => Promise<Exports>][] = [
  [/\.cs$/i, csharpExports],
  [/\.ps1$/i, powershellExports],
  [/\.(dll|exe|sys|efi|ocx|cpl|scr|drv|mui)$/i, async path => metadata(parsePe(await Bun.file(path).bytes(), path))],
  [/\.(apk|apks|aab)$/i, async path => metadata(parseApk(await Bun.file(path).bytes(), path))],
  [/\.(gltf|glb|obj|fbx|dae|abc|usd[acz]?|ply|stl|x3d|3ds|blend)$/i, async path => metadata(await inspectScene(path))],
  [
    /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|heic|heif|ico|mp4|m4v|mkv|webm|mov|avi|wmv|flv)$/i,
    async path => metadata(await inspectMedia(path)),
  ],
];

export const loadersPlugin: BunPlugin = {
  name: "bun-loaders",
  setup(build) {
    setupRomLoader(build);
    for (const [filter, load] of LOADERS) {
      build.onLoad({ filter, namespace: "file" }, async ({ path }) => ({
        exports: await load(path),
        loader: "object",
      }));
    }
  },
};

export function registerLoaders(): void {
  Bun.plugin(loadersPlugin);
}

export default loadersPlugin;
