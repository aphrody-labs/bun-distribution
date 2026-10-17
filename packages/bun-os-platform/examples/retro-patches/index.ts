// SPDX-License-Identifier: Apache-2.0
/**
 * Sample Bun OS plugin, the `Bun.plugin` shape: `{ name, setup(build) }`.
 * - a file loader: IPS, BPS and UPS ROM patches detected by their magic, with a parsed preview;
 * - a theme (`themes/retro-green.toml`) and catalogs (`locales/<tag>/retro-patches.ftl`), read
 *   statically from the plugin directory;
 * - a menu entry in the shell quick menu and play's navigation, running `list-patches`.
 * Install: copy to usr/lib/bun-os/plugins/retro-patches, then `bun-os-platform plugins pin <dir>`.
 */
import type { BunOsPlugin, Detection } from "@bun-os/platform/plugins";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const MAGIC: Record<string, string> = {
  PATCH: "ips",
  BPS1: "bps",
  UPS1: "ups",
};

function ascii(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

/** IPS records: 3-byte offset, 2-byte size (0 = RLE run), until "EOF". */
function ipsRecords(bytes: Uint8Array): number {
  let at = 5;
  let records = 0;
  while (at + 3 <= bytes.length && ascii(bytes, at, 3) !== "EOF") {
    const size = ((bytes[at + 3] ?? 0) << 8) | (bytes[at + 4] ?? 0);
    at += 5 + (size === 0 ? 3 : size);
    records++;
  }
  return records;
}

/** BPS/UPS variable-length integers. */
function varint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let shift = 1;
  for (;;) {
    const x = bytes[at++] ?? 0x80;
    value += (x & 0x7f) * shift;
    if (x & 0x80) return [value, at];
    shift *= 128;
    value += shift;
  }
}

const plugin: BunOsPlugin = {
  name: "retro-patches",
  setup(build) {
    for (const [magic, format] of Object.entries(MAGIC))
      build.onDetect({ magic }, ({ head }): Detection => ({
        kind: "patch",
        format,
        mime: "application/octet-stream",
        confidence: ascii(head, 0, magic.length) === magic ? 1 : 0,
        by: "retro-patches:magic",
      }));

    build.onPreview({ kind: "patch" }, async ({ path, detection }) => {
      const bytes = await Bun.file(path).bytes();
      if (detection.format === "ips")
        return {
          kind: "patch",
          metadata: { format: "ips", records: ipsRecords(bytes) },
        };
      const [source, next] = varint(bytes, 4);
      const [target] = varint(bytes, next);
      return {
        kind: "patch",
        metadata: {
          format: detection.format,
          sourceSize: source,
          targetSize: target,
          records: 1,
        },
      };
    });

    build.addMenuEntry({
      id: "patches",
      labelKey: "retro-patches-menu",
      icon: "healing",
      location: "quick-menu",
      command: "list-patches",
    });
    build.addMenuEntry({
      id: "patches-nav",
      labelKey: "retro-patches-menu",
      icon: "healing",
      location: "nav",
      command: "list-patches",
    });

    build.onCommand("list-patches", () => {
      const dir = join(
        Bun.env.BUN_OS_USR ?? join(build.dir, "..", "..", "..", ".."),
        "share",
        "bun-engine",
        "patches",
      );
      try {
        return readdirSync(dir).filter((f) => /\.(ips|bps|ups)$/i.test(f));
      } catch {
        return [];
      }
    });
  },
};

export default plugin;
