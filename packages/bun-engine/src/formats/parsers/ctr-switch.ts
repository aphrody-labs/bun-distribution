// Nintendo 3DS (NCSD/CCI, NCCH/CXI) and Nintendo Switch (NSP/PFS0, XCI/HFS0, NRO) containers.
// Headers and plaintext tables only: encrypted NCCH/NCA payloads need console keys, which are
// never handled here (see packages/re/plugin/skills/3ds-reverse and switch-reverse).
import { BinaryView, hex, hex32, type BinarySource } from "../stream";
import type { FileEntry, ParseContext, ParsedImage, Section } from "../types";

const mediaUnit = 0x200;

/** NCCH header at `base`: identifiers, crypto flags and the region table. */
export async function ncch(
  source: BinarySource,
  base: number,
): Promise<
  { header: Record<string, unknown>; sections: Section[] } | undefined
> {
  const view = await source.view(base, 0x200);
  if (!view.equals(0x100, "NCCH")) return undefined;
  const flags = view.slice(0x188, 8);
  const noCrypto = (flags[7] & 0x04) !== 0;
  const region = (
    name: string,
    at: number,
    kind: Section["kind"],
  ): Section | undefined => {
    const offset = view.u32(at) * mediaUnit;
    const size = view.u32(at + 4) * mediaUnit;
    return size
      ? {
          name,
          offset: base + offset,
          size,
          kind,
          arch: name === "exefs" ? "arm" : undefined,
        }
      : undefined;
  };
  const exheader = view.u32(0x180);
  const sections = [
    { name: "ncch-header", offset: base, size: 0x200, kind: "header" as const },
    exheader
      ? {
          name: "exheader",
          offset: base + 0x200,
          size: exheader + 0x400,
          kind: "metadata" as const,
        }
      : undefined,
    region("plain", 0x190, "metadata"),
    region("logo", 0x198, "data"),
    region("exefs", 0x1a0, "code"),
    region("romfs", 0x1b0, "filesystem"),
  ].filter((section): section is Section => !!section);
  return {
    header: {
      partitionId: view.big64(0x108).toString(16).padStart(16, "0"),
      makerCode: view.ascii(0x110, 2),
      version: view.u16(0x112),
      programId: view.big64(0x118).toString(16).padStart(16, "0"),
      productCode: view.ascii(0x150, 16),
      contentType: flags[5],
      encrypted: !noCrypto,
      exheaderBytes: exheader,
    },
    sections,
  };
}

export async function parseNcsd({
  source,
  head,
}: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head);
  const sections: Section[] = [
    { name: "ncsd-header", offset: 0, size: 0x200, kind: "header" },
  ];
  const partitions: Array<{ index: number; offset: number; size: number }> = [];
  for (let index = 0; index < 8; index++) {
    const offset = view.u32(0x120 + index * 8) * mediaUnit;
    const size = view.u32(0x124 + index * 8) * mediaUnit;
    if (!size) continue;
    partitions.push({ index, offset, size });
    sections.push({
      name: `partition[${index}] ${["game", "manual", "download-play", "", "", "", "n3ds-update", "o3ds-update"][index]}`,
      offset,
      size,
      kind: "partition",
    });
  }
  const game = partitions[0]
    ? await ncch(source, partitions[0].offset)
    : undefined;
  if (game)
    sections.push(
      ...game.sections.map((section) => ({
        ...section,
        name: `partition[0].${section.name}`,
      })),
    );
  return {
    header: {
      imageBytes: view.u32(0x104) * mediaUnit,
      mediaId: view.big64(0x108, "le").toString(16).padStart(16, "0"),
      partitions: partitions.length,
      game: game?.header,
    },
    sections,
    arch: "arm",
  };
}

export async function parseNcch({
  source,
}: ParseContext): Promise<ParsedImage> {
  const parsed = await ncch(source, 0);
  return {
    header: parsed?.header ?? {},
    sections: parsed?.sections ?? [],
    arch: "arm",
  };
}

/** ExeFS file table of an unencrypted NCCH (`.code`, `icon`, `banner`, `logo`). */
export async function exefsFiles(
  source: BinarySource,
  sections: Section[],
): Promise<FileEntry[]> {
  const exefs = sections.find((section) => section.name.endsWith("exefs"));
  if (!exefs) return [];
  const view = await source.view(exefs.offset, 0xa0);
  const files: FileEntry[] = [];
  for (let index = 0; index < 10; index++) {
    const name = view.ascii(index * 16, 8);
    const size = view.u32(index * 16 + 12);
    if (name && size)
      files.push({
        path: name,
        offset: exefs.offset + 0x200 + view.u32(index * 16 + 8),
        size,
      });
  }
  return files;
}

/** PFS0 (NSP) or HFS0 (XCI partitions) file table at `base`. */
export async function partitionFs(
  source: BinarySource,
  base: number,
): Promise<FileEntry[]> {
  const head = await source.view(base, 0x10);
  const hashed = head.equals(0, "HFS0");
  if (!hashed && !head.equals(0, "PFS0")) return [];
  const count = head.u32(4);
  const stringBytes = head.u32(8);
  const entryBytes = hashed ? 0x40 : 0x18;
  const table = await source.view(
    base + 0x10,
    count * entryBytes + stringBytes,
  );
  const data = base + 0x10 + count * entryBytes + stringBytes;
  const files: FileEntry[] = [];
  for (let index = 0; index < count; index++) {
    const at = index * entryBytes;
    files.push({
      path: table.ascii(count * entryBytes + table.u32(at + 16), 256),
      offset: data + table.u64(at),
      size: table.u64(at + 8),
    });
  }
  return files;
}

export async function parseNsp({ source }: ParseContext): Promise<ParsedImage> {
  const files = await partitionFs(source, 0);
  return {
    header: {
      container: "PFS0",
      files: files.length,
      contents: files.filter((file) => file.path.endsWith(".nca")).length,
      tickets: files
        .filter((file) => file.path.endsWith(".tik"))
        .map((file) => file.path),
      metaNca: files.find((file) => file.path.endsWith(".cnmt.nca"))?.path,
      encrypted: true,
    },
    sections: [
      {
        name: "pfs0-header",
        offset: 0,
        size: files[0]?.offset ?? 0x10,
        kind: "header",
      },
      ...files.map((file) => ({
        name: file.path,
        offset: file.offset,
        size: file.size,
        kind: "partition" as const,
      })),
    ],
    arch: "aarch64",
  };
}

const xciSizes: Record<number, string> = {
  0xfa: "1 GB",
  0xf8: "2 GB",
  0xf0: "4 GB",
  0xe0: "8 GB",
  0xe1: "16 GB",
  0xe2: "32 GB",
};

export async function parseXci({
  source,
  head,
}: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head);
  const root = view.u64(0x130);
  const partitions = await partitionFs(source, root);
  return {
    header: {
      cartridgeSize: xciSizes[view.u8(0x10d)] ?? hex(view.u8(0x10d), 2),
      headerVersion: view.u8(0x10e),
      flags: hex(view.u8(0x10f), 2),
      packageId: view.big64(0x110).toString(16).padStart(16, "0"),
      secureAreaStart: view.u32(0x104) * mediaUnit,
      validDataEnd: (view.u32(0x118) + 1) * mediaUnit,
      rootHfs0: { offset: root, headerBytes: view.u64(0x138) },
      partitions: partitions.map((partition) => partition.path),
      encrypted: true,
    },
    sections: [
      { name: "xci-header", offset: 0, size: 0x200, kind: "header" },
      {
        name: "root-hfs0",
        offset: root,
        size: view.u64(0x138),
        kind: "filesystem",
      },
      ...partitions.map((partition) => ({
        name: partition.path,
        offset: partition.offset,
        size: partition.size,
        kind: "partition" as const,
      })),
    ],
    arch: "aarch64",
  };
}

/** Homebrew NRO: segment table, module id and the optional ASET (icon, NACP, RomFS). */
export async function parseNro({
  source,
  head,
}: ParseContext): Promise<ParsedImage> {
  const view = new BinaryView(head);
  const segment = (
    name: string,
    at: number,
    kind: Section["kind"],
  ): Section => ({
    name,
    offset: view.u32(at),
    size: view.u32(at + 4),
    address: view.u32(at),
    arch: kind === "code" ? "aarch64" : undefined,
    kind,
  });
  const nroBytes = view.u32(0x18);
  const sections: Section[] = [
    { name: "nro-header", offset: 0, size: 0x80, kind: "header" },
    segment(".text", 0x20, "code"),
    segment(".rodata", 0x28, "data"),
    segment(".data", 0x30, "data"),
  ];
  let asset: Record<string, unknown> | undefined;
  const aset = await source.view(nroBytes, 0x38);
  if (aset.equals(0, "ASET")) {
    const part = (name: string, at: number): Section => ({
      name,
      offset: nroBytes + aset.u64(at),
      size: aset.u64(at + 8),
      kind: "metadata",
    });
    const parts = [
      part("icon", 0x08),
      part("nacp", 0x18),
      part("romfs", 0x28),
    ].filter((section) => section.size);
    sections.push(...parts);
    const nacp = parts.find((section) => section.name === "nacp");
    const control = nacp ? await source.view(nacp.offset, 0x3070) : undefined;
    asset = {
      version: aset.u32(4),
      title: control?.ascii(0, 0x200),
      publisher: control?.ascii(0x200, 0x100),
      displayVersion: control?.ascii(0x3060, 0x10),
    };
  }
  return {
    header: {
      version: view.u32(0x14),
      bytes: nroBytes,
      bssBytes: view.u32(0x38),
      moduleId: view.hex(0x40, 0x20),
      entry: hex32(0),
      asset,
    },
    sections,
    arch: "aarch64",
    entry: 0,
  };
}
