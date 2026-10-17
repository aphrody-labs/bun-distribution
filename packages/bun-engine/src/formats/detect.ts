// Content detection: magic bytes first, then structural heuristics, then the file extension,
// then Magika through `re`. Detection never trusts the extension over the bytes.
import { extname } from "node:path";
import { catalogFormats } from "./catalog.js";
import { crc16, BinaryView, type BinarySource } from "./stream.js";
import { armBiosFormat, hasArmVectors, looksLikeNdsFirmware } from "./parsers/firmware.js";
import { gbLogoPrefix, looksLikeNds } from "./parsers/handheld.js";
import { looksLikeDol, n64Order } from "./parsers/home.js";
import { cdSync } from "./parsers/playstation.js";
import { isInterleavedSmd } from "./parsers/sega.js";
import { magikaIdentify } from "./tools.js";
import type { Detection, FormatId } from "./types.js";

export const platforms: Record<FormatId, string> = {
  nes: "Nintendo Entertainment System",
  fds: "Famicom Disk System",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  nds: "Nintendo DS",
  n64: "Nintendo 64",
  dol: "GameCube / Wii",
  elf: "ELF executable",
  "gamecube-disc": "GameCube",
  "wii-disc": "Wii",
  wbfs: "Wii",
  wia: "GameCube / Wii",
  rvz: "GameCube / Wii",
  cue: "CD image (CUE sheet)",
  chd: "MAME CHD",
  "psx-exe": "PlayStation",
  "psx-disc": "PlayStation (raw CD)",
  iso9660: "ISO9660 disc",
  pbp: "PlayStation Portable",
  "3ds-ncsd": "Nintendo 3DS",
  "3ds-ncch": "Nintendo 3DS",
  nsp: "Nintendo Switch",
  xci: "Nintendo Switch",
  nro: "Nintendo Switch (homebrew)",
  "gba-bios": "Game Boy Advance BIOS",
  "nds-arm7-bios": "Nintendo DS ARM7 BIOS",
  "nds-arm9-bios": "Nintendo DS ARM9 BIOS",
  "nds-firmware": "Nintendo DS firmware",
  "psx-bios": "PlayStation BIOS",
  genesis: "Sega Mega Drive / Genesis",
  unknown: "unknown",
};

const byExtension: Record<string, FormatId> = {
  nes: "nes",
  fds: "fds",
  gb: "gb",
  gbc: "gbc",
  gba: "gba",
  agb: "gba",
  mb: "gba",
  nds: "nds",
  dsi: "nds",
  srl: "nds",
  n64: "n64",
  z64: "n64",
  v64: "n64",
  dol: "dol",
  elf: "elf",
  axf: "elf",
  gcm: "gamecube-disc",
  wbfs: "wbfs",
  rvz: "rvz",
  wia: "wia",
  cue: "cue",
  chd: "chd",
  pbp: "pbp",
  "3ds": "3ds-ncsd",
  cci: "3ds-ncsd",
  cxi: "3ds-ncch",
  nsp: "nsp",
  xci: "xci",
  nro: "nro",
  md: "genesis",
  gen: "genesis",
  smd: "genesis",
};

function magic(view: BinaryView, path: string): FormatId | undefined {
  if (view.equals(0, "\x7fELF")) return "elf";
  if (view.equals(0, "NES\x1a")) return "nes";
  if (view.equals(0, "FDS\x1a") || view.equals(1, "*NINTENDO-HVC*")) return "fds";
  if (view.length >= 4 && n64Order(view.u32(0, "be"))) return "n64";
  if (view.equals(0, "PS-X EXE")) return "psx-exe";
  if (view.equals(0, "MComprHD")) return "chd";
  if (view.equals(0, "\0PBP")) return "pbp";
  if (view.equals(0, "RVZ\x01")) return "rvz";
  if (view.equals(0, "WIA\x01")) return "wia";
  if (view.equals(0, "WBFS")) return "wbfs";
  if (view.equals(0, "PFS0")) return "nsp";
  if (view.equals(0x100, "HEAD")) return "xci";
  if (view.equals(0x10, "NRO0")) return "nro";
  if (view.equals(0x100, "NCSD")) return "3ds-ncsd";
  if (view.equals(0x100, "NCCH")) return "3ds-ncch";
  if (view.equals(0x100, "SEGA") || view.equals(0x101, "SEGA")) return "genesis";
  if (view.has(0, 0x20) && view.u32(0x1c, "be") === 0xc2339f3d) return "gamecube-disc";
  if (view.has(0, 0x20) && view.u32(0x18, "be") === 0x5d1c9ea3) return "wii-disc";
  if (view.has(0, 0x200) && crc16(view.slice(0xc0, 0x9c)) === 0xcf56 && view.u16(0x15c) === 0xcf56) return "nds";
  if (view.has(0, 0xc0) && view.u8(0xb2) === 0x96 && crc16(view.slice(0x04, 0x9c)) === 0xcf56) return "gba";
  if (view.equals(0x104, gbLogoPrefix)) return view.u8(0x143) & 0x80 ? "gbc" : "gb";
  if (cdSync.every((byte, index) => view.bytes[index] === byte)) return "psx-disc";
  if (view.equals(0x8001, "CD001")) return "iso9660";
  if (
    extname(path).toLowerCase() === ".cue" &&
    /\bTRACK\s+\d+/i.test(new TextDecoder("latin1").decode(view.slice(0, 4096)))
  )
    return "cue";
  return undefined;
}

/**
 * PlayStation reset vector at 0xBFC00000: `lui t0,hi; ori t0,t0,lo; lui at,0x1f80; sw t0,0x1010(at)`
 * (BIOS ROM delay/size register). Retail BIOS and the free OpenBIOS both start with it; OpenBIOS
 * carries no Sony copyright string.
 */
function looksLikePsxReset(view: BinaryView): boolean {
  return (
    view.u32(0) >>> 16 === 0x3c08 &&
    view.u32(4) >>> 16 === 0x3508 &&
    view.u32(8) === 0x3c011f80 &&
    view.u32(12) === 0xac281010
  );
}

async function heuristic(view: BinaryView, path: string, source: BinarySource): Promise<FormatId | undefined> {
  const size = source.size;
  if (looksLikeDol(view.with("be"), size)) return "dol";
  if (looksLikeNds(view, size)) return "nds";
  if (isInterleavedSmd(view.bytes, size)) return "genesis";
  if ((size === 0x4000 || size === 0x1000) && hasArmVectors(view)) return armBiosFormat(path, size);
  if (
    size === 0x80000 &&
    (looksLikePsxReset(view) ||
      /Sony Computer Entertainment/.test(new TextDecoder("latin1").decode(view.slice(0x100, 0x80))))
  )
    return "psx-bios";
  if ([0x20000, 0x40000, 0x80000].includes(size) && looksLikeNdsFirmware(await source.view(size - 0x200, 0x200)))
    return "nds-firmware";
  return undefined;
}

/** Identifies a console binary; `magika` forces the Magika bridge even after a byte match. */
export async function detect(
  source: BinarySource,
  path: string,
  options: { magika?: boolean | undefined } = {},
): Promise<Detection> {
  const view = new BinaryView(await source.read(0, 0x10000), "le");
  let format = magic(view, path);
  let by: Detection["by"] = "magic";
  let confidence = 1;
  if (!format) {
    format = await heuristic(view, path, source);
    by = "heuristic";
    confidence = 0.8;
  }
  if (!format) {
    format = byExtension[extname(path).slice(1).toLowerCase()];
    by = "extension";
    confidence = 0.3;
  }
  const catalog = await catalogFormats(view.bytes, path);
  const magika = options.magika || (!format && !catalog.length) ? await magikaIdentify(path) : undefined;
  let platform = format ? platforms[format] : "unknown";
  if (!format) {
    format = "unknown";
    by = catalog.length ? "catalog" : "magika";
    confidence = catalog.length ? 0.6 : 0;
    if (catalog.length) platform = catalog[0]!.consoles.join(", ");
  }
  return {
    format,
    platform,
    by,
    confidence,
    ...(catalog.length ? { catalog } : {}),
    ...(magika ? { magika } : {}),
  };
}
