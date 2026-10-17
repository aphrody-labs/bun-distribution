// SPDX-License-Identifier: Apache-2.0
/**
 * Native content-type detection (clean-room, signature based): a bounded prefix of each file is
 * matched against magic signatures and a text heuristic, giving the `kind`/`mime` pair stored in
 * the `file` table. Steam-specific containers (VDF, binary KeyValues, depot manifests, CPK) are
 * first-class.
 */

export interface FileType {
  kind: string;
  mime: string;
}

interface Sig {
  kind: string;
  mime: string;
  at: number;
  bytes: number[] | string;
}

const S = (
  kind: string,
  mime: string,
  bytes: number[] | string,
  at = 0,
): Sig => ({ kind, mime, bytes, at });

const SIGNATURES: Sig[] = [
  S("pe", "application/vnd.microsoft.portable-executable", "MZ"),
  S("elf", "application/x-elf", [0x7f, 0x45, 0x4c, 0x46]),
  S("macho", "application/x-mach-binary", [0xcf, 0xfa, 0xed, 0xfe]),
  S("macho", "application/x-mach-binary", [0xfe, 0xed, 0xfa, 0xcf]),
  S("steam-appinfo", "application/x-steam-appinfo", [0x27, 0x44, 0x56, 0x07]),
  S("steam-appinfo", "application/x-steam-appinfo", [0x28, 0x44, 0x56, 0x07]),
  S("steam-appinfo", "application/x-steam-appinfo", [0x29, 0x44, 0x56, 0x07]),
  S(
    "steam-packageinfo",
    "application/x-steam-packageinfo",
    [0x27, 0x55, 0x56, 0x06],
  ),
  S(
    "steam-packageinfo",
    "application/x-steam-packageinfo",
    [0x28, 0x55, 0x56, 0x06],
  ),
  S(
    "steam-manifest",
    "application/x-steam-depot-manifest",
    [0xd0, 0x17, 0xf6, 0x71],
  ),
  S("cpk", "application/x-criware-cpk", "CPK "),
  S("zip", "application/zip", [0x50, 0x4b, 0x03, 0x04]),
  S("zip", "application/zip", [0x50, 0x4b, 0x05, 0x06]),
  S("gzip", "application/gzip", [0x1f, 0x8b]),
  S("zstd", "application/zstd", [0x28, 0xb5, 0x2f, 0xfd]),
  S("xz", "application/x-xz", [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  S("7z", "application/x-7z-compressed", [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  S("rar", "application/vnd.rar", "Rar!"),
  S("cab", "application/vnd.ms-cab-compressed", "MSCF"),
  S("png", "image/png", [0x89, 0x50, 0x4e, 0x47]),
  S("jpeg", "image/jpeg", [0xff, 0xd8, 0xff]),
  S("gif", "image/gif", "GIF8"),
  S("webp", "image/webp", "WEBP", 8),
  S("bmp", "image/bmp", "BM"),
  S("ico", "image/vnd.microsoft.icon", [0x00, 0x00, 0x01, 0x00]),
  S("dds", "image/vnd-ms.dds", "DDS "),
  S("tga", "image/x-tga", []),
  S("pdf", "application/pdf", "%PDF"),
  S("sqlite", "application/vnd.sqlite3", "SQLite format 3"),
  S("leveldb-log", "application/x-leveldb", []),
  S("ogg", "audio/ogg", "OggS"),
  S("riff", "audio/wav", "RIFF"),
  S("mp3", "audio/mpeg", "ID3"),
  S("flac", "audio/flac", "fLaC"),
  S("mp4", "video/mp4", "ftyp", 4),
  S("webm", "video/webm", [0x1a, 0x45, 0xdf, 0xa3]),
  S("wasm", "application/wasm", [0x00, 0x61, 0x73, 0x6d]),
  S("class", "application/java-vm", [0xca, 0xfe, 0xba, 0xbe]),
  S("minidump", "application/x-dmp", "MDMP"),
  S("pdb", "application/x-ms-pdb", "Microsoft C/C++ MSF 7.00"),
  S(
    "lnk",
    "application/x-ms-shortcut",
    [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00],
  ),
  S("ttf", "font/ttf", [0x00, 0x01, 0x00, 0x00]),
  S("otf", "font/otf", "OTTO"),
  S("woff2", "font/woff2", "wOF2"),
  S("woff", "font/woff", "wOFF"),
  S("vpk", "application/x-valve-vpk", [0x34, 0x12, 0xaa, 0x55]),
  S("steam-dmp", "application/x-steam-crash-dump", "STEAMDMP"),
  S("protobuf-cache", "application/x-protobuf", []),
].filter((s) => s.bytes.length > 0);

const TEXT_EXT: Record<string, FileType> = {
  vdf: { kind: "vdf", mime: "text/x-valve-keyvalues" },
  acf: { kind: "vdf", mime: "text/x-valve-keyvalues" },
  json: { kind: "json", mime: "application/json" },
  txt: { kind: "text", mime: "text/plain" },
  log: { kind: "log", mime: "text/plain" },
  ini: { kind: "ini", mime: "text/plain" },
  cfg: { kind: "config", mime: "text/plain" },
  xml: { kind: "xml", mime: "application/xml" },
  html: { kind: "html", mime: "text/html" },
  htm: { kind: "html", mime: "text/html" },
  css: { kind: "css", mime: "text/css" },
  js: { kind: "javascript", mime: "text/javascript" },
  lua: { kind: "lua", mime: "text/x-lua" },
  csv: { kind: "csv", mime: "text/csv" },
  md: { kind: "markdown", mime: "text/markdown" },
  vcs: { kind: "shader", mime: "application/octet-stream" },
  bin: { kind: "binary", mime: "application/octet-stream" },
  cpk: { kind: "cpk", mime: "application/x-criware-cpk" },
  manifest: { kind: "text", mime: "text/plain" },
  sig: { kind: "signature", mime: "application/octet-stream" },
  zip: { kind: "zip", mime: "application/zip" },
};

const matches = (buf: Uint8Array, sig: Sig): boolean => {
  const b =
    typeof sig.bytes === "string"
      ? Array.from(sig.bytes, (c) => c.charCodeAt(0))
      : sig.bytes;
  if (buf.length < sig.at + b.length) return false;
  for (let i = 0; i < b.length; i++) if (buf[sig.at + i] !== b[i]) return false;
  return true;
};

function looksText(buf: Uint8Array): "utf8" | "utf16" | null {
  if (buf.length === 0) return null;
  if (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xff))
  )
    return "utf16";
  let control = 0;
  let zeros = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = buf[i]!;
    if (c === 0) zeros++;
    else if (
      c < 0x20 &&
      c !== 0x09 &&
      c !== 0x0a &&
      c !== 0x0d &&
      c !== 0x0c &&
      c !== 0x1b
    )
      control++;
  }
  if (zeros > n / 3 && zeros < n * 0.6) return "utf16";
  return zeros === 0 && control <= n / 100 ? "utf8" : null;
}

/** Classifies a file prefix (first 4 KiB is enough) with an optional extension and total size hint. */
export function detectFileType(
  prefix: Uint8Array,
  ext = "",
  size = prefix.length,
): FileType {
  for (const sig of SIGNATURES) {
    if (matches(prefix, sig)) {
      if (sig.kind === "riff") {
        const tag = String.fromCharCode(...prefix.subarray(8, 12));
        if (tag === "WAVE") return { kind: "wav", mime: "audio/wav" };
        if (tag === "AVI ") return { kind: "avi", mime: "video/x-msvideo" };
        if (tag === "WEBP") return { kind: "webp", mime: "image/webp" };
        return { kind: "riff", mime: "application/octet-stream" };
      }
      if (sig.kind === "pe" && ext) {
        const e = ext.toLowerCase();
        if (e === "dll") return { kind: "pe-dll", mime: sig.mime };
        if (e === "exe") return { kind: "pe-exe", mime: sig.mime };
        if (e === "sys") return { kind: "pe-sys", mime: sig.mime };
      }
      return { kind: sig.kind, mime: sig.mime };
    }
  }
  const text = looksText(prefix);
  if (text) {
    const head = new TextDecoder(text === "utf16" ? "utf-16le" : "utf-8")
      .decode(prefix.subarray(0, 512))
      .trimStart();
    if (head.startsWith("{") || head.startsWith("["))
      return { kind: "json", mime: "application/json" };
    if (head.startsWith("<?xml") || head.startsWith("<"))
      return { kind: "xml", mime: "application/xml" };
    if (
      /^"[^"\n]+"\s*\r?\n\s*\{/.test(head) ||
      head.startsWith('"AppState"') ||
      head.startsWith('"libraryfolders"')
    ) {
      return { kind: "vdf", mime: "text/x-valve-keyvalues" };
    }
    if (/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(head))
      return { kind: "log", mime: "text/plain" };
    if (head.startsWith("#!")) return { kind: "script", mime: "text/x-script" };
    return (
      TEXT_EXT[ext.toLowerCase()] ?? {
        kind: "text",
        mime: text === "utf16" ? "text/plain; charset=utf-16" : "text/plain",
      }
    );
  }
  const byExt = TEXT_EXT[ext.toLowerCase()];
  if (byExt && byExt.kind !== "text") return byExt;
  if (size === 0) return { kind: "empty", mime: "application/x-empty" };
  if (ext.toLowerCase() === "tga") return { kind: "tga", mime: "image/x-tga" };
  if (/^\d{6}$/.test(ext) || ext.toLowerCase() === "ldb")
    return { kind: "leveldb", mime: "application/x-leveldb" };
  return { kind: "binary", mime: "application/octet-stream" };
}

/** Reads the prefix of a file and classifies it. */
export async function detectFile(path: string, ext = ""): Promise<FileType> {
  const f = Bun.file(path);
  const size = f.size;
  const bytes = new Uint8Array(
    await f.slice(0, Math.min(size, 4096)).arrayBuffer(),
  );
  return detectFileType(bytes, ext, size);
}
