// SPDX-License-Identifier: Apache-2.0
/**
 * Built-in plugin over the Bun Engine owner. Loaded by path at runtime so @bun-os/platform does
 * not depend on @aphrody/bun-engine (bep imports the platform's transfer service).
 */
import { join } from "node:path";
import { definePlugin, type Detection } from "../../src/plugins";
import { repoRoot } from "../../src/paths";

const engine = join(repoRoot, "packages", "bun-engine");
type Formats = typeof import("../../../bun-engine/src/formats/index.ts");
let formats: Promise<Formats> | null = null;
const load = () =>
  (formats ??= import(
    join(engine, "src", "formats", "index.ts")
  ) as Promise<Formats>);

const FIRMWARE = new Set([
  "gba-bios",
  "nds-arm7-bios",
  "nds-arm9-bios",
  "nds-firmware",
  "psx-bios",
]);

export default definePlugin({
  name: "bun-engine",
  async setup(build) {
    build.onDetect({}, async ({ path, size }) => {
      if (size === 0) return null;
      const { BinarySource, detect } = await load();
      const d = await detect(BinarySource.open(path), path);
      if (d.format === "unknown") return null;
      const detection: Detection = {
        kind: FIRMWARE.has(d.format) ? "firmware" : "rom",
        format: d.format,
        platform: d.platform,
        confidence: d.confidence,
        by: `bun-engine:${d.by}`,
      };
      return detection;
    });

    build.onPreview({ kind: "rom" }, async ({ path }) => {
      const { BinaryImage } = await load();
      const image = await BinaryImage.open(path);
      return {
        kind: "rom",
        metadata: image.toJSON() as unknown as Record<string, unknown>,
      };
    });
    build.onPreview({ kind: "firmware" }, async ({ path }) => {
      const { BinaryImage } = await load();
      const image = await BinaryImage.open(path);
      const digest = await image.digest();
      return {
        kind: "firmware",
        metadata: {
          ...(image.toJSON() as unknown as Record<string, unknown>),
          sha256: digest.sha256,
        },
      };
    });

    const { consoleIds } = (await import(
      join(engine, "src", "plugins", "consoles.ts")
    )) as typeof import("../../../bun-engine/src/plugins/consoles.ts");
    for (const id of consoleIds)
      build.addMachine({ id, systems: [id], console: `bun-engine:${id}` });

    const consoles = join(engine, "plugins", "consoles");
    build.addGameSource({
      id: "free-rom-packs",
      labelKey: "plugin-bun-engine-free-roms",
      async list() {
        const roms = (await Bun.file(join(consoles, "roms.json")).json()) as {
          packs: {
            id: string;
            console: string;
            url?: string;
            source?: string;
          }[];
        };
        return roms.packs.map((p) => ({
          id: p.id,
          title: p.id,
          system: p.console,
          url: p.url,
          path: p.source,
        }));
      },
    });

    // `bep:<service>/<path>` -> every URL of that mirrors.json service, seed order.
    const mirrors = (await Bun.file(join(consoles, "mirrors.json")).json()) as {
      services: Record<string, { urls: string[] }>;
    };
    build.addTransferProvider({
      id: "bep-mirrors",
      match: (url) => url.startsWith("bep:"),
      async resolve(url) {
        const [service, ...rest] = url.slice(4).split("/");
        const urls = mirrors.services[service ?? ""]?.urls ?? [];
        return urls.map((u) => `${u.replace(/\/$/, "")}/${rest.join("/")}`);
      },
    });
  },
});
