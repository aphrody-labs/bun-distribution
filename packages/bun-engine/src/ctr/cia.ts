// CIA (CTR Importable Archive) inspection and management.
//
// Reading the header, ticket and TMD is done here in TypeScript and needs no keys. Verification,
// decryption and installation run `azahar-cia`, the headless tool built from our Azahar fork
// (vendor/azahar, src/citra_cia), which reuses the emulator's own CIA/NCCH/AES code. Keys are
// never bundled: the owner supplies them under the isolated Azahar user directory.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { usrRoot } from "../usr";

const ALIGN = 0x40;
const HEADER_SIZE = 0x2020;
const align = (value: number) => Math.ceil(value / ALIGN) * ALIGN;

/** Azahar user directory used for every CIA operation; git-ignored (usr/ is never committed). */
export function ciaUserDir(): string {
  return Bun.env.AZAHAR_USER_DIR ?? join(usrRoot(), "etc", "3ds", "azahar-user");
}

export const keyFiles = {
  keys: "keys.txt",
  seeds: "seeddb.bin",
} as const;

/** The `azahar-cia` binary, or undefined when it has not been built or installed. */
export function findCiaTool(): string | undefined {
  const exe = process.platform === "win32" ? "azahar-cia.exe" : "azahar-cia";
  const candidates = [
    Bun.env.AZAHAR_CIA,
    join(usrRoot(), "lib", "azahar-cia", exe),
    join(usrRoot(), "bin", exe),
    Bun.which("azahar-cia") ?? undefined,
  ];
  return candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
}

export interface CiaContent {
  index: number;
  id: number;
  typeFlags: number;
  size: number;
  present: boolean;
  /** AES-CBC layer from the TMD flag. */
  encrypted: boolean;
  optional: boolean;
  shared: boolean;
  /** NCCH layer: true/false when the content is readable, undefined while the CBC layer hides it. */
  ncchEncrypted?: boolean;
  ncchFixedKey?: boolean;
  ncchSecondarySlot?: number;
  ncchSeed?: boolean;
  programId?: string;
}

export interface KeyEntry {
  file: string;
  entry: string;
  neededFor: string;
}

export interface CiaInfo {
  file: string;
  fileSize: number;
  titleId: string;
  category: string;
  version: number;
  versionString: string;
  contentCount: number;
  presentCount: number;
  /** Content layer (TMD) encryption flag on a present content. */
  encrypted: boolean;
  /** NCCH layer encryption: undefined when it cannot be known without the title key. */
  ncchEncrypted?: boolean;
  tmdSignatureType: number;
  ticket: { titleId: string; commonKeyIndex: number; personal: boolean };
  metaSize: number;
  contents: CiaContent[];
  requiredKeys: KeyEntry[];
}

const signatureBodyOffset: Record<number, number> = {
  0x10000: 0x240,
  0x10003: 0x240,
  0x10001: 0x140,
  0x10004: 0x140,
  0x10002: 0x80,
  0x10005: 0x80,
};

const hex = (value: bigint, width = 16) => value.toString(16).padStart(width, "0");

function category(titleId: bigint): string {
  const high = Number(titleId >> 32n);
  const names: Record<number, string> = {
    0x00040000: "application",
    0x00040001: "download-play-child",
    0x00040002: "demo",
    0x0004000e: "update",
    0x00040010: "system-application",
    0x0004001b: "system-data",
    0x00040030: "system-applet",
    0x0004008c: "dlc",
    0x0004009b: "shared-data",
    0x000400db: "system-data-archive",
    0x00040130: "system-module",
    0x00040138: "firmware",
    0x00048004: "dsiware",
    0x00048005: "dsi-system-app",
    0x0004800f: "dsi-system",
  };
  return names[high] ?? `0x${high.toString(16).padStart(8, "0")}`;
}

async function readRange(file: string, start: number, end: number): Promise<DataView> {
  return new DataView(await Bun.file(file).slice(start, end).arrayBuffer());
}

/** Reads the CIA header, ticket, TMD and, where the content layer is plain, each NCCH header. */
export async function readCiaInfo(file: string): Promise<CiaInfo> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) throw new Error(`file not found: ${file}`);
  const fileSize = handle.size;
  if (fileSize < HEADER_SIZE) throw new Error("not a CIA: file is smaller than the header");
  const header = await readRange(file, 0, HEADER_SIZE);
  const headerSize = header.getUint32(0, true);
  const certSize = header.getUint32(8, true);
  const tikSize = header.getUint32(12, true);
  const tmdSize = header.getUint32(16, true);
  const metaSize = header.getUint32(20, true);
  const contentSize = Number(header.getBigUint64(24, true));
  if (headerSize !== 0x2020 || tmdSize < 0x9c4 + 4 || tikSize < 0x164 || tmdSize > 0x100000)
    throw new Error("not a CIA: header sizes are invalid");
  const certOffset = align(headerSize);
  const tikOffset = align(certOffset + certSize);
  const tmdOffset = align(tikOffset + tikSize);
  const contentOffset = align(tmdOffset + tmdSize);
  if (contentOffset + contentSize > fileSize)
    throw new Error("not a CIA: content area exceeds the file");

  const tik = await readRange(file, tikOffset, tikOffset + tikSize);
  const tikBody = signatureBodyOffset[tik.getUint32(0)];
  if (tikBody === undefined) throw new Error("unsupported ticket signature type");
  const tmd = await readRange(file, tmdOffset, tmdOffset + tmdSize);
  const tmdType = tmd.getUint32(0);
  const body = signatureBodyOffset[tmdType];
  if (body === undefined) throw new Error("unsupported TMD signature type");

  const titleId = tmd.getBigUint64(body + 0x4c);
  const version = tmd.getUint16(body + 0x9c);
  const count = tmd.getUint16(body + 0x9e);
  const chunks = body + 0x9c4;
  if (chunks + count * 0x30 > tmdSize) throw new Error("TMD content table exceeds the TMD");
  const presence = new Uint8Array(await handle.slice(0x20, 0x2020).arrayBuffer());

  const contents: CiaContent[] = [];
  let offset = contentOffset;
  for (let index = 0; index < count; index++) {
    const at = chunks + index * 0x30;
    const typeFlags = tmd.getUint16(at + 6);
    const size = Number(tmd.getBigUint64(at + 8));
    const present = ((presence[index >> 3] ?? 0) & (0x80 >> (index & 7))) !== 0;
    const content: CiaContent = {
      index,
      id: tmd.getUint32(at),
      typeFlags,
      size,
      present,
      encrypted: (typeFlags & 1) !== 0,
      optional: (typeFlags & 0x4000) !== 0,
      shared: (typeFlags & 0x8000) !== 0,
    };
    if (present) {
      if (!content.encrypted && size >= 0x200) {
        const head = new Uint8Array(await handle.slice(offset, offset + 0x200).arrayBuffer());
        if (new TextDecoder().decode(head.subarray(0x100, 0x104)) === "NCCH") {
          const flags7 = head[0x18f]!;
          content.ncchFixedKey = (flags7 & 1) !== 0;
          content.ncchEncrypted = (flags7 & 4) === 0;
          content.ncchSeed = (flags7 & 0x20) !== 0;
          content.ncchSecondarySlot = head[0x18b];
          content.programId = hex(new DataView(head.buffer).getBigUint64(0x118, true));
        } else content.ncchEncrypted = false;
      }
      offset += size;
    }
    contents.push(content);
  }

  const present = contents.filter(content => content.present);
  const ncchKnown = present.every(content => content.ncchEncrypted !== undefined);
  const info: CiaInfo = {
    file,
    fileSize,
    titleId: hex(titleId),
    category: category(titleId),
    version,
    versionString: `${version >> 10}.${(version >> 4) & 0x3f}.${version & 0xf}`,
    contentCount: count,
    presentCount: present.length,
    encrypted: present.some(content => content.encrypted),
    ncchEncrypted: ncchKnown ? present.some(content => content.ncchEncrypted) : undefined,
    tmdSignatureType: tmdType,
    ticket: {
      titleId: hex(tik.getBigUint64(tikBody + 0x9c)),
      commonKeyIndex: tik.getUint8(tikBody + 0xb1),
      personal: tik.getUint32(tikBody + 0x98) !== 0,
    },
    metaSize,
    contents,
    requiredKeys: [],
  };
  info.requiredKeys = requiredKeys(info);
  return info;
}

const slotEntry = (slot: number) => `slot0x${slot.toString(16).toUpperCase()}KeyX`;

/** Key entries needed to decrypt this CIA; the NCCH part is only known once the CBC layer is plain. */
export function requiredKeys(info: CiaInfo): KeyEntry[] {
  const keys = `sysdata/${keyFiles.keys}`;
  const out = new Map<string, KeyEntry>();
  const add = (file: string, entry: string, neededFor: string) => {
    if (!out.has(`${file}|${entry}`)) out.set(`${file}|${entry}`, { file, entry, neededFor });
  };
  if (info.encrypted) {
    const why = "ticket title key (content layer)";
    add(keys, slotEntry(0x3d), why);
    add(keys, `common${info.ticket.commonKeyIndex}`, why);
    add(keys, "generatorConstant", why);
  }
  for (const content of info.contents) {
    if (!content.present || !content.ncchEncrypted || content.ncchFixedKey) continue;
    const why = `NCCH decryption of content ${content.index}`;
    add(keys, slotEntry(0x2c), why);
    const secondary: Record<number, number> = { 1: 0x25, 10: 0x18, 11: 0x1b };
    const slot = secondary[content.ncchSecondarySlot ?? 0];
    if (slot) add(keys, slotEntry(slot), why);
    add(keys, "generatorConstant", why);
    if (content.ncchSeed)
      add(`sysdata/${keyFiles.seeds}`, `seed for program ${content.programId}`, why);
  }
  return [...out.values()];
}

/** Names defined in the :AES section of sysdata/keys.txt. Values are never read. */
export function installedKeyNames(userDir = ciaUserDir()): Set<string> {
  const file = join(userDir, "sysdata", keyFiles.keys);
  const names = new Set<string>();
  if (!existsSync(file)) return names;
  let mode = "";
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith(":")) mode = line.slice(1);
    else if (mode === "AES" && line.includes("=")) names.add(line.slice(0, line.indexOf("=")));
  }
  return names;
}

/** The entries from `required` that the user directory does not provide. */
export function missingKeys(required: KeyEntry[], userDir = ciaUserDir()): KeyEntry[] {
  const names = installedKeyNames(userDir);
  return required.filter(key =>
    key.file.endsWith(keyFiles.seeds)
      ? !existsSync(join(userDir, "sysdata", keyFiles.seeds))
      : !names.has(key.entry),
  );
}

export function ciaStatus() {
  const userDir = ciaUserDir();
  return {
    userDir,
    sysdata: join(userDir, "sysdata"),
    tool: findCiaTool() ?? null,
    files: {
      [keyFiles.keys]: existsSync(join(userDir, "sysdata", keyFiles.keys)),
      [keyFiles.seeds]: existsSync(join(userDir, "sysdata", keyFiles.seeds)),
    },
    keyEntries: installedKeyNames(userDir).size,
  };
}

export interface ToolResult {
  exitCode: number;
  json: Record<string, unknown> | undefined;
  stderr: string;
}

/** Runs `azahar-cia` with the isolated user directory. */
export async function runCiaTool(args: string[]): Promise<ToolResult> {
  const tool = findCiaTool();
  if (!tool)
    throw new Error(
      "azahar-cia is not built. Build vendor/azahar with -DENABLE_QT=OFF -DENABLE_CIA_TOOL=ON (see docs/bun-engine/CIA.md) and set AZAHAR_CIA or install it under usr/lib/azahar-cia.",
    );
  const userDir = ciaUserDir();
  mkdirSync(join(userDir, "sysdata"), { recursive: true });
  const child = Bun.spawn([tool, "--user-dir", userDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const line = stdout.trim().split("\n").pop() ?? "";
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(line) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { exitCode, json, stderr };
}

function missingReport(missing: KeyEntry[], userDir: string): Record<string, unknown> {
  return {
    ok: false,
    error: "missing-keys",
    message: `required key material is absent; place it under ${join(userDir, "sysdata")}`,
    missing: missing.map(key => ({ file: key.file, entry: key.entry, needed_for: key.neededFor })),
  };
}

/** `status`, `info`, `verify`, `decrypt` and `install`; returns the process exit code. */
export async function ciaMain(argv: string[]): Promise<number> {
  const [action, file, out] = argv;
  const usage =
    "usage: bun-engine 3ds cia status | info <cia> | verify <cia> | decrypt <cia> <out.cia> | install <cia>";
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (action === "status") {
    print(ciaStatus());
    return 0;
  }
  if (!file || !["info", "verify", "decrypt", "install"].includes(action ?? "") || (action === "decrypt" && !out)) {
    console.error(usage);
    return 2;
  }
  const info = await readCiaInfo(file);
  if (action === "info") {
    print({ ...info, missingKeys: missingKeys(info.requiredKeys) });
    return 0;
  }
  const userDir = ciaUserDir();
  // A plain CIA needs no key; an encrypted one is refused here with the exact entries that are absent.
  const missing = missingKeys(info.requiredKeys, userDir);
  if (missing.length > 0) {
    print(missingReport(missing, userDir));
    return 3;
  }
  const result = await runCiaTool(action === "decrypt" ? [action, file, out!] : [action, file]);
  print(result.json ?? { ok: false, error: "tool-failed", stderr: result.stderr.trim().slice(-2000) });
  return result.exitCode;
}
