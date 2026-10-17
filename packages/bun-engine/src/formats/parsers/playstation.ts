// PlayStation family: PS-X EXE, raw CD images (2352-byte sectors) and ISO9660 images with
// SYSTEM.CNF boot resolution, CUE sheets, MAME CHD containers and PSP/PS1-classic PBP files.
// CHD hunks stay with MAME's `chdman` (usr/lib/mame, installed by bep) for extraction.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BinarySource, BinaryView, hex32 } from "../stream.js";
import type { FileEntry, ParseContext, ParsedImage, Section } from "../types.js";

export const cdSync = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

/** PS-X EXE header fields (0x800-byte header, text loaded at t_addr). */
export function psxExeHeader(view: BinaryView, at = 0) {
  return {
    pc0: hex32(view.u32(at + 0x10)),
    gp0: hex32(view.u32(at + 0x14)),
    textAddress: hex32(view.u32(at + 0x18)),
    textBytes: view.u32(at + 0x1c),
    stackBase: hex32(view.u32(at + 0x30)),
    stackBytes: view.u32(at + 0x34),
    region: view.ascii(at + 0x4c, 0x7b4),
  };
}

export async function parsePsxExe({ head, source }: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head);
  const textAddress = view.u32(0x18);
  return {
    header: psxExeHeader(view),
    sections: [
      { name: "header", offset: 0, size: 0x800, kind: "header" },
      {
        name: "text",
        offset: 0x800,
        size: Math.min(view.u32(0x1c), source.size - 0x800),
        address: textAddress,
        arch: "r3000",
        kind: "code",
      },
    ],
    arch: "r3000",
    entry: view.u32(0x10),
  };
}

/** Logical 2048-byte sector reader over a cooked ISO or a raw 2352-byte image (mode 1 or 2). */
export class CdReader {
  readonly source: BinarySource;
  readonly raw: boolean;

  constructor(source: BinarySource, raw: boolean) {
    this.source = source;
    this.raw = raw;
  }

  async sector(lba: number): Promise<Uint8Array> {
    if (!this.raw) return this.source.read(lba * 2048, 2048);
    const sector = await this.source.read(lba * 2352, 2352);
    const mode = sector[15];
    return sector.subarray(mode === 2 ? 24 : 16, (mode === 2 ? 24 : 16) + 2048);
  }

  async read(lba: number, bytes: number): Promise<Uint8Array> {
    const count = Math.ceil(bytes / 2048);
    const out = new Uint8Array(count * 2048);
    for (let index = 0; index < count; index++) out.set(await this.sector(lba + index), index * 2048);
    return out.subarray(0, bytes);
  }

  /** Root directory entries (one level) of the ISO9660 volume. */
  async root(): Promise<
    | {
        volume: Record<string, unknown>;
        entries: Array<FileEntry & { lba: number; directory: boolean }>;
      }
    | undefined
  > {
    const pvd = new BinaryView(await this.sector(16));
    if (pvd.u8(0) !== 1 || !pvd.equals(1, "CD001")) return undefined;
    const lba = pvd.u32(156 + 2);
    const bytes = pvd.u32(156 + 10);
    const directory = new BinaryView(await this.read(lba, Math.min(bytes, 0x10000)));
    const entries: Array<FileEntry & { lba: number; directory: boolean }> = [];
    for (let at = 0; at < directory.length;) {
      const length = directory.u8(at);
      if (length === 0) {
        at = (Math.floor(at / 2048) + 1) * 2048;
        continue;
      }
      const nameBytes = directory.u8(at + 32);
      const name = directory.ascii(at + 33, nameBytes);
      if (nameBytes > 1 || (name !== "" && name !== "\u0001")) {
        const extent = directory.u32(at + 2);
        entries.push({
          path: name.replace(/;1$/, ""),
          lba: extent,
          offset: this.raw ? extent * 2352 : extent * 2048,
          size: directory.u32(at + 10),
          directory: (directory.u8(at + 25) & 2) !== 0,
        });
      }
      at += length;
    }
    return {
      volume: {
        systemId: pvd.ascii(8, 32),
        volumeId: pvd.ascii(40, 32),
        volumeSectors: pvd.u32(80),
        publisher: pvd.ascii(318, 128),
        application: pvd.ascii(574, 128),
        created: pvd.ascii(813, 16),
      },
      entries,
    };
  }
}

/** ISO9660 disc (cooked or raw) with PlayStation SYSTEM.CNF boot resolution. */
export async function parseCdImage({ source, head }: ParseContext): Promise<ParsedImage> {
  const raw = cdSync.every((byte, index) => head[index] === byte);
  const reader = new CdReader(source, raw);
  const root = await reader.root();
  const sections: Section[] = [
    {
      name: "system-area",
      offset: 0,
      size: (raw ? 2352 : 2048) * 16,
      kind: "header",
    },
    {
      name: "pvd",
      offset: (raw ? 2352 : 2048) * 16,
      size: raw ? 2352 : 2048,
      kind: "header",
    },
  ];
  const header: Record<string, unknown> = {
    sectorBytes: raw ? 2352 : 2048,
    mode: raw ? head[15] : undefined,
    volume: root?.volume,
  };
  let entry: number | undefined;
  const cnf = root?.entries.find(file => file.path.toUpperCase() === "SYSTEM.CNF");
  if (cnf && root) {
    const text = new TextDecoder("latin1").decode(await reader.read(cnf.lba, Math.min(cnf.size, 2048)));
    const boot = /^\s*(BOOT2?)\s*=\s*cdrom0?:\\?([^;\r\n]+)/im.exec(text);
    header.systemCnf = Object.fromEntries(
      text.split(/\r?\n/).flatMap(line => {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/i.exec(line);
        return match ? [[match[1], match[2]]] : [];
      }),
    );
    if (boot) {
      const ps2 = boot[1]!.toUpperCase() === "BOOT2";
      const bootName = boot[2]!.replace(/^\\/, "").toUpperCase();
      header.platform = ps2 ? "PlayStation 2" : "PlayStation";
      header.boot = bootName;
      header.serial = bootName.replace(/[._]/g, "-").replace(/-(\d{3})-(\d{2})$/, "-$1$2");
      const exe = root.entries.find(file => file.path.toUpperCase() === bootName);
      if (exe && !ps2) {
        const exeHeader = new BinaryView(await reader.read(exe.lba, 0x800));
        if (exeHeader.equals(0, "PS-X EXE")) {
          header.exe = psxExeHeader(exeHeader);
          entry = exeHeader.u32(0x10);
          if (!raw)
            sections.push({
              name: bootName,
              offset: exe.offset + 0x800,
              size: exeHeader.u32(0x1c),
              address: exeHeader.u32(0x18),
              arch: "r3000",
              kind: "code",
            });
        }
      }
    }
  }
  return {
    header,
    sections,
    arch: header.platform === "PlayStation" ? "r3000" : undefined,
    entry,
  };
}

export async function cdFiles(source: BinarySource, head: Uint8Array): Promise<FileEntry[]> {
  const raw = cdSync.every((byte, index) => head[index] === byte);
  return (
    (await new CdReader(source, raw).root())?.entries.map(({ path, offset, size }) => ({ path, offset, size })) ?? []
  );
}

const sectorBytes: Record<string, number> = {
  AUDIO: 2352,
  "MODE1/2048": 2048,
  "MODE1/2352": 2352,
  "MODE2/2336": 2336,
  "MODE2/2352": 2352,
  CDG: 2448,
};

/** CUE sheet: referenced files, tracks and INDEX 01 positions; the first data track is inspected. */
export async function parseCue({ source, path }: ParseContext): Promise<ParsedImage> {
  const text = await source.blob.text();
  const base = dirname(path);
  const files: Array<{
    name: string;
    type: string;
    exists: boolean;
    bytes?: number | undefined;
  }> = [];
  const tracks: Array<{
    number: number;
    type: string;
    file: string;
    index01?: string | undefined;
    sector?: number | undefined;
  }> = [];
  for (const line of text.split(/\r?\n/)) {
    const file = /^\s*FILE\s+"?(.+?)"?\s+(\w+)\s*$/i.exec(line);
    const track = /^\s*TRACK\s+(\d+)\s+(\S+)/i.exec(line);
    const index = /^\s*INDEX\s+01\s+(\d+):(\d+):(\d+)/i.exec(line);
    if (file) {
      const full = resolve(base, file[1]!);
      const exists = existsSync(full);
      files.push({
        name: file[1]!,
        type: file[2]!,
        exists,
        bytes: exists ? Bun.file(full).size : undefined,
      });
    } else if (track)
      tracks.push({
        number: Number(track[1]!),
        type: track[2]!.toUpperCase(),
        file: files.at(-1)?.name ?? "",
      });
    else if (index && tracks.length) {
      const last = tracks.at(-1)!;
      last.index01 = `${index[1]}:${index[2]}:${index[3]}`;
      last.sector = (Number(index[1]) * 60 + Number(index[2])) * 75 + Number(index[3]);
    }
  }
  const sections: Section[] = tracks.map(track => ({
    name: `track ${String(track.number).padStart(2, "0")} ${track.type} (${track.file})`,
    offset: (track.sector ?? 0) * (sectorBytes[track.type] ?? 2352),
    size: 0,
    kind: "track",
  }));
  const data = tracks.find(track => track.type !== "AUDIO");
  let disc: ParsedImage | undefined;
  if (data && files.find(file => file.name === data.file)?.exists) {
    const dataSource = BinarySource.open(resolve(base, data.file));
    disc = await parseCdImage({
      source: dataSource,
      path: dataSource.path!,
      head: await dataSource.read(0, 0x10000),
    });
  }
  return {
    header: { files, tracks, disc: disc?.header },
    sections,
    arch: disc?.arch,
    entry: disc?.entry,
  };
}

const fourcc = (value: number) =>
  value ? String.fromCharCode(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff) : "none";

/** MAME CHD (v3-v5) header plus CD/GD track metadata. */
export async function parseChd({ source, head }: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head, "be");
  const version = view.u32(0x0c);
  const headerBytes = view.u32(0x08);
  let header: Record<string, unknown>;
  let metaOffset: number;
  if (version >= 5) {
    metaOffset = view.u64(0x30);
    header = {
      compressors: [0, 1, 2, 3].map(index => fourcc(view.u32(0x10 + index * 4))),
      logicalBytes: view.u64(0x20),
      hunkBytes: view.u32(0x38),
      unitBytes: view.u32(0x3c),
      rawSha1: view.hex(0x40, 20),
      sha1: view.hex(0x54, 20),
      parentSha1: view.hex(0x68, 20),
    };
  } else {
    metaOffset = view.u64(0x24);
    header = {
      flags: view.u32(0x10),
      compression: view.u32(0x14),
      hunks: view.u32(0x18),
      logicalBytes: view.u64(0x1c),
      hunkBytes: version === 4 ? view.u32(0x2c) : view.u32(0x4c),
      sha1: version === 4 ? view.hex(0x30, 20) : view.hex(0x50, 20),
    };
  }
  const sections: Section[] = [{ name: "chd-header", offset: 0, size: headerBytes, kind: "header" }];
  const tracks: string[] = [];
  for (let at = metaOffset, guard = 0; at && at < source.size && guard < 256; guard++) {
    const entry = await source.view(at, 16, "be");
    if (entry.length < 16) break;
    const tag = fourcc(entry.u32(0));
    const length = entry.u32(4) & 0xffffff;
    sections.push({
      name: `metadata ${tag}`,
      offset: at,
      size: 16 + length,
      kind: "metadata",
    });
    if (/^CH(T2|TR|GD)$/.test(tag))
      tracks.push(new TextDecoder("latin1").decode(await source.read(at + 16, length)).replace(/\0+$/, ""));
    at = entry.u64(8);
  }
  return {
    header: {
      version,
      ...header,
      tracks,
      extractor: "chdman extractcd (MAME, usr/lib/mame)",
    },
    sections,
  };
}

/** PBP container (PSP EBOOT / PS1 classics) with PARAM.SFO decoding. */
export async function parsePbp({ source, head }: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head);
  const names = ["PARAM.SFO", "ICON0.PNG", "ICON1.PMF", "PIC0.PNG", "PIC1.PNG", "SND0.AT3", "DATA.PSP", "DATA.PSAR"];
  const offsets = names.map((_, index) => view.u32(8 + index * 4));
  const sections: Section[] = names.map((name, index) => ({
    name,
    offset: offsets[index]!,
    size: (offsets[index + 1] ?? source.size) - offsets[index]!,
    kind: name.startsWith("DATA") ? "data" : "metadata",
  }));
  const sfoSection = sections[0]!;
  const sfo = await source.view(sfoSection.offset, sfoSection.size);
  const param: Record<string, string | number> = {};
  if (sfo.equals(0, "\0PSF")) {
    const keys = sfo.u32(8);
    const values = sfo.u32(12);
    for (let index = 0; index < sfo.u32(16); index++) {
      const at = 20 + index * 16;
      const key = sfo.ascii(keys + sfo.u16(at), 64);
      const format = sfo.u16(at + 2);
      const value = values + sfo.u32(at + 12);
      param[key] = format === 0x0404 ? sfo.u32(value) : sfo.ascii(value, sfo.u32(at + 4));
    }
  }
  return {
    header: { version: hex32(view.u32(4)), param },
    sections: sections.filter(section => section.size > 0),
  };
}
