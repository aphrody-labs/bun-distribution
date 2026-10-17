// NES/Famicom Disk System, Game Boy (Color), Game Boy Advance and Nintendo DS(i) cartridges.
// The DS header layout follows crates/bun-engine-core/src/cartridge.rs and
// packages/re/src/replica/nds.ts; validation is delegated to the native `bun-engine info`.
import { BinaryView, crc16, hex, hex32 } from "../stream.js";
import { nativeNdsInfo } from "../tools.js";
import {
  parsed,
  type FileEntry,
  type ParseContext,
  type Section,
} from "../types.js";

export const regionByGameCode: Record<string, string> = {
  A: "Asia",
  C: "China",
  D: "Germany",
  E: "USA",
  F: "France",
  H: "Netherlands",
  I: "Italy",
  J: "Japan",
  K: "Korea",
  L: "USA (Latin America)",
  O: "International",
  P: "Europe",
  R: "Russia",
  S: "Spain",
  U: "Australia",
  V: "Europe",
  W: "International",
  X: "Europe",
  Y: "Europe",
  Z: "Europe",
};

const nesMappers: Record<number, string> = {
  0: "NROM",
  1: "MMC1 (SxROM)",
  2: "UxROM",
  3: "CNROM",
  4: "MMC3 (TxROM)",
  5: "MMC5 (ExROM)",
  7: "AxROM",
  9: "MMC2 (PxROM)",
  10: "MMC4 (FxROM)",
  11: "Color Dreams",
  19: "Namco 163",
  24: "VRC6a",
  26: "VRC6b",
  28: "Action 53",
  30: "UNROM 512",
  34: "BNROM / NINA-001",
  66: "GxROM",
  69: "Sunsoft FME-7",
  71: "Camerica BF9093",
  85: "VRC7",
  111: "GTROM",
};

/** iNES / NES 2.0 cartridge with PRG banks mapped as the common fixed-last-bank layout. */
export async function parseNes({ source, head }: ParseContext) {
  const view = new BinaryView(head);
  const flags6 = view.u8(6);
  const flags7 = view.u8(7);
  const nes2 = (flags7 & 0x0c) === 0x08;
  const romUnits = (lsb: number, msb: number, unit: number) =>
    msb === 0x0f
      ? 2 ** (lsb >> 2) * ((lsb & 3) * 2 + 1)
      : ((msb << 8) | lsb) * unit;
  const prgBytes = nes2
    ? romUnits(view.u8(4), view.u8(9) & 0x0f, 16384)
    : view.u8(4) * 16384;
  const chrBytes = nes2
    ? romUnits(view.u8(5), view.u8(9) >> 4, 8192)
    : view.u8(5) * 8192;
  const mapper =
    (flags6 >> 4) | (flags7 & 0xf0) | (nes2 ? (view.u8(8) & 0x0f) << 8 : 0);
  const trainer = (flags6 & 0x04) !== 0;
  const prgOffset = 16 + (trainer ? 512 : 0);
  const chrOffset = prgOffset + prgBytes;
  const timing = nes2
    ? (["NTSC", "PAL", "multi-region", "Dendy"][view.u8(12) & 3] ?? "NTSC")
    : view.u8(9) & 1
      ? "PAL"
      : "NTSC";

  const vectors = await source.view(prgOffset + prgBytes - 6, 6);
  const vector = (at: number) =>
    vectors.length >= at + 2 ? vectors.u16(at) : 0;
  const sections: Section[] = [
    { name: "header", offset: 0, size: 16, kind: "header" },
  ];
  if (trainer)
    sections.push({
      name: "trainer",
      offset: 16,
      size: 512,
      address: 0x7000,
      kind: "data",
    });
  const banks = Math.max(1, Math.ceil(prgBytes / 0x4000));
  for (let bank = 0; bank < banks; bank++) {
    const offset = prgOffset + bank * 0x4000;
    const size = Math.min(0x4000, prgBytes - bank * 0x4000);
    const last = bank === banks - 1;
    if (bank === 0 || last) {
      if (last)
        sections.push({
          name: `prg[${bank}]`,
          offset,
          size,
          address: 0xc000,
          arch: "6502",
          kind: "code",
        });
      if (bank === 0)
        sections.push({
          name: last ? "prg[0]@8000" : "prg[0]",
          offset,
          size,
          address: 0x8000,
          arch: "6502",
          kind: "code",
        });
    } else
      sections.push({
        name: `prg[${bank}]`,
        offset,
        size,
        arch: "6502",
        kind: "code",
      });
  }
  if (chrBytes)
    sections.push({
      name: "chr",
      offset: chrOffset,
      size: chrBytes,
      kind: "data",
    });

  const [prgCrc, chrCrc] = await Promise.all([
    source.crc32(prgOffset, prgOffset + prgBytes),
    chrBytes
      ? source.crc32(chrOffset, chrOffset + chrBytes)
      : Promise.resolve(0),
  ]);
  return parsed({
    header: {
      container: nes2 ? "NES 2.0" : "iNES",
      prgRomBytes: prgBytes,
      chrRomBytes: chrBytes,
      chrRam: chrBytes === 0,
      mapper,
      mapperName: nesMappers[mapper] ?? "unknown",
      submapper: nes2 ? view.u8(8) >> 4 : undefined,
      mirroring:
        flags6 & 0x08 ? "four-screen" : flags6 & 1 ? "vertical" : "horizontal",
      battery: (flags6 & 0x02) !== 0,
      trainer,
      timing,
      console: ["NES/Famicom", "Vs. System", "PlayChoice-10", "extended"][
        flags7 & 3
      ],
      vectors: {
        nmi: hex(vector(0), 4),
        reset: hex(vector(2), 4),
        irq: hex(vector(4), 4),
      },
      prgCrc32: hex32(prgCrc),
      chrCrc32: chrBytes ? hex32(chrCrc) : undefined,
      truncated: source.size < chrOffset + chrBytes,
    },
    sections,
    arch: "6502",
    entry: vector(2),
  });
}

/** Famicom Disk System image with or without the 16-byte fwNES header. */
export async function parseFds({ source, head }: ParseContext) {
  const view = new BinaryView(head);
  const wrapped = view.equals(0, "FDS\x1a");
  const base = wrapped ? 16 : 0;
  const sideBytes = 65500;
  const sides = wrapped ? view.u8(4) : Math.floor(source.size / sideBytes);
  const sections: Section[] = wrapped
    ? [{ name: "header", offset: 0, size: 16, kind: "header" }]
    : [];
  for (let side = 0; side < sides; side++)
    sections.push({
      name: `side[${side}]`,
      offset: base + side * sideBytes,
      size: sideBytes,
      kind: "filesystem",
    });
  return parsed({
    header: {
      sides,
      manufacturer: hex(view.u8(base + 0x0f), 2),
      gameName: view.ascii(base + 0x10, 3),
      gameType: String.fromCharCode(view.u8(base + 0x13)),
      revision: view.u8(base + 0x14),
      diskVerified: view.equals(base + 1, "*NINTENDO-HVC*"),
    },
    sections,
    arch: "6502",
  });
}

const gbCartridgeTypes: Record<number, string> = {
  0x00: "ROM ONLY",
  0x01: "MBC1",
  0x02: "MBC1+RAM",
  0x03: "MBC1+RAM+BATTERY",
  0x05: "MBC2",
  0x06: "MBC2+BATTERY",
  0x0f: "MBC3+TIMER+BATTERY",
  0x10: "MBC3+TIMER+RAM+BATTERY",
  0x11: "MBC3",
  0x12: "MBC3+RAM",
  0x13: "MBC3+RAM+BATTERY",
  0x19: "MBC5",
  0x1a: "MBC5+RAM",
  0x1b: "MBC5+RAM+BATTERY",
  0x1c: "MBC5+RUMBLE",
  0x1d: "MBC5+RUMBLE+RAM",
  0x1e: "MBC5+RUMBLE+RAM+BATTERY",
  0x20: "MBC6",
  0x22: "MBC7+SENSOR+RUMBLE+RAM+BATTERY",
  0xfc: "POCKET CAMERA",
  0xfd: "BANDAI TAMA5",
  0xfe: "HuC3",
  0xff: "HuC1+RAM+BATTERY",
};

/** First bytes of the boot logo bitmap, also used as the Game Boy signature (packages/bun-loaders). */
export const gbLogoPrefix = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];

/** Game Boy / Game Boy Color cartridge header at 0x100 with both checksums verified. */
export async function parseGameBoy({ source, head }: ParseContext) {
  const view = new BinaryView(head, "be");
  const cgbFlag = view.u8(0x143);
  const cgb = (cgbFlag & 0x80) !== 0;
  let headerSum = 0;
  for (let at = 0x134; at <= 0x14c; at++)
    headerSum = (headerSum - view.u8(at) - 1) & 0xff;
  let globalSum = 0;
  for await (const { offset, bytes } of source.chunks()) {
    for (let index = 0; index < bytes.byteLength; index++) {
      const at = offset + index;
      if (at !== 0x14e && at !== 0x14f)
        globalSum = (globalSum + bytes[index]!) & 0xffff;
    }
  }
  const romBytes = 0x8000 << view.u8(0x148);
  const ramBytes = [0, 0, 8, 32, 128, 64][view.u8(0x149)] ?? 0;
  const sections: Section[] = [
    {
      name: "header",
      offset: 0x100,
      size: 0x50,
      address: 0x100,
      kind: "header",
    },
  ];
  for (let bank = 0; bank * 0x4000 < source.size; bank++) {
    sections.push({
      name: `rom[${bank}]`,
      offset: bank * 0x4000,
      size: Math.min(0x4000, source.size - bank * 0x4000),
      address: bank === 0 ? 0 : bank === 1 ? 0x4000 : undefined,
      arch: "lr35902",
      kind: "code",
    });
  }
  return parsed({
    header: {
      title: view.ascii(0x134, cgb ? 11 : 16),
      manufacturer: cgb ? view.ascii(0x13f, 4) : undefined,
      cgb: cgbFlag === 0xc0 ? "required" : cgb ? "supported" : "none",
      sgb: view.u8(0x146) === 0x03,
      cartridgeType: hex(view.u8(0x147), 2),
      cartridgeName: gbCartridgeTypes[view.u8(0x147)] ?? "unknown",
      romBytes,
      ramKiB: ramBytes,
      region: view.u8(0x14a) === 0 ? "Japan" : "Overseas",
      licensee:
        view.u8(0x14b) === 0x33 ? view.ascii(0x144, 2) : hex(view.u8(0x14b), 2),
      version: view.u8(0x14c),
      headerChecksum: hex(view.u8(0x14d), 2),
      headerChecksumValid: headerSum === view.u8(0x14d),
      globalChecksum: hex(view.u16(0x14e), 4),
      globalChecksumValid: globalSum === view.u16(0x14e),
      logoPrefixValid: view.equals(0x104, gbLogoPrefix),
    },
    sections,
    arch: "lr35902",
    entry: 0x100,
  });
}

/** Decodes the target of an ARM `B` instruction at `address`. */
export function armBranchTarget(
  word: number,
  address: number,
): number | undefined {
  if (word >>> 24 !== 0xea) return undefined;
  const offset = ((word & 0xffffff) << 8) >> 6;
  return (address + 8 + offset) >>> 0;
}

/** Game Boy Advance cartridge (or multiboot image) with complement and logo checks. */
export async function parseGba({ source, head, path }: ParseContext) {
  const view = new BinaryView(head);
  const multiboot = /\.mb$/i.test(path);
  const base = multiboot ? 0x02000000 : 0x08000000;
  let complement = 0;
  for (let at = 0xa0; at <= 0xbc; at++)
    complement = (complement - view.u8(at)) & 0xff;
  complement = (complement - 0x19) & 0xff;
  const gameCode = view.ascii(0xac, 4);
  const saves = await source.matches(
    /(EEPROM|SRAM_F|SRAM|FLASH1M|FLASH512|FLASH)_V(\d{3})?/,
    { limit: 8 },
  );
  const entry = armBranchTarget(view.u32(0), base) ?? base;
  return parsed({
    header: {
      title: view.ascii(0xa0, 12),
      gameCode,
      makerCode: view.ascii(0xb0, 2),
      region: regionByGameCode[gameCode[3] ?? ""] ?? "unknown",
      fixedValueValid: view.u8(0xb2) === 0x96,
      unitCode: view.u8(0xb3),
      deviceType: view.u8(0xb4),
      version: view.u8(0xbc),
      complement: hex(view.u8(0xbd), 2),
      complementValid: complement === view.u8(0xbd),
      logoValid: crc16(view.slice(0x04, 0x9c)) === 0xcf56,
      entry: hex32(entry),
      multiboot,
      saveType: [...new Set(saves.map((save) => save.text))],
      romBytes: source.size,
    },
    sections: [
      { name: "header", offset: 0, size: 0xc0, address: base, kind: "header" },
      {
        name: "rom",
        offset: 0,
        size: source.size,
        address: base,
        arch: "arm",
        kind: "code",
      },
    ],
    arch: "arm",
    entry,
  });
}

/** Structural DS header check for homebrew/test images that carry no boot logo. */
export function looksLikeNds(view: BinaryView, size: number): boolean {
  if (!view.has(0, 0x200)) return false;
  const inRange = (value: number, low: number, high: number) =>
    value >= low && value < high;
  const [arm9Offset, arm9Entry, arm9Ram, arm9Bytes] = [
    view.u32(0x20),
    view.u32(0x24),
    view.u32(0x28),
    view.u32(0x2c),
  ];
  const [arm7Offset, arm7Entry, arm7Ram, arm7Bytes] = [
    view.u32(0x30),
    view.u32(0x34),
    view.u32(0x38),
    view.u32(0x3c),
  ];
  return (
    /^[ -~]{1,12}$/.test(view.ascii(0, 12)) &&
    arm9Offset >= 0x200 &&
    arm9Bytes > 0 &&
    arm9Offset + arm9Bytes <= size &&
    arm7Offset >= 0x200 &&
    arm7Bytes > 0 &&
    arm7Offset + arm7Bytes <= size &&
    inRange(arm9Ram, 0x02000000, 0x02400000) &&
    inRange(arm9Entry, arm9Ram, arm9Ram + arm9Bytes) &&
    (inRange(arm7Ram, 0x02000000, 0x02400000) ||
      inRange(arm7Ram, 0x03000000, 0x03810000)) &&
    inRange(arm7Entry, arm7Ram, arm7Ram + arm7Bytes)
  );
}

const ndsBannerBytes: Record<number, number> = {
  1: 0x840,
  2: 0x940,
  3: 0xa40,
  0x103: 0x23c0,
};

/** Nintendo DS / DSi cartridge: header, ARM9/ARM7 binaries, NitroFS tables, overlays and banner. */
export async function parseNds({ source, head, path }: ParseContext) {
  const view = new BinaryView(head);
  const binary = (at: number) => ({
    romOffset: view.u32(at),
    entry: view.u32(at + 4),
    ramAddress: view.u32(at + 8),
    bytes: view.u32(at + 12),
  });
  const arm9 = binary(0x20);
  const arm7 = binary(0x30);
  const gameCode = view.ascii(0x0c, 4);
  const unitCode = view.u8(0x12);
  const bannerOffset = view.u32(0x68);
  let banner: Record<string, unknown> | undefined;
  const sections: Section[] = [
    {
      name: "header",
      offset: 0,
      size: Math.max(0x200, Math.min(view.u32(0x84) || 0x200, 0x4000)),
      kind: "header",
    },
    {
      name: "arm9",
      offset: arm9.romOffset,
      size: arm9.bytes,
      address: arm9.ramAddress,
      arch: "arm",
      kind: "code",
    },
    {
      name: "arm7",
      offset: arm7.romOffset,
      size: arm7.bytes,
      address: arm7.ramAddress,
      arch: "arm",
      kind: "code",
    },
    {
      name: "fnt",
      offset: view.u32(0x40),
      size: view.u32(0x44),
      kind: "filesystem",
    },
    {
      name: "fat",
      offset: view.u32(0x48),
      size: view.u32(0x4c),
      kind: "filesystem",
    },
  ].filter(
    (section) => section.kind === "header" || section.size > 0,
  ) as Section[];
  if (view.u32(0x54))
    sections.push({
      name: "arm9-overlays",
      offset: view.u32(0x50),
      size: view.u32(0x54),
      kind: "metadata",
    });
  if (view.u32(0x5c))
    sections.push({
      name: "arm7-overlays",
      offset: view.u32(0x58),
      size: view.u32(0x5c),
      kind: "metadata",
    });
  if (bannerOffset && bannerOffset + 0x840 <= source.size) {
    const bannerView = await source.view(bannerOffset, 0x23c0);
    const version = bannerView.u16(0);
    const title = new TextDecoder("utf-16le")
      .decode(bannerView.slice(0x340, 0x100))
      .replace(/\0.*$/s, "");
    banner = {
      version,
      crc16: hex(bannerView.u16(2), 4),
      englishTitle: title.split("\n"),
    };
    sections.push({
      name: "banner",
      offset: bannerOffset,
      size: ndsBannerBytes[version] ?? 0x840,
      kind: "metadata",
    });
  }
  if (unitCode & 0x02 && view.has(0x1c0, 0x20)) {
    const arm9i = binary(0x1c0);
    const arm7i = binary(0x1d0);
    if (arm9i.bytes)
      sections.push({
        name: "arm9i",
        offset: arm9i.romOffset,
        size: arm9i.bytes,
        address: arm9i.ramAddress,
        arch: "arm",
        kind: "code",
      });
    if (arm7i.bytes)
      sections.push({
        name: "arm7i",
        offset: arm7i.romOffset,
        size: arm7i.bytes,
        address: arm7i.ramAddress,
        arch: "arm",
        kind: "code",
      });
  }
  const native = await nativeNdsInfo(path);
  return parsed({
    header: {
      title: view.ascii(0, 12),
      gameCode,
      makerCode: view.ascii(0x10, 2),
      region: regionByGameCode[gameCode[3] ?? ""] ?? "unknown",
      unitCode,
      platform:
        unitCode === 3
          ? "Nintendo DSi"
          : unitCode === 2
            ? "Nintendo DS (DSi enhanced)"
            : "Nintendo DS",
      encryptionSeed: view.u8(0x13),
      capacityBytes: 0x20000 << view.u8(0x14),
      version: view.u8(0x1e),
      autostart: (view.u8(0x1f) & 0x04) !== 0,
      arm9: {
        ...arm9,
        entry: hex32(arm9.entry),
        ramAddress: hex32(arm9.ramAddress),
      },
      arm7: {
        ...arm7,
        entry: hex32(arm7.entry),
        ramAddress: hex32(arm7.ramAddress),
      },
      usedRomBytes: view.u32(0x80),
      headerBytes: view.u32(0x84),
      secureAreaCrc16: hex(view.u16(0x6c), 4),
      logoCrcValid:
        crc16(view.slice(0xc0, 0x9c)) === view.u16(0x15c) &&
        view.u16(0x15c) === 0xcf56,
      headerCrcValid: crc16(view.slice(0, 0x15e)) === view.u16(0x15e),
      banner,
      native,
    },
    sections,
    arch: "arm",
    entry: arm9.entry,
    owners: native ? ["bun-engine info (crates/bun-engine-core)"] : [],
  });
}

/** NitroFS file list from the FNT/FAT tables (directory tree flattened to paths). */
export async function ndsFiles(
  context: Pick<ParseContext, "source">,
  sections: Section[],
): Promise<FileEntry[]> {
  const fnt = sections.find((section) => section.name === "fnt");
  const fat = sections.find((section) => section.name === "fat");
  if (!fnt?.size || !fat?.size) return [];
  const [names, alloc] = await Promise.all([
    context.source.view(fnt.offset, fnt.size),
    context.source.view(fat.offset, fat.size),
  ]);
  const files: FileEntry[] = [];
  const directories = names.u16(6);
  const walk = (id: number, prefix: string, depth: number) => {
    const index = id & 0xfff;
    if (index >= directories || depth > 64) return;
    let at = names.u32(index * 8);
    let fileId = names.u16(index * 8 + 4);
    while (at < names.length) {
      const control = names.u8(at++);
      if (control === 0) break;
      const length = control & 0x7f;
      const name = names.ascii(at, length);
      at += length;
      if (control & 0x80) {
        const child = names.u16(at);
        at += 2;
        walk(child, `${prefix}${name}/`, depth + 1);
      } else {
        if (alloc.has(fileId * 8, 8)) {
          const start = alloc.u32(fileId * 8);
          files.push({
            path: `${prefix}${name}`,
            offset: start,
            size: alloc.u32(fileId * 8 + 4) - start,
          });
        }
        fileId++;
      }
    }
  };
  if (directories > 0) walk(0xf000, "", 0);
  return files;
}
