// SPDX-License-Identifier: MIT
/** Read-only ROM identification: header signatures, bun-engine NDS intake and Magika content type. */
import { basename, resolve } from "node:path";
import {
  identifyWithMagika,
  type MagikaPrediction,
} from "../../bun-engine/src/ml/magika.ts";
import {
  inspectNdsReplica,
  type NdsReplicaReport,
} from "../../bun-engine/src/pipeline/nds-replica.ts";

export interface RomInfo {
  path: string;
  name: string;
  size: number;
  sha256: string;
  platform: string | null;
  header: Record<string, string | number>;
  nds: NdsReplicaReport["cartridge"] | null;
  magika: MagikaPrediction | { error: string };
}

const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];
const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];
const text = (b: Uint8Array) =>
  new TextDecoder("latin1").decode(b).replace(/\0/g, "").trim();
const has = (b: Uint8Array, at: number, sig: number[]) =>
  sig.every((v, i) => b[at + i] === v);

function sniff(h: Uint8Array): {
  platform: string | null;
  header: Record<string, string | number>;
} {
  const view = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length >= 0xc0 && has(h, 0x04, GBA_LOGO))
    return {
      platform: "game-boy-advance",
      header: {
        title: text(h.subarray(0xa0, 0xac)),
        gameCode: text(h.subarray(0xac, 0xb0)),
        makerCode: text(h.subarray(0xb0, 0xb2)),
        version: h[0xbc]!,
      },
    };
  if (h.length >= 0x150 && has(h, 0x104, GB_LOGO))
    return {
      platform: h[0x143]! & 0x80 ? "game-boy-color" : "game-boy",
      header: {
        title: text(h.subarray(0x134, 0x143)),
        cartridgeType: h[0x147]!,
        romSize: 32768 << h[0x148]!,
        ramSize: h[0x149]!,
      },
    };
  if (h.length >= 16 && text(h.subarray(0, 4)) === "NES\x1a")
    return {
      platform: "nintendo-nes",
      header: {
        prgRom: h[4]! * 16384,
        chrRom: h[5]! * 8192,
        mapper: (h[6]! >> 4) | (h[7]! & 0xf0),
        nes2: (h[7]! & 0x0c) === 0x08 ? 1 : 0,
      },
    };
  if (h.length >= 0x40) {
    const n64 = view.getUint32(0, false);
    if (n64 === 0x80371240 || n64 === 0x37804012 || n64 === 0x40123780)
      return {
        platform: "nintendo-64",
        header: {
          byteOrder:
            n64 === 0x80371240 ? "z64" : n64 === 0x37804012 ? "v64" : "n64",
          title: n64 === 0x80371240 ? text(h.subarray(0x20, 0x34)) : "",
          gameCode: n64 === 0x80371240 ? text(h.subarray(0x3b, 0x3f)) : "",
        },
      };
  }
  if (h.length >= 0x200 && text(h.subarray(0x100, 0x110)).startsWith("SEGA"))
    return {
      platform: "sega-mega-drive",
      header: {
        system: text(h.subarray(0x100, 0x110)),
        title: text(h.subarray(0x150, 0x180)),
        serial: text(h.subarray(0x180, 0x18e)),
        region: text(h.subarray(0x1f0, 0x1f3)),
      },
    };
  if (h.length >= 0x20 && view.getUint32(0x1c, false) === 0xc2339f3d)
    return {
      platform: "gamecube",
      header: {
        gameId: text(h.subarray(0, 6)),
        title: text(h.subarray(0x20, 0x60)),
      },
    };
  if (h.length >= 0x20 && view.getUint32(0x18, false) === 0x5d1c9ea3)
    return {
      platform: "wii",
      header: {
        gameId: text(h.subarray(0, 6)),
        title: text(h.subarray(0x20, 0x60)),
      },
    };
  if (h.length >= 0x104 && text(h.subarray(0x100, 0x104)) === "NCSD")
    return {
      platform: "nintendo-3ds",
      header: { mediaId: view.getBigUint64(0x108, true).toString(16) },
    };
  return { platform: null, header: {} };
}

export async function inspectRom(input: string): Promise<RomInfo> {
  const path = resolve(input);
  const file = Bun.file(path);
  const head = new Uint8Array(await file.slice(0, 0x10000).arrayBuffer());
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of file.stream()) hasher.update(chunk);
  let nds: RomInfo["nds"] = null;
  let { platform, header } = sniff(head);
  if (!platform) {
    try {
      nds = (await inspectNdsReplica(path)).cartridge;
      platform = "nintendo-ds";
    } catch {}
  }
  const magika = await identifyWithMagika(path).catch((error: Error) => ({
    error: error.message,
  }));
  return {
    path,
    name: basename(path),
    size: file.size,
    sha256: hasher.digest("hex"),
    platform,
    header,
    nds,
    magika,
  };
}
