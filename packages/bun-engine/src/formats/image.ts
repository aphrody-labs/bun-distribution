// The typed object every console binary loader yields: detection, parsed header, sections and
// lazy accessors (bytes, streams, digests, files, disassembly). Nothing beyond the header and the
// format tables is read until an accessor asks for it.
import { basename, resolve } from "node:path";
import { detect } from "./detect";
import {
  disassembleBytes,
  maxInstructionBytes,
  type Backend,
  type DisasmResult,
} from "./disasm";
import {
  parsePsxExe,
  parseCdImage,
  parseChd,
  parseCue,
  parsePbp,
  cdFiles,
} from "./parsers/playstation";
import {
  exefsFiles,
  parseNcch,
  parseNcsd,
  parseNro,
  parseNsp,
  parseXci,
  partitionFs,
} from "./parsers/ctr-switch";
import { parseElf } from "./parsers/elf";
import { biosParser } from "./parsers/firmware";
import {
  ndsFiles,
  parseFds,
  parseGameBoy,
  parseGba,
  parseNds,
  parseNes,
} from "./parsers/handheld";
import { parseGenesis } from "./parsers/sega";
import {
  gameCubeFiles,
  parseDisc,
  parseDol,
  parseN64,
  parseWbfs,
  parseWia,
  toZ64,
} from "./parsers/home";
import {
  BinarySource,
  digestSource,
  type Chunk,
  type StreamDigest,
} from "./stream";
import type {
  Arch,
  Detection,
  FileEntry,
  FormatId,
  FormatParser,
  ParsedImage,
  Section,
} from "./types";

const parsers: Record<FormatId, FormatParser | undefined> = {
  nes: parseNes,
  fds: parseFds,
  gb: parseGameBoy,
  gbc: parseGameBoy,
  gba: parseGba,
  nds: parseNds,
  n64: parseN64,
  dol: parseDol,
  elf: parseElf,
  "gamecube-disc": parseDisc,
  "wii-disc": parseDisc,
  wbfs: parseWbfs,
  wia: parseWia,
  rvz: parseWia,
  cue: parseCue,
  chd: parseChd,
  "psx-exe": parsePsxExe,
  "psx-disc": parseCdImage,
  iso9660: parseCdImage,
  pbp: parsePbp,
  "3ds-ncsd": parseNcsd,
  "3ds-ncch": parseNcch,
  nsp: parseNsp,
  xci: parseXci,
  nro: parseNro,
  "gba-bios": biosParser("gba-bios"),
  "nds-arm7-bios": biosParser("nds-arm7-bios"),
  "nds-arm9-bios": biosParser("nds-arm9-bios"),
  "nds-firmware": biosParser("nds-firmware"),
  "psx-bios": biosParser("psx-bios"),
  genesis: parseGenesis,
  unknown: undefined,
};

export interface OpenOptions {
  /** Ask Magika for a content type even when the bytes already matched. */
  magika?: boolean;
}

export interface ImageDisasmOptions {
  arch?: Arch;
  /** Guest address; defaults to the entry point. */
  at?: number;
  /** File offset, used instead of `at` for raw windows. */
  offset?: number;
  count?: number;
  backend?: Backend;
}

export interface ImageSummary<H extends object = Record<string, unknown>> {
  path: string;
  name: string;
  size: number;
  format: FormatId;
  platform: string;
  detection: Detection;
  arch?: Arch;
  entry?: number;
  header: H;
  sections: Section[];
  owners: string[];
}

export class BinaryImage<
  H extends object = Record<string, unknown>,
> implements ImageSummary<H> {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly format: FormatId;
  readonly platform: string;
  readonly detection: Detection;
  readonly arch?: Arch;
  readonly entry?: number;
  readonly header: H;
  readonly sections: Section[];
  readonly owners: string[];
  readonly source: BinarySource;
  private readonly head: Uint8Array;

  private constructor(
    source: BinarySource,
    path: string,
    detection: Detection,
    parsed: ParsedImage<H>,
    head: Uint8Array,
  ) {
    this.source = source;
    this.path = path;
    this.name = basename(path);
    this.size = source.size;
    this.format = detection.format;
    this.platform = detection.platform;
    this.detection = detection;
    this.arch = parsed.arch;
    this.entry = parsed.entry;
    this.header = parsed.header;
    this.sections = parsed.sections;
    this.owners = parsed.owners ?? [];
    this.head = head;
  }

  static async open<H extends object = Record<string, unknown>>(
    input: string,
    options: OpenOptions = {},
  ): Promise<BinaryImage<H>> {
    const path = resolve(input);
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`file not found: ${input}`);
    const source = new BinarySource(file, path);
    const detection = await detect(source, path, options);
    const head = await source.read(0, BinarySource.headBytes);
    const parser = parsers[detection.format];
    const parsed = parser
      ? await parser({ source, path, head })
      : { header: {}, sections: [] };
    return new BinaryImage<H>(
      source,
      path,
      detection,
      parsed as ParsedImage<H>,
      head,
    );
  }

  section(name: string): Section | undefined {
    return this.sections.find((section) => section.name === name);
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return this.source.read(offset, length);
  }

  bytes(): Promise<Uint8Array> {
    return this.source.read(0, this.size);
  }

  async sectionBytes(name: string): Promise<Uint8Array> {
    const section = this.section(name);
    if (!section) throw new Error(`${this.name} has no section ${name}`);
    const bytes = await this.source.read(section.offset, section.size);
    return section.swap
      ? toZ64(bytes, section.swap === "16" ? "v64" : "n64")
      : bytes;
  }

  stream(start = 0, end = this.size): AsyncGenerator<Chunk> {
    return this.source.chunks(start, end);
  }

  digest(start = 0, end = this.size): Promise<StreamDigest> {
    return digestSource(this.source, start, end);
  }

  /** Files of the embedded filesystem (NitroFS, GameCube FST, ISO9660 root, ExeFS, PFS0/HFS0). */
  async files(): Promise<FileEntry[]> {
    switch (this.format) {
      case "nds":
        return ndsFiles(this, this.sections);
      case "gamecube-disc":
        return gameCubeFiles(this.source, this.sections);
      case "psx-disc":
      case "iso9660":
        return cdFiles(this.source, this.head);
      case "3ds-ncsd":
      case "3ds-ncch":
        return exefsFiles(this.source, this.sections);
      case "nsp":
        return partitionFs(this.source, 0);
      case "xci": {
        const nested = await Promise.all(
          this.sections
            .filter((section) => section.kind === "partition")
            .map(async (section) =>
              (await partitionFs(this.source, section.offset)).map((file) => ({
                ...file,
                path: `${section.name}/${file.path}`,
              })),
            ),
        );
        return nested.flat();
      }
      default:
        return [];
    }
  }

  /** Maps a guest address to the code section that contains it. */
  locate(
    address: number,
    arch?: Arch,
  ): { section: Section; offset: number } | undefined {
    const candidates = this.sections.filter(
      (section) =>
        section.address !== undefined &&
        section.kind === "code" &&
        address >= section.address &&
        address < section.address + section.size,
    );
    const section =
      candidates.find((candidate) => !arch || candidate.arch === arch) ??
      candidates[0];
    return section
      ? { section, offset: section.offset + (address - section.address!) }
      : undefined;
  }

  async disasm(
    options: ImageDisasmOptions = {},
  ): Promise<DisasmResult & { offset: number; section?: string }> {
    const count = Math.max(1, Math.min(options.count ?? 16, 4096));
    let offset: number;
    let address: number;
    let section: Section | undefined;
    if (options.offset !== undefined) {
      offset = options.offset;
      section = this.sections.find(
        (candidate) =>
          candidate.kind === "code" &&
          offset >= candidate.offset &&
          offset < candidate.offset + candidate.size &&
          candidate.address !== undefined,
      );
      address =
        options.at ??
        (section ? section.address! + (offset - section.offset) : offset);
    } else {
      address =
        options.at ??
        this.entry ??
        this.sections.find(
          (candidate) =>
            candidate.kind === "code" && candidate.address !== undefined,
        )?.address ??
        0;
      const located = this.locate(address, options.arch);
      if (!located)
        throw new Error(
          `${this.name}: address 0x${address.toString(16)} is not inside a mapped code section; use --offset`,
        );
      ({ offset, section } = located);
    }
    const arch = options.arch ?? section?.arch ?? this.arch;
    if (!arch)
      throw new Error(
        `${this.name}: no instruction set known for ${this.format}; pass --arch`,
      );
    let length = count * maxInstructionBytes(arch);
    if (section)
      length = Math.min(length, section.offset + section.size - offset);
    let bytes = await this.source.read(offset, length);
    if (section?.swap)
      bytes = toZ64(bytes, section.swap === "16" ? "v64" : "n64");
    const result = await disassembleBytes(bytes, {
      arch,
      address,
      count,
      backend: options.backend,
    });
    return { ...result, offset, section: section?.name };
  }

  toJSON(): ImageSummary<H> {
    const {
      path,
      name,
      size,
      format,
      platform,
      detection,
      arch,
      entry,
      header,
      sections,
      owners,
    } = this;
    return {
      path,
      name,
      size,
      format,
      platform,
      detection,
      arch,
      entry,
      header,
      sections,
      owners,
    };
  }
}

export function openBinary<H extends object = Record<string, unknown>>(
  path: string,
  options?: OpenOptions,
): Promise<BinaryImage<H>> {
  return BinaryImage.open<H>(path, options);
}
