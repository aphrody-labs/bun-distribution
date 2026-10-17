// SPDX-License-Identifier: MIT
/** Read-only APK inspection: ZIP central directory, binary AndroidManifest.xml, resources.arsc summary. */
import { basename, resolve } from "node:path";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export interface AxmlElement {
  tag: string;
  attributes: Record<string, string | number | boolean>;
  children: AxmlElement[];
}

export interface ApkInfo {
  path: string;
  name: string;
  size: number;
  package: string | null;
  versionCode: number | string | null;
  versionName: string | null;
  minSdk: number | string | null;
  targetSdk: number | string | null;
  application: Record<string, string | number | boolean>;
  permissions: string[];
  activities: string[];
  services: string[];
  receivers: string[];
  providers: string[];
  features: string[];
  abis: Record<string, string[]>;
  dex: string[];
  signatures: string[];
  resources: { packages: number; strings: number } | null;
  entries: number;
  manifest: AxmlElement | null;
}

export function readZip(data: Uint8Array): {
  entries: ZipEntry[];
  read(entry: ZipEntry): Uint8Array;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new TypeError("not a ZIP archive (no end of central directory)");
  const total = view.getUint16(eocd + 10, true);
  let o = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < total && o + 46 <= data.length && view.getUint32(o, true) === 0x02014b50; i++) {
    const nameLen = view.getUint16(o + 28, true);
    const extra = view.getUint16(o + 30, true);
    const comment = view.getUint16(o + 32, true);
    entries.push({
      name: utf8.decode(data.subarray(o + 46, o + 46 + nameLen)),
      method: view.getUint16(o + 10, true),
      compressedSize: view.getUint32(o + 20, true),
      size: view.getUint32(o + 24, true),
      offset: view.getUint32(o + 42, true),
    });
    o += 46 + nameLen + extra + comment;
  }
  return {
    entries,
    read(entry) {
      const h = entry.offset;
      if (view.getUint32(h, true) !== 0x04034b50) throw new TypeError(`bad local header: ${entry.name}`);
      const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
      const raw = data.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return Bun.inflateSync(raw.slice());
      throw new TypeError(`unsupported ZIP method ${entry.method}: ${entry.name}`);
    },
  };
}

function stringPool(data: Uint8Array, view: DataView, o: number): string[] {
  const count = view.getUint32(o + 8, true);
  const flags = view.getUint32(o + 16, true);
  const stringsStart = o + view.getUint32(o + 20, true);
  const utf8 = (flags & 0x100) !== 0;
  const dec8 = new TextDecoder();
  const dec16 = new TextDecoder("utf-16le");
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = stringsStart + view.getUint32(o + 28 + i * 4, true);
    if (utf8) {
      p += data[p]! & 0x80 ? 2 : 1;
      let len = data[p]!;
      if (len & 0x80) len = ((len & 0x7f) << 8) | data[++p]!;
      p++;
      out.push(dec8.decode(data.subarray(p, p + len)));
    } else {
      let len = view.getUint16(p, true);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | view.getUint16(p + 2, true);
        p += 2;
      }
      out.push(dec16.decode(data.subarray(p + 2, p + 2 + len * 2)));
    }
  }
  return out;
}

/** Decode Android binary XML (AXML) into an element tree. */
export function decodeAxml(data: Uint8Array): AxmlElement {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(0, true) !== 0x0003) throw new TypeError("not an Android binary XML document");
  let strings: string[] = [];
  const root: AxmlElement = { tag: "#document", attributes: {}, children: [] };
  const stack = [root];
  for (let o = view.getUint16(2, true); o + 8 <= data.length;) {
    const type = view.getUint16(o, true);
    const size = view.getUint32(o + 4, true);
    if (size < 8) break;
    if (type === 0x0001) strings = stringPool(data, view, o);
    else if (type === 0x0102) {
      const ext = o + 16;
      const name = strings[view.getUint32(ext + 4, true)] ?? "";
      const attrStart = view.getUint16(ext + 8, true);
      const attrSize = view.getUint16(ext + 10, true);
      const attrCount = view.getUint16(ext + 12, true);
      const el: AxmlElement = { tag: name, attributes: {}, children: [] };
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const key = strings[view.getUint32(a + 4, true)] ?? "";
        const raw = view.getInt32(a + 8, true);
        const dataType = data[a + 15]!;
        const value = view.getUint32(a + 16, true);
        el.attributes[key] =
          raw >= 0
            ? (strings[raw] ?? "")
            : dataType === 0x03
              ? (strings[value] ?? "")
              : dataType === 0x12
                ? value !== 0
                : dataType === 0x10 || dataType === 0x11
                  ? view.getInt32(a + 16, true)
                  : dataType === 0x01
                    ? `@0x${value.toString(16).padStart(8, "0")}`
                    : value;
      }
      stack.at(-1)!.children.push(el);
      stack.push(el);
    } else if (type === 0x0103 && stack.length > 1) stack.pop();
    o += size;
  }
  return root.children[0] ?? root;
}

const androidName = (el: AxmlElement) => String(el.attributes.name ?? "");
const all = (el: AxmlElement | undefined, tag: string): AxmlElement[] =>
  el ? el.children.filter(c => c.tag === tag) : [];

export function parseApk(data: Uint8Array, path = "<memory>"): ApkInfo {
  const zip = readZip(data);
  const byName = new Map(zip.entries.map(e => [e.name, e]));
  const manifestEntry = byName.get("AndroidManifest.xml");
  const manifest = manifestEntry ? decodeAxml(zip.read(manifestEntry)) : null;
  const app = manifest ? all(manifest, "application")[0] : undefined;
  const sdk = manifest ? all(manifest, "uses-sdk")[0] : undefined;
  const abis: Record<string, string[]> = {};
  for (const e of zip.entries) {
    const m = /^lib\/([^/]+)\/(.+\.so)$/.exec(e.name);
    if (m) (abis[m[1]!] ??= []).push(m[2]!);
  }
  let resources: ApkInfo["resources"] = null;
  const arsc = byName.get("resources.arsc");
  if (arsc) {
    const bytes = zip.read(arsc);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) === 0x0002) {
      const headerSize = view.getUint16(2, true);
      resources = {
        packages: view.getUint32(8, true),
        strings: view.getUint16(headerSize, true) === 0x0001 ? view.getUint32(headerSize + 8, true) : 0,
      };
    }
  }
  const attr = (el: AxmlElement | undefined, key: string) => el?.attributes[key] ?? null;
  return {
    path,
    name: basename(path),
    size: data.length,
    package: (attr(manifest ?? undefined, "package") as string | null) ?? null,
    versionCode: attr(manifest ?? undefined, "versionCode") as number | null,
    versionName: attr(manifest ?? undefined, "versionName") as string | null,
    minSdk: attr(sdk, "minSdkVersion") as number | null,
    targetSdk: attr(sdk, "targetSdkVersion") as number | null,
    application: app?.attributes ?? {},
    permissions: manifest
      ? [...all(manifest, "uses-permission"), ...all(manifest, "uses-permission-sdk-23")].map(androidName)
      : [],
    activities: [...all(app, "activity"), ...all(app, "activity-alias")].map(androidName),
    services: all(app, "service").map(androidName),
    receivers: all(app, "receiver").map(androidName),
    providers: all(app, "provider").map(androidName),
    features: manifest ? all(manifest, "uses-feature").map(androidName).filter(Boolean) : [],
    abis,
    dex: zip.entries.filter(e => /^classes\d*\.dex$/.test(e.name)).map(e => e.name),
    signatures: zip.entries.filter(e => /^META-INF\/.+\.(RSA|DSA|EC)$/i.test(e.name)).map(e => e.name),
    resources,
    entries: zip.entries.length,
    manifest,
  };
}

export async function inspectApk(input: string): Promise<ApkInfo> {
  const path = resolve(input);
  return parseApk(await Bun.file(path).bytes(), path);
}
