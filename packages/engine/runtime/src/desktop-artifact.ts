/**
 * Verified native desktop artifacts. The engine is Chromium Embedded Framework (CEF): the artifact is
 * the host executable plus the CEF payload it loads from its own directory (`libcef`, the resource
 * paks, `locales/`), every file hashed in the manifest. Nothing outside the manifest is ever executed
 * or installed. The engines stay in this artifact, outside the light consumer graph.
 */
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostTarget } from "./target";

export interface DesktopBuildInfo {
  name: "yolo-desktop";
  protocol: "yolo.desktop/1";
  version: string;
  target: string;
  git_rev: string;
  rustc: string;
  panic_recovery: boolean;
  engine: "cef";
}
export interface DesktopFile {
  sha256: string;
  bytes: number;
}
export interface DesktopManifest {
  /** `/2` lists the CEF payload with nested relative paths (`locales/en-US.pak`); `/1` was one file. */
  schema: "yolo.desktop-artifact/2";
  name: "yolo-desktop";
  protocol: "yolo.desktop/1";
  version: string;
  target: string;
  executable: string;
  /** Relative POSIX path, then its digest. Every regular file of the artifact is listed here. */
  files: Record<string, DesktopFile>;
  source: { revision: string; dirty: boolean };
  build: DesktopBuildInfo;
}
/** Deepest directory nesting of a manifest entry: `locales/en-US.pak` is depth 1. */
const MAX_DEPTH = 3;
/** A path segment: no leading dot or dash, no separators, no whitespace. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CHUNK = 8 * 1024 * 1024;

const digest = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
/** Hash a file in bounded chunks: the CEF library is far larger than a safe in-memory read. */
function digestFile(path: string): DesktopFile {
  const hasher = new Bun.CryptoHasher("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = new Uint8Array(CHUNK);
    let bytes = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, null);
      if (read === 0) break;
      hasher.update(read === CHUNK ? buffer : buffer.subarray(0, read));
      bytes += read;
    }
    return { sha256: hasher.digest("hex"), bytes };
  } finally {
    closeSync(fd);
  }
}
/** A manifest key is a relative POSIX path of safe segments, never `manifest.json` at the root. */
export function safeDesktopPath(name: string): boolean {
  if (name === "manifest.json") return false;
  const segments = name.split("/");
  return segments.length <= MAX_DEPTH + 1 && segments.every((segment) => SEGMENT.test(segment));
}
export function desktopFile(target = hostTarget()): string {
  return target.includes("windows") ? "yolo-desktop.exe" : "yolo-desktop";
}
export function desktopHome(): string {
  return join(process.env["YOLO_HOME"] ?? join(homedir(), ".yolo"), "desktop", hostTarget());
}
function regular(path: string): void {
  if (!lstatSync(path).isFile()) throw new Error(`Expected a regular desktop file: ${path}`);
}
function directory(path: string): void {
  if (!lstatSync(path).isDirectory()) throw new Error(`Expected a real desktop directory: ${path}`);
}
/** `file` is under `root` through real directories only: no symlink anywhere on the way. */
function regularUnder(root: string, file: string): string {
  const segments = file.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    directory(current);
  }
  const full = join(current, segments.at(-1)!);
  regular(full);
  return full;
}
export function inspectDesktopBinary(executable: string): DesktopBuildInfo {
  regular(executable);
  const reply = Bun.spawnSync([executable, "--host-info"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  });
  if (reply.exitCode !== 0)
    throw new Error(
      "Native desktop host metadata failed: " +
        new TextDecoder().decode(reply.stderr).slice(0, 2048),
    );
  const info = JSON.parse(new TextDecoder().decode(reply.stdout)) as DesktopBuildInfo;
  if (
    info.name !== "yolo-desktop" ||
    info.protocol !== "yolo.desktop/1" ||
    info.target !== hostTarget() ||
    info.engine !== "cef" ||
    typeof info.version !== "string" ||
    typeof info.rustc !== "string" ||
    !/^[a-f0-9]{40}$/.test(info.git_rev) ||
    info.panic_recovery !== true
  ) {
    throw new Error("Native desktop host identity, target or unwind contract is incompatible");
  }
  return info;
}
/** Every file and directory entry under `path`, as relative POSIX paths (symlinks are entries too). */
function entries(path: string, prefix = ""): { file: string; directory: boolean }[] {
  const found: { file: string; directory: boolean }[] = [];
  for (const entry of readdirSync(join(path, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push({ file: relative, directory: true });
      found.push(...entries(path, relative));
    } else found.push({ file: relative, directory: false });
  }
  return found;
}
/** Digest of the whole tree: the immutable identity of an installed version. */
export function desktopTreeDigest(manifest: DesktopManifest): string {
  return digest(
    new TextEncoder().encode(
      Object.keys(manifest.files)
        .sort()
        .map((file) => `${file}\0${manifest.files[file]!.sha256}\n`)
        .join(""),
    ),
  );
}
/** Hash every regular file before native execution; reject traversal, symlinks and extra files. */
export function verifyDesktopArtifact(path: string, inspect = true): DesktopManifest {
  directory(path);
  regular(join(path, "manifest.json"));
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as DesktopManifest;
  if (
    manifest.schema !== "yolo.desktop-artifact/2" ||
    manifest.name !== "yolo-desktop" ||
    manifest.protocol !== "yolo.desktop/1" ||
    manifest.target !== hostTarget() ||
    manifest.executable !== desktopFile(manifest.target) ||
    !/^\d[0-9A-Za-z.+-]*$/.test(manifest.version) ||
    !/^[a-f0-9]{40}$/.test(manifest.source?.revision) ||
    typeof manifest.source?.dirty !== "boolean" ||
    manifest.files === null ||
    typeof manifest.files !== "object" ||
    manifest.build?.protocol !== manifest.protocol ||
    manifest.build?.target !== manifest.target ||
    manifest.build?.version !== manifest.version ||
    manifest.build?.git_rev !== manifest.source.revision ||
    manifest.build?.engine !== "cef" ||
    manifest.build?.panic_recovery !== true
  ) {
    throw new Error("Desktop artifact manifest is incompatible");
  }
  if (!(manifest.executable in manifest.files))
    throw new Error("Desktop manifest omits its executable");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (
      !safeDesktopPath(file) ||
      typeof expected?.bytes !== "number" ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    ) {
      throw new Error("Desktop manifest has an unsafe file entry");
    }
    const actual = digestFile(regularUnder(path, file));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`Desktop file integrity mismatch: ${file}`);
    }
  }
  // Avoid carrying untracked data or unverified libraries into a trusted installation. A directory
  // is allowed only as the parent of a listed file; a symlink or a stray file never is.
  const parents = new Set(
    Object.keys(manifest.files).flatMap((file) => {
      const segments = file.split("/").slice(0, -1);
      return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
    }),
  );
  for (const entry of entries(path)) {
    if (entry.file === "manifest.json") continue;
    const allowed = entry.directory ? parents.has(entry.file) : entry.file in manifest.files;
    if (!allowed) throw new Error(`Unverified desktop artifact entry: ${entry.file}`);
    if (entry.directory) directory(join(path, entry.file));
  }
  if (inspect) {
    const info = inspectDesktopBinary(join(path, manifest.executable));
    if (
      info.git_rev !== manifest.source.revision ||
      info.version !== manifest.version ||
      info.rustc !== manifest.build.rustc
    )
      throw new Error("Desktop binary differs from its manifest");
  }
  return manifest;
}
const versionName = (manifest: DesktopManifest): string =>
  `${manifest.version}-${desktopTreeDigest(manifest).slice(0, 12)}`;
function pointer(dir: string, name: "current" | "previous"): string | undefined {
  const path = join(dir, name);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace unmanaged desktop ${name}`);
  const value = readlinkSync(path);
  if (!/^\d[0-9A-Za-z.+-]*-[a-f0-9]{12}$/.test(value)) {
    throw new Error(`Unsafe desktop ${name} pointer`);
  }
  return value;
}
function point(dir: string, name: "current" | "previous", value: string): void {
  pointer(dir, name);
  const temp = join(dir, `.${name}-${crypto.randomUUID()}`);
  try {
    symlinkSync(value, temp, "dir");
    renameSync(temp, join(dir, name));
  } finally {
    rmSync(temp, { force: true });
  }
}
function locked<T>(dir: string, operation: () => T): T {
  mkdirSync(dir, { recursive: true });
  directory(dir);
  const lock = join(dir, ".install-lock");
  mkdirSync(lock); // An active installer is never removed or restarted.
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true });
  }
}
/** Files the loader must be able to execute: the host and Chromium's setuid sandbox helper. */
const needsExecuteBit = (manifest: DesktopManifest, file: string): boolean =>
  file === manifest.executable || file === "chrome-sandbox";
export function installDesktopArtifact(source: string, home = desktopHome()): string {
  const manifest = verifyDesktopArtifact(resolve(source));
  return locked(home, () => {
    const current = pointer(home, "current");
    if (current !== undefined) verifyDesktopArtifact(join(home, current));
    const name = versionName(manifest);
    const destination = join(home, name);
    if (!existsSync(destination)) {
      const staging = mkdtempSync(join(home, ".staging-"));
      try {
        for (const file of Object.keys(manifest.files)) {
          mkdirSync(dirname(join(staging, file)), { recursive: true });
          copyFileSync(join(source, file), join(staging, file));
          if (needsExecuteBit(manifest, file)) chmodSync(join(staging, file), 0o755);
        }
        copyFileSync(join(source, "manifest.json"), join(staging, "manifest.json"));
        verifyDesktopArtifact(staging);
        renameSync(staging, destination);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    } else {
      const installed = verifyDesktopArtifact(destination);
      if (desktopTreeDigest(installed) !== desktopTreeDigest(manifest)) {
        throw new Error("Installed desktop version conflicts with its immutable name");
      }
    }
    if (current !== name) {
      if (current !== undefined) point(home, "previous", current);
      point(home, "current", name);
    }
    return name;
  });
}
export function rollbackDesktopArtifact(home = desktopHome()): string {
  return locked(home, () => {
    const current = pointer(home, "current");
    const previous = pointer(home, "previous");
    if (current === undefined || previous === undefined)
      throw new Error("No verified previous desktop artifact");
    verifyDesktopArtifact(join(home, current));
    verifyDesktopArtifact(join(home, previous));
    point(home, "previous", current);
    point(home, "current", previous);
    return previous;
  });
}
export function verifyInstalledDesktopArtifact(home = desktopHome()): DesktopManifest {
  const current = pointer(home, "current");
  if (current === undefined) throw new Error("No managed desktop artifact is active");
  return verifyDesktopArtifact(join(home, current));
}
export function installedDesktopExecutable(): string | undefined {
  const home = desktopHome();
  if (!existsSync(home)) return undefined;
  const current = pointer(home, "current");
  if (current === undefined) return undefined;
  const path = join(home, current);
  const manifest = verifyDesktopArtifact(path);
  return join(path, manifest.executable);
}
export interface DesktopWriteOptions {
  /** License and notice files by artifact name; copied to the artifact root. */
  notices?: Readonly<Record<string, string>>;
  /**
   * The CEF payload by relative artifact path (`libcef.so`, `locales/en-US.pak`) with its source file.
   * Each file is copied, passed through `transform` (stripping) and then hashed.
   */
  payload?: Readonly<Record<string, string>>;
  /** Runs on the copy in the artifact directory, before it is hashed. */
  transform?: (copy: string, name: string) => void;
}
export function writeDesktopManifest(
  path: string,
  executable: string,
  dirty: boolean,
  options: DesktopWriteOptions | Readonly<Record<string, string>> = {},
): DesktopManifest {
  // Older callers passed the notices record directly.
  const write: DesktopWriteOptions =
    "notices" in options || "payload" in options || "transform" in options
      ? (options as DesktopWriteOptions)
      : { notices: options as Readonly<Record<string, string>> };
  directory(path);
  const info = inspectDesktopBinary(executable);
  const file = desktopFile(info.target);
  const manifest: DesktopManifest = {
    schema: "yolo.desktop-artifact/2",
    name: "yolo-desktop",
    protocol: "yolo.desktop/1",
    version: info.version,
    target: info.target,
    executable: file,
    files: {},
    source: { revision: info.git_rev, dirty },
    build: info,
  };
  const add = (name: string, source: string): void => {
    if (!safeDesktopPath(name) || name in manifest.files) {
      throw new Error(`Unsafe or duplicate desktop artifact path: ${name}`);
    }
    regular(source);
    const destination = join(path, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    write.transform?.(destination, name);
    manifest.files[name] = digestFile(destination);
  };
  add(file, executable);
  chmodSync(join(path, file), 0o755);
  for (const [name, source] of Object.entries(write.notices ?? {})) {
    if (name.includes("/")) throw new Error("Unsafe desktop notice filename");
    add(name, source);
  }
  for (const [name, source] of Object.entries(write.payload ?? {})) add(name, source);
  if (write.payload?.["chrome-sandbox"] !== undefined)
    chmodSync(join(path, "chrome-sandbox"), 0o755);
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  verifyDesktopArtifact(path);
  return manifest;
}
