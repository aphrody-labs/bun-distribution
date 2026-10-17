// BIOS and firmware dumps: GBA BIOS, Nintendo DS ARM7/ARM9 BIOS, DS firmware SPI flash and
// PlayStation BIOS. Mapping bases match src/nds/loader.ts (NintendoDsFirmware); dumps are named
// from plugins/consoles/firmware.json (public hashes) and the SHA-256 equals the `bep firmware`
// store key of src/firmware/import.ts.
import { basename } from "node:path";
import { catalogFirmware, freeReplacements } from "../catalog";
import { BinaryView, crc16, digestSource, hex32 } from "../stream";
import type { FormatId, ParseContext, ParsedImage } from "../types";
import { armBranchTarget } from "./handheld";

const layouts: Partial<
  Record<
    FormatId,
    {
      console: string;
      catalog: string;
      address: number;
      arch: "arm" | "r3000";
      bytes: number;
    }
  >
> = {
  "gba-bios": {
    console: "Game Boy Advance",
    catalog: "nintendo-game-boy-advance",
    address: 0x00000000,
    arch: "arm",
    bytes: 0x4000,
  },
  "nds-arm7-bios": {
    console: "Nintendo DS (ARM7)",
    catalog: "nintendo-ds",
    address: 0x00000000,
    arch: "arm",
    bytes: 0x4000,
  },
  "nds-arm9-bios": {
    console: "Nintendo DS (ARM9)",
    catalog: "nintendo-ds",
    address: 0xffff0000,
    arch: "arm",
    bytes: 0x1000,
  },
  "psx-bios": {
    console: "PlayStation",
    catalog: "sony-playstation",
    address: 0xbfc00000,
    arch: "r3000",
    bytes: 0x80000,
  },
};

/** ARM exception vector table: eight `B` instructions or `LDR pc, [pc, #x]`. */
export function hasArmVectors(view: BinaryView): boolean {
  if (!view.has(0, 0x20)) return false;
  let branches = 0;
  for (let at = 0; at < 0x20; at += 4) {
    const word = view.u32(at);
    if (word >>> 24 === 0xea || (word & 0xfffff000) === 0xe59ff000) branches++;
  }
  return branches >= 6;
}

/** Classifies a 16 KiB ARM BIOS from its file name, defaulting to the GBA layout. */
export function armBiosFormat(path: string, size: number): FormatId {
  if (size === 0x1000) return "nds-arm9-bios";
  return /nds|7|arm7/i.test(basename(path)) && !/gba|agb/i.test(basename(path))
    ? "nds-arm7-bios"
    : "gba-bios";
}

/** DS firmware: the user-settings block (two copies) at the end carries a CRC-16. */
export function looksLikeNdsFirmware(tail: BinaryView): boolean {
  if (tail.length < 0x200) return false;
  return [0, 0x100].some(
    (at) =>
      tail.u16(at) === 5 && crc16(tail.slice(at, 0x70)) === tail.u16(at + 0x72),
  );
}

export function biosParser(format: FormatId) {
  return async ({ source, head }: ParseContext): Promise<ParsedImage> => {
    const view = new BinaryView(head);
    const digest = await digestSource(source);
    const known = await catalogFirmware(digest);
    const identity = {
      crc32: digest.crc32,
      sha1: digest.sha1,
      sha256: digest.sha256,
      known,
    };
    if (format === "nds-firmware") {
      const tail = await source.view(source.size - 0x200, 0x200);
      const settings = [0, 0x100].find(
        (at) =>
          tail.u16(at) === 5 &&
          crc16(tail.slice(at, 0x70)) === tail.u16(at + 0x72),
      );
      const user =
        settings === undefined ? undefined : tail.slice(settings, 0x100);
      const nickname = user
        ? new TextDecoder("utf-16le").decode(
            user.subarray(6, 6 + new BinaryView(user).u8(0x1a) * 2),
          )
        : undefined;
      return {
        header: {
          console: "Nintendo DS",
          bytes: source.size,
          ...identity,
          freeReplacements: known.length
            ? undefined
            : await freeReplacements("nintendo-ds"),
          identifier: view.hex(0x08, 4),
          consoleType:
            {
              0xff: "DS",
              0x20: "DS Lite",
              0x57: "DSi",
              0x43: "iQue DS",
              0x63: "iQue DS Lite",
            }[view.u8(0x1d)] ?? view.u8(0x1d),
          userSettingsValid: settings !== undefined,
          nicknameLength: nickname?.length,
        },
        sections: [
          { name: "header", offset: 0, size: 0x200, kind: "header" },
          {
            name: "user-settings",
            offset: source.size - 0x200,
            size: 0x200,
            kind: "data",
          },
        ],
      };
    }
    const layout = layouts[format]!;
    const reset =
      layout.arch === "arm"
        ? armBranchTarget(view.u32(0), layout.address)
        : layout.address;
    return {
      header: {
        console: layout.console,
        bytes: source.size,
        expectedBytes: layout.bytes,
        ...identity,
        freeReplacements: known.length
          ? undefined
          : await freeReplacements(layout.catalog),
        mappedAt: hex32(layout.address),
        firstWord: hex32(view.u32(0)),
        resetTarget: reset === undefined ? undefined : hex32(reset),
        vectorTable: layout.arch === "arm" ? hasArmVectors(view) : undefined,
        copyright:
          layout.arch === "r3000" ? view.ascii(0x108, 0x30) : undefined,
      },
      sections: [
        {
          name: "bios",
          offset: 0,
          size: source.size,
          address: layout.address,
          arch: layout.arch,
          kind: "code",
        },
      ],
      arch: layout.arch,
      entry: layout.address,
    };
  };
}
