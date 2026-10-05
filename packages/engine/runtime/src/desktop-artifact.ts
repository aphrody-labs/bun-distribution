/**
 * Verified native desktop artifacts. Engines stay in this executable, outside the light
 * consumer graph. System GTK/WebKit or WebView2 prerequisites are qualified separately.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hostTarget } from "./target";

export interface DesktopBuildInfo {
  name: "yolo-desktop";
  protocol: "yolo.desktop/1";
  version: string;
  target: string;
  git_rev: string;
  rustc: string;
  panic_recovery: boolean;
  engine: "system-webview";
}
export interface DesktopManifest {
  schema: "yolo.desktop-artifact/1";
  name: "yolo-desktop";
  protocol: "yolo.desktop/1";
  version: string;
  target: string;
  executable: string;
  files: Record<string, { sha256: string; bytes: number }>;
  source: { revision: string; dirty: boolean };
  build: DesktopBuildInfo;
}
const digest = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
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
    info.engine !== "system-webview" ||
    typeof info.version !== "string" ||
    typeof info.rustc !== "string" ||
    !/^[a-f0-9]{40}$/.test(info.git_rev) ||
    info.panic_recovery !== true
  ) {
    throw new Error("Native desktop host identity, target or unwind contract is incompatible");
  }
  return info;
}
/** Hash every regular file before native execution; reject traversal, symlinks and extra files. */
export function verifyDesktopArtifact(path: string, inspect = true): DesktopManifest {
  directory(path);
  regular(join(path, "manifest.json"));
  const manifest = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as DesktopManifest;
  if (
    manifest.schema !== "yolo.desktop-artifact/1" ||
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
    manifest.build?.panic_recovery !== true
  ) {
    throw new Error("Desktop artifact manifest is incompatible");
  }
  if (!(manifest.executable in manifest.files))
    throw new Error("Desktop manifest omits its executable");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) ||
      file === "manifest.json" ||
      typeof expected?.bytes !== "number" ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    ) {
      throw new Error("Desktop manifest has an unsafe file entry");
    }
    const full = join(path, file);
    regular(full);
    const bytes = readFileSync(full);
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) {
      throw new Error(`Desktop file integrity mismatch: ${file}`);
    }
  }
  // Avoid carrying untracked data or unverified libraries into a trusted installation.
  for (const entry of new Bun.Glob("*").scanSync({ cwd: path, onlyFiles: false, dot: true })) {
    if (entry !== "manifest.json" && !(entry in manifest.files)) {
      throw new Error(`Unverified desktop artifact entry: ${entry}`);
    }
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
  `${manifest.version}-${manifest.files[manifest.executable]!.sha256.slice(0, 12)}`;
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
          copyFileSync(join(source, file), join(staging, file));
        }
        copyFileSync(join(source, "manifest.json"), join(staging, "manifest.json"));
        chmodSync(join(staging, manifest.executable), 0o755);
        verifyDesktopArtifact(staging);
        renameSync(staging, destination);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    } else {
      const installed = verifyDesktopArtifact(destination);
      if (
        installed.files[installed.executable]!.sha256 !==
        manifest.files[manifest.executable]!.sha256
      ) {
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
export function writeDesktopManifest(
  path: string,
  executable: string,
  dirty: boolean,
  notices: Readonly<Record<string, string>> = {},
): DesktopManifest {
  directory(path);
  const info = inspectDesktopBinary(executable);
  const file = desktopFile(info.target);
  const bytes = readFileSync(executable);
  const manifest: DesktopManifest = {
    schema: "yolo.desktop-artifact/1",
    name: "yolo-desktop",
    protocol: "yolo.desktop/1",
    version: info.version,
    target: info.target,
    executable: file,
    files: { [file]: { sha256: digest(bytes), bytes: bytes.length } },
    source: { revision: info.git_rev, dirty },
    build: info,
  };
  copyFileSync(executable, join(path, file));
  chmodSync(join(path, file), 0o755);
  for (const [name, source] of Object.entries(notices)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === "manifest.json" || name === file) {
      throw new Error("Unsafe desktop notice filename");
    }
    regular(source);
    const notice = readFileSync(source);
    copyFileSync(source, join(path, name));
    manifest.files[name] = { sha256: digest(notice), bytes: notice.length };
  }
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  verifyDesktopArtifact(path);
  return manifest;
}
