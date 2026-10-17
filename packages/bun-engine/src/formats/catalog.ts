// Bridges detection to the console research catalogs in plugins/consoles: `formats.json`
// (magic bytes, owners and specs of 79 formats) and `firmware.json` (publicly documented
// BIOS/firmware hashes and free replacements). Both are optional at runtime.
import { extname, join } from "node:path";
import type { StreamDigest } from "./stream";
import { workspaceRoot } from "./tools";

interface CatalogMagic {
  offset: string;
  hex?: string;
}

interface CatalogFormat {
  id: string;
  consoles: string[];
  extensions: string[];
  kind: string;
  magic?: CatalogMagic[];
  parsers?: Array<{ path: string; scope: string }>;
  status?: string;
  spec?: string[];
}

interface CatalogFirmware {
  file: string;
  size?: number;
  crc32?: string;
  sha1?: string;
  md5?: string;
  region?: string;
  role?: string;
  need?: string;
}

interface CatalogConsole {
  id: string;
  name: string;
  firmware?: CatalogFirmware[];
  freeReplacements?: Array<{
    id: string;
    name: string;
    license?: string;
    replaces?: string[];
    vendored?: { state?: string; path?: string };
  }>;
}

export interface CatalogMatch {
  id: string;
  kind: string;
  consoles: string[];
  status?: string;
  owners: string[];
  spec: string[];
}

export interface FirmwareMatch {
  console: string;
  file: string;
  region?: string;
  role?: string;
  need?: string;
  license?: string;
  free?: boolean;
}

const cache = new Map<string, Promise<unknown>>();

function catalog<T>(name: string): Promise<T | undefined> {
  if (!cache.has(name)) {
    const root = workspaceRoot();
    const path = root
      ? join(root, "packages", "bun-engine", "plugins", "consoles", name)
      : undefined;
    cache.set(
      name,
      path
        ? Bun.file(path)
            .json()
            .catch(() => undefined)
        : Promise.resolve(undefined),
    );
  }
  return cache.get(name) as Promise<T | undefined>;
}

function patternMatches(
  head: Uint8Array,
  magic: CatalogMagic,
): boolean | undefined {
  if (
    !magic.hex ||
    !/^0x[0-9a-f]+$/i.test(magic.offset) ||
    !/^[0-9a-f]{2}( [0-9a-f]{2})*$/i.test(magic.hex)
  )
    return undefined;
  const offset = Number.parseInt(magic.offset, 16);
  const bytes = magic.hex.split(" ").map((byte) => Number.parseInt(byte, 16));
  return (
    offset + bytes.length <= head.byteLength &&
    bytes.every((byte, index) => head[offset + index] === byte)
  );
}

/** formats.json entries whose magic matches the head (a 3+ byte signature, or every pattern). */
export async function catalogFormats(
  head: Uint8Array,
  path: string,
): Promise<CatalogMatch[]> {
  const formats =
    (await catalog<{ formats: CatalogFormat[] }>("formats.json"))?.formats ??
    [];
  const extension = extname(path).toLowerCase();
  const matches = formats.filter((format) => {
    const results = (format.magic ?? [])
      .map((magic) => ({ magic, hit: patternMatches(head, magic) }))
      .filter((result) => result.hit !== undefined);
    if (!results.length) return false;
    return (
      results.some(
        (result) =>
          result.hit && (result.magic.hex?.split(" ").length ?? 0) >= 3,
      ) || results.every((result) => result.hit)
    );
  });
  matches.sort(
    (a, b) =>
      Number(b.extensions.includes(extension)) -
      Number(a.extensions.includes(extension)),
  );
  return matches.map((format) => ({
    id: format.id,
    kind: format.kind,
    consoles: format.consoles,
    status: format.status,
    owners: (format.parsers ?? []).map(
      (parser) => `${parser.path} (${parser.scope})`,
    ),
    spec: format.spec ?? [],
  }));
}

/** firmware.json dumps (documented CRC-32/MD5/SHA-1) and vendored free replacements (SHA-1). */
export async function catalogFirmware(
  digest: StreamDigest,
): Promise<FirmwareMatch[]> {
  const consoles =
    (await catalog<{ consoles: CatalogConsole[] }>("firmware.json"))
      ?.consoles ?? [];
  const crc = digest.crc32.replace(/^0x/, "");
  const known: FirmwareMatch[] = [];
  for (const entry of consoles) {
    for (const firmware of entry.firmware ?? []) {
      if (
        firmware.sha1 === digest.sha1 ||
        firmware.md5 === digest.md5 ||
        (firmware.crc32 === crc && firmware.size === digest.bytes)
      ) {
        known.push({
          console: entry.id,
          file: firmware.file,
          region: firmware.region,
          role: firmware.role,
          need: firmware.need,
          free: false,
        });
      }
    }
    for (const replacement of entry.freeReplacements ?? []) {
      if (replacement.vendored?.path?.includes(digest.sha1)) {
        known.push({
          console: entry.id,
          file: replacement.name,
          role: `free replacement for ${(replacement.replaces ?? []).join(", ")}`,
          license: replacement.license,
          free: true,
        });
      }
    }
  }
  return known;
}

/** Free replacements documented for a console id of firmware.json. */
export async function freeReplacements(consoleId: string): Promise<string[]> {
  const consoles =
    (await catalog<{ consoles: CatalogConsole[] }>("firmware.json"))
      ?.consoles ?? [];
  return (
    consoles.find((entry) => entry.id === consoleId)?.freeReplacements ?? []
  ).map(
    (replacement) =>
      `${replacement.name}${replacement.license ? ` (${replacement.license})` : ""}${replacement.vendored?.path ? ` — ${replacement.vendored.path}` : ""}`,
  );
}
