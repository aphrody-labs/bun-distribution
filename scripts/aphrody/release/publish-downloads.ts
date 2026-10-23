#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- uploads, checksums and factory jobs are intentionally sequential */
/**
 * Publishes the Aphrody downloads (tools/aphrody/config/downloads.json) in one repeatable flow:
 *
 *   plan                          what would be built, staged and published (no mutation)
 *   build  --revision <sha> [--attempt <n>]  prepare + build the factory binaries (yolo ops build-factory), wait for the jobs
 *   release --revision <sha>      stage every artifact, scan for secrets, upload to the host, flip `current`
 *                                 --only <id,...> publishes just those artifacts (installers always), noting the rest
 *   assets [--staged <dir>]       publish installers and optional prebuilt kits in an immutable snapshot
 *                                 repeat --staged; --staged-revision <sha> records their verified source revision
 *   github --release <id>         create/refresh the GitHub release of each configured EXISTING repository
 *   verify [--release <id>]       download from the public URL, check SHA-256, run the binaries
 *   host-plan | host-apply        refresh the app on its cataloged native systemd/nginx host (plan by default)
 *
 * Hosts change only through `aphrody infra ssh`; the binaries are built on the factory from a pushed
 * revision (never Cargo in WSL). On the host itself (APHRODY_BUILD_HOST=<host.target>, the build-factory
 * convention) remote commands and uploads run locally. Private keys never enter this script.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { basename, join, resolve, sep } from "node:path";

export const root = resolve(import.meta.dir, "../../..");

// ---------------------------------------------------------------------------------------------
// configuration

export interface PlatformConfig {
  platform: string;
  target: string;
  enabled?: boolean;
  optional?: boolean;
  note?: string;
  reason?: string;
  cargo?: string[];
  binary?: string;
  glibcMax?: string;
  archive?: "tar.gz" | "zip";
  bunTarget?: string;
  runtimeArtifact?: string;
}

export interface ArtifactConfig {
  id: string;
  /**
   * `desktop`: what the « Download Aphrody » button of the site points at (Aphrody-Setup.exe); `kit`: a Bun kit exe;
   * `desktop-app`: the Tauri installer of the desktop app, installed by Aphrody-Setup when it is published.
   */
  kind: "factory-binary" | "bun-compile" | "plugin" | "desktop" | "kit" | "desktop-app" | "wasm";
  description: string;
  versionFrom?: {
    cargoWorkspace?: string;
    file?: string;
    packageJson?: string;
  };
  /** Local Bun stage script (`bun <script> --out <dir>`) and the manifest of entries it writes into `<dir>`. */
  stage?: { script: string; manifest: string };
  executable?: string;
  provides?: string[];
  platforms?: PlatformConfig[];
  entry?: string;
  compileFlags?: string[];
  sdk?: string;
  templates?: string;
  git?: { path: string; ref: string; subdir: string };
  manifest?: string;
  repository?: string;
}

export interface DownloadsConfig {
  site: { baseUrl: string; hosts: string[]; certName: string };
  host: {
    target: string;
    root: string;
    service: string;
    port: number;
    bun: string;
    keepReleases: number;
  };
  /** `target`: host alias of the build factory; `pushTo`: ssh alias, on the factory, of the release host when they differ. */
  factory: {
    repo: string;
    workspace: string;
    cargoTargetDir: string;
    jobPrefix: string;
    target?: string;
    pushTo?: string;
  };
  assets: Record<string, string>;
  artifacts: ArtifactConfig[];
  github: {
    tagPrefix: string;
    releases: { repository: string; artifacts: string[]; extra: string[] }[];
  };
  secrets: { deniedNames: string[]; contentPatterns: string[] };
}

export const loadConfig = (): DownloadsConfig =>
  JSON.parse(readFileSync(join(root, "tools/aphrody/config/downloads.json"), "utf8")) as DownloadsConfig;

const expand = (path: string): string => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(root, path));

// ---------------------------------------------------------------------------------------------
// pure helpers (unit tested)

export interface PublishedFile {
  component: string;
  version: string;
  platform: string;
  target: string;
  kind: string;
  file: string;
  sha256: string;
  size: number;
  provides?: string[];
}

export const sha256Bytes = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

export function releaseId(commit: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${commit.slice(0, 12)}`;
}

export function archiveName(component: string, version: string, commit: string, target: string, ext: string): string {
  return `${component}-${version}-${commit.slice(0, 9)}-${target}.${ext}`;
}

export function buildSums(files: { file: string; sha256: string }[]): string {
  return `${files
    .toSorted((a, b) => a.file.localeCompare(b.file))
    .map(f => `${f.sha256}  ${f.file}`)
    .join("\n")}\n`;
}

export function buildManifest(args: {
  baseUrl: string;
  id: string;
  commit: string;
  files: PublishedFile[];
  notes: string[];
  now?: Date;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: (args.now ?? new Date()).toISOString(),
    release: { id: args.id, commit: args.commit },
    baseUrl: args.baseUrl,
    artifacts: args.files
      .toSorted((a, b) => (a.component + a.platform).localeCompare(b.component + b.platform))
      .map(f => ({
        name: f.component,
        version: f.version,
        platform: f.platform,
        target: f.target,
        kind: f.kind,
        url: `${args.baseUrl}/files/${f.file}`,
        sha256: f.sha256,
        size: f.size,
        file: f.file,
        provides: f.provides,
      })),
    notes: args.notes,
  };
}

export interface SecretHit {
  where: string;
  rule: string;
}

export function scanName(name: string, denied: string[]): SecretHit[] {
  return denied.filter(p => new RegExp(p, "i").test(name)).map(rule => ({ where: name, rule }));
}

/** Scans bytes in 8 MiB windows (with overlap) so a binary of any size stays bounded in memory. */
export function scanBytes(where: string, data: Uint8Array, patterns: string[]): SecretHit[] {
  const regexes = patterns.map(p => ({ p, re: new RegExp(p) }));
  const hits: SecretHit[] = [];
  const window = 8 * 1024 * 1024;
  const overlap = 512;
  for (let start = 0; start < data.length; start += window) {
    const text = Buffer.from(data.subarray(start, Math.min(data.length, start + window + overlap))).toString("latin1");
    for (const { p, re } of regexes) if (re.test(text)) hits.push({ where, rule: p });
  }
  return hits;
}

export function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

export function scanTree(dir: string, cfg: DownloadsConfig["secrets"]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const rel of walk(dir)) {
    hits.push(...scanName(rel, cfg.deniedNames));
    hits.push(...scanBytes(rel, new Uint8Array(readFileSync(join(dir, rel))), cfg.contentPatterns));
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// process helpers

export async function run(
  argv: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    allowFail?: boolean;
  } = {},
) {
  const proc = Bun.spawn(argv, {
    windowsHide: true,
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !opts.allowFail)
    throw new Error(`${argv.slice(0, 4).join(" ")} failed (${code}):\n${stderr || stdout}`);
  return { code, stdout, stderr };
}

/** True when this process runs on the release host itself (same convention as build-factory). */
const onHost = (cfg: DownloadsConfig): boolean => process.env.APHRODY_BUILD_HOST === cfg.host.target;

/** `yolo ops build-factory ...` through the Workspace owner, without depending on an installed link. */
const buildFactory = (...args: string[]): string[] => [
  process.execPath,
  join(root, "packages/bun-workspace/src/automation/ops.ts"),
  "build-factory",
  ...args,
];

/** Runs a shell command on the host through `aphrody infra ssh exec` (never raw ssh). */
export async function remote(cfg: DownloadsConfig, command: string, timeoutSecs = 120) {
  if (onHost(cfg)) {
    const local = await run(["timeout", String(timeoutSecs), "bash", "-c", command], {
      allowFail: true,
    });
    if (local.code !== 0)
      throw new Error(
        `remote command failed (${local.code}): ${command.slice(0, 200)}
${local.stderr}${local.stdout}`,
      );
    return local.stdout;
  }
  const result = await run(["aphrody", "infra", "ssh", "exec", "--host", cfg.host.target, "--json", "-c", command], {
    env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(timeoutSecs) },
    allowFail: true,
  });
  let parsed: { exit_code?: number; stdout?: string; stderr?: string } | null = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // transport failure: the CLI printed an error instead of JSON
  }
  if (parsed === null) throw new Error(`ssh exec failed: ${result.stderr || result.stdout}`);
  if ((parsed.exit_code ?? 1) !== 0) {
    throw new Error(
      `remote command failed (${parsed.exit_code}): ${command.slice(0, 200)}\n${parsed.stderr ?? ""}${parsed.stdout ?? ""}`,
    );
  }
  return parsed.stdout ?? "";
}

export async function put(cfg: DownloadsConfig, local: string, dest: string) {
  if (onHost(cfg)) {
    await run(["cp", "--", local, dest]);
    return;
  }
  await run(["aphrody", "infra", "ssh", "sftp", "--host", cfg.host.target, "--put", local, "--path", dest]);
}

/** Same config addressed to the build factory host (the release host itself when they are not split). */
export const factoryCfg = (cfg: DownloadsConfig): DownloadsConfig =>
  cfg.factory.target && cfg.factory.target !== cfg.host.target
    ? { ...cfg, host: { ...cfg.host, target: cfg.factory.target } }
    : cfg;

const q = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------------------------------------
// versions and sources

function artifactVersion(artifact: ArtifactConfig): string {
  const from = artifact.versionFrom;
  if (from?.file) return readFileSync(join(root, from.file), "utf8").trim();
  if (from?.packageJson)
    return (
      JSON.parse(readFileSync(join(root, from.packageJson), "utf8")) as {
        version: string;
      }
    ).version;
  if (from?.cargoWorkspace) {
    const text = readFileSync(join(root, from.cargoWorkspace), "utf8");
    const section = /\[workspace\.package\]([\s\S]*?)(\n\[|$)/.exec(text)?.[1] ?? "";
    const version = /^version\s*=\s*"([^"]+)"/m.exec(section)?.[1];
    if (!version) throw new Error("workspace.package.version not found");
    return version;
  }
  if (artifact.kind === "plugin" && artifact.git && artifact.manifest) {
    return pluginVersion(artifact);
  }
  throw new Error(`no version source for ${artifact.id}`);
}

function pluginVersion(artifact: ArtifactConfig): string {
  const git = artifact.git!;
  const sub = git.subdir ? `${git.subdir}/` : "";
  const out = Bun.spawnSync(["git", "-C", expand(git.path), "show", `${git.ref}:${sub}${artifact.manifest}`], {
    windowsHide: true,
  });
  if (out.exitCode !== 0)
    throw new Error(
      `cannot read ${artifact.manifest} of ${artifact.id}: clone ${artifact.repository ?? "its repository"} into ${expand(git.path)}`,
    );
  return (JSON.parse(out.stdout.toString()) as { version: string }).version;
}

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  return (await run(["git", "-C", cwd, ...args])).stdout.trim();
}

// ---------------------------------------------------------------------------------------------
// staging

const stageRoot = (id: string): string => join(root, "dist/downloads", id);

async function tar(args: string[]) {
  await run(["tar", ...args]);
}

/** Deterministic zip (deflate, fixed timestamps, unix modes kept) so Windows needs no extra tool to unpack. */
export function zipEntries(dir: string): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (46 << 9) | (1 << 5) | 1; // 2026-01-01
  for (const rel of walk(dir).toSorted()) {
    const data = readFileSync(join(dir, rel));
    const packed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(rel, "utf8");
    const crc = Bun.hash.crc32(data) >>> 0;
    const mode = statSync(join(dir, rel)).mode & 0o777;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

async function zipDir(dir: string, out: string) {
  await Bun.write(out, zipEntries(dir));
}

export async function stagePlugin(artifact: ArtifactConfig, id: string, commit: string): Promise<PublishedFile[]> {
  const git = artifact.git!;
  const repo = expand(git.path);
  const work = mkdtempSync(join(tmpdir(), `plugin-${artifact.id}-`));
  try {
    const sub = git.subdir ? [`${git.ref}:${git.subdir}`] : [git.ref];
    const tarball = join(work, "plugin.tar");
    await run(["git", "-C", repo, "archive", "--format=tar", `--output=${tarball}`, ...sub]);
    const tree = join(work, "tree");
    mkdirSync(tree);
    await tar(["-xf", tarball, "-C", tree]);
    const version = pluginVersion(artifact);
    const sourceCommit = await gitOut(repo, "rev-parse", git.ref);
    const out: PublishedFile[] = [];
    const dir = join(stageRoot(id), "files");
    mkdirSync(dir, { recursive: true });
    for (const ext of ["tar.gz", "zip"] as const) {
      const file = archiveName(artifact.id, version, sourceCommit, "any", ext);
      if (ext === "zip") await zipDir(tree, join(dir, file));
      else
        await tar([
          "-czf",
          join(dir, file),
          "--sort=name",
          "--owner=0",
          "--group=0",
          "--numeric-owner",
          "-C",
          tree,
          ".",
        ]);
      out.push({
        component: artifact.id,
        version,
        platform: "any",
        target: "any",
        kind: "plugin",
        file,
        sha256: await sha256File(join(dir, file)),
        size: statSync(join(dir, file)).size,
      });
    }
    void commit;
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** One entry of the manifest a stage script writes (scripts/release/stage-setup.ts, stage-omar-kit.ts). */
export interface StagedEntry {
  name: string;
  version: string;
  platform: string;
  target: string;
  kind: string;
  file: string;
  size: number;
  sha256: string;
}

/** The staged entries of one artifact that belong to `platform`, checked against the declared component. */
export function stagedFiles(artifact: ArtifactConfig, platform: PlatformConfig, entries: StagedEntry[]): StagedEntry[] {
  const mine = entries.filter(e => e.platform === platform.platform);
  for (const entry of mine) {
    if (entry.name !== artifact.id)
      throw new Error(`${artifact.stage!.manifest} names ${entry.name}, expected ${artifact.id}`);
    if (!/^[A-Za-z0-9._-]+$/.test(entry.file) || !/^[0-9a-f]{64}$/.test(entry.sha256))
      throw new Error(`${artifact.stage!.manifest}: invalid entry ${entry.file}`);
  }
  if (mine.length === 0) throw new Error(`${artifact.id}: the stage produced nothing for ${platform.platform}`);
  return mine;
}

/** Runs the artifact's local Bun stage script, re-hashes what it wrote and copies it into the release stage. */
export async function stageLocal(
  artifact: ArtifactConfig,
  platform: PlatformConfig,
  id: string,
  cfg: DownloadsConfig,
): Promise<PublishedFile[]> {
  const work = mkdtempSync(join(tmpdir(), `stage-${artifact.id}-`));
  try {
    await run(["bun", join(root, artifact.stage!.script), "--out", work]);
    const entries = JSON.parse(readFileSync(join(work, artifact.stage!.manifest), "utf8")) as StagedEntry[];
    const dir = join(stageRoot(id), "files");
    mkdirSync(dir, { recursive: true });
    const out: PublishedFile[] = [];
    for (const entry of stagedFiles(artifact, platform, entries)) {
      const source = join(work, entry.file);
      const got = await sha256File(source);
      if (got !== entry.sha256) throw new Error(`${entry.file}: staged hash ${got} != ${entry.sha256}`);
      const hits = [
        ...scanName(entry.file, cfg.secrets.deniedNames),
        ...scanBytes(entry.file, new Uint8Array(readFileSync(source)), cfg.secrets.contentPatterns),
      ];
      if (hits.length) throw new Error(`secret scan failed for ${entry.file}: ${hits.map(h => h.rule).join(", ")}`);
      await run(["cp", source, join(dir, entry.file)]);
      out.push({
        component: artifact.id,
        version: entry.version,
        platform: entry.platform,
        target: entry.target,
        kind: entry.kind,
        file: entry.file,
        sha256: entry.sha256,
        size: statSync(source).size,
      });
    }
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function stageYolo(
  artifact: ArtifactConfig,
  platform: PlatformConfig,
  id: string,
  commit: string,
  cfg: DownloadsConfig,
): Promise<PublishedFile> {
  const version = artifactVersion(artifact);
  const windows = platform.target.includes("windows");
  const work = mkdtempSync(join(tmpdir(), "yolo-stage-"));
  try {
    mkdirSync(join(work, "bin"));
    const exe = join(work, "bin", windows ? "yolo.exe" : "yolo");
    await run([
      "bun",
      "build",
      "--compile",
      `--target=${platform.bunTarget}`,
      ...(artifact.compileFlags ?? []),
      "--define",
      `YOLO_VERSION=${JSON.stringify(version)}`,
      artifact.entry!,
      "--outfile",
      exe,
    ]);
    const artifactDir = expand(platform.runtimeArtifact!);
    const real =
      Bun.spawnSync(["readlink", "-f", artifactDir], { windowsHide: true }).stdout.toString().trim() || artifactDir;
    if (!existsSync(join(real, "manifest.json"))) throw new Error(`no runtime artifact at ${real}`);
    await run(["cp", "-r", real, join(work, "artifact")]);
    // the layout of the monorepo under YOLO_HOME: packages/engine/runtime (SDK) and m3/templates
    for (const rel of [artifact.sdk!, artifact.templates!]) {
      mkdirSync(join(work, rel, ".."), { recursive: true });
      await run(["cp", "-r", join(root, rel), join(work, rel)]);
    }
    rmSync(join(work, artifact.sdk!, "node_modules"), {
      recursive: true,
      force: true,
    });
    writeFileSync(join(work, "VERSION"), `${version}\n`);
    await run(["cp", join(real, "LICENSE"), join(work, "LICENSE")]);
    writeFileSync(
      join(work, "release.json"),
      `${JSON.stringify({ name: "yolo", version, target: platform.target, commit, runtimeArtifact: JSON.parse(readFileSync(join(real, "manifest.json"), "utf8")) }, null, 2)}\n`,
    );
    const hits = scanTree(work, cfg.secrets);
    if (hits.length)
      throw new Error(`secret scan failed for yolo:\n${hits.map(h => `${h.where}: ${h.rule}`).join("\n")}`);
    const dir = join(stageRoot(id), "files");
    mkdirSync(dir, { recursive: true });
    const ext = platform.archive ?? "tar.gz";
    const file = archiveName("yolo", version, commit, platform.target, ext);
    if (ext === "zip") await zipDir(work, join(dir, file));
    else await tar(["-czf", join(dir, file), "--owner=0", "--group=0", "--numeric-owner", "-C", work, "."]);
    return {
      component: "yolo",
      version,
      platform: platform.platform,
      target: platform.target,
      kind: "bun-compile",
      file,
      sha256: await sha256File(join(dir, file)),
      size: statSync(join(dir, file)).size,
      provides: artifact.provides,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Builds the archive of a factory binary on the host, next to the release, after the glibc and secret gates. */
async function stageFactoryBinary(
  cfg: DownloadsConfig,
  artifact: ArtifactConfig,
  platform: PlatformConfig,
  id: string,
  commit: string,
): Promise<PublishedFile> {
  const version = artifactVersion(artifact);
  const binary = `${cfg.factory.cargoTargetDir}/${platform.binary}`;
  // Audit, scan and archive on the factory; a split release host then receives the archive over ssh.
  const factory = factoryCfg(cfg);
  const split = factory !== cfg;
  if (split && !cfg.factory.pushTo)
    throw new Error("factory.pushTo is required when factory.target differs from host.target");
  const releaseFiles = `${cfg.host.root}/releases/${id}/files`;
  const filesDir = split ? `/tmp/aphrody-downloads-stage/${id}` : releaseFiles;
  const ext = platform.archive ?? "tar.gz";
  const file = archiveName(artifact.id, version, commit, platform.target, ext);
  const exe = basename(platform.binary!);
  const workspace = cfg.factory.workspace;
  await remote(factory, `test -x ${q(binary)} || test -f ${q(binary)}`);
  if (platform.glibcMax) {
    await remote(
      factory,
      `${q(cfg.host.bun)} ${q(`${workspace}/scripts/audit/elf-glibc-imports.ts`)} ${q(binary)} --max ${platform.glibcMax} >/dev/null`,
      300,
    );
  }
  // Secret scan of the binary on the host. Multi-line patterns (PEM private keys) cannot match inside one
  // grep line: the header line is looked up and its next line must be a 64 character base64 row. Embedded
  // header literals of PEM/SSH parsers are not secrets and do not have such a row.
  const linePatterns = cfg.secrets.contentPatterns.filter(p => !p.includes("\\n"));
  const grepArgs = linePatterns.map(p => `-e ${q(p)}`).join(" ");
  const found = await remote(
    factory,
    [
      `grep -aEoh ${grepArgs} ${q(binary)} | head -3 | cut -c1-24 || true`,
      `grep -a -A1 -E -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' ${q(binary)} | grep -aE '^[A-Za-z0-9+/]{64}$' | head -1 | cut -c1-8 || true`,
    ].join("\n"),
    900,
  );
  if (found.trim() !== "")
    throw new Error(`secret scan hit in ${binary} (first matches redacted to 24 chars): ${found.trim().slice(0, 200)}`);
  const releaseJson = JSON.stringify({
    name: artifact.id,
    version,
    target: platform.target,
    commit,
    provides: artifact.provides,
  });
  const license = `${workspace}/LICENSE`;
  const stageOut = await remote(
    factory,
    [
      "set -e",
      `mkdir -p ${q(filesDir)}`,
      `tmp=$(mktemp -d)`,
      `cp ${q(binary)} "$tmp/${exe}"`,
      `chmod 0755 "$tmp/${exe}"`,
      `printf '%s\\n' ${q(releaseJson)} > "$tmp/release.json"`,
      `[ ! -f ${q(license)} ] || cp ${q(license)} "$tmp/LICENSE"`,
      ext === "zip"
        ? `(cd "$tmp" && zip -q ${q(`${filesDir}/${file}`)} ./*)`
        : `tar -czf ${q(`${filesDir}/${file}`)} --owner=0 --group=0 --numeric-owner -C "$tmp" .`,
      `rm -rf "$tmp"`,
      `sha256sum ${q(`${filesDir}/${file}`)} | cut -d' ' -f1`,
      `stat -c %s ${q(`${filesDir}/${file}`)}`,
      ...(split
        ? [
            `rsync -a -e 'ssh -o BatchMode=yes' ${q(`${filesDir}/${file}`)} ${q(`${cfg.factory.pushTo}:${releaseFiles}/`)} >&2`,
            `rm -f ${q(`${filesDir}/${file}`)}`,
          ]
        : []),
    ].join("\n"),
    900,
  );
  const [sum, size] = stageOut.trim().split("\n").slice(-2);
  const info = { sha256: sum!, size: Number(size) };
  return {
    component: artifact.id,
    version,
    platform: platform.platform,
    target: platform.target,
    kind: "factory-binary",
    file,
    sha256: info.sha256,
    size: info.size,
    provides: artifact.provides,
  };
}

// ---------------------------------------------------------------------------------------------
// commands

function arg(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i > 0 ? Bun.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => Bun.argv.includes(`--${name}`);

async function revisionArg(): Promise<string> {
  const rev = arg("revision") ?? (await gitOut(root, "rev-parse", "HEAD"));
  if (!/^[0-9a-f]{40}$/.test(rev)) throw new Error("--revision must be a full 40 character sha");
  return rev;
}

async function plan(cfg: DownloadsConfig) {
  const commit = await revisionArg();
  console.log(`revision ${commit}`);
  for (const a of cfg.artifacts) {
    if (a.kind === "plugin") {
      console.log(`  ${a.id} ${pluginVersion(a)} (plugin, tar.gz + zip, from ${a.git!.path} ${a.git!.ref})`);
      continue;
    }
    for (const p of a.platforms ?? []) {
      console.log(
        p.enabled
          ? `  ${a.id} ${artifactVersion(a)} ${p.platform}: published${a.stage ? ` (local stage ${a.stage.script})` : ""}`
          : `  ${a.id} ${p.platform}: SKIPPED (${p.reason})`,
      );
    }
  }
  console.log(
    `host ${cfg.host.target}:${cfg.host.root}, service ${cfg.host.service}:${cfg.host.port}, url ${cfg.site.baseUrl}`,
  );
}

async function waitForJob(job: string): Promise<void> {
  for (;;) {
    const out = await run(buildFactory("status", "--job", job, "--tail", "5"));
    const status = JSON.parse(out.stdout) as {
      status: string;
      exitCode?: number;
      logs?: { stderr?: { text?: string } };
    };
    if (status.status === "succeeded" || (status.status === "completed" && status.exitCode === 0)) return;
    if (status.status === "failed") throw new Error(`factory job ${job} failed: ${status.logs?.stderr?.text ?? ""}`);
    await Bun.sleep(30_000);
  }
}

async function build(cfg: DownloadsConfig) {
  const commit = await revisionArg();
  await run(buildFactory("prepare", "--repo", cfg.factory.repo, "--revision", commit, "--apply"));
  for (const a of cfg.artifacts.filter(x => x.kind === "factory-binary")) {
    for (const p of (a.platforms ?? []).filter(x => x.enabled && x.cargo)) {
      // Job ids are idempotent: a failed job is replayed only under a new --attempt suffix.
      const attempt = arg("attempt");
      const job = `${cfg.factory.jobPrefix}-${a.id}-${p.platform}-${commit.slice(0, 9)}${attempt ? `-a${attempt}` : ""}`;
      console.log(`build ${job}`);
      await run(
        buildFactory(
          "run",
          "--repo",
          cfg.factory.repo,
          "--revision",
          commit,
          "--detach",
          "--job",
          job,
          "--",
          ...p.cargo!,
        ),
        {
          env: { APHRODY_FACTORY_INSTALL: "0" },
        },
      );
      await waitForJob(job);
    }
  }
}

async function release(cfg: DownloadsConfig) {
  const commit = await revisionArg();
  const id = arg("id") ?? releaseId(commit);
  if (!safeReleaseName(id)) throw new Error("invalid release ID");
  const stage = stageRoot(id);
  mkdirSync(join(stage, ".."), { recursive: true });
  mkdirSync(stage); // Reserve a new local tree; an existing release is immutable.
  const rel = `${cfg.host.root}/releases/${id}`;
  try {
    await remote(cfg, `mkdir -p ${q(`${cfg.host.root}/releases`)} && mkdir ${q(rel)}`);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  try {
    await releaseTree(cfg, commit, id);
  } catch (error) {
    // Remove only this newly reserved tree, and never the selected current release.
    await remote(
      cfg,
      `if [ "$(readlink -f ${q(`${cfg.host.root}/current`)})" != ${q(rel)} ]; then rm -rf ${q(rel)}; fi`,
    ).catch(() => undefined);
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

async function releaseTree(cfg: DownloadsConfig, commit: string, id: string) {
  const files: PublishedFile[] = [];
  const notes: string[] = [];
  const stage = stageRoot(id);
  // `--only a,b`: a release of the artifacts the factory already has, without building the others.
  const only = arg("only")
    ?.split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const unknown = only?.filter(name => !cfg.artifacts.some(a => a.id === name)) ?? [];
  if (unknown.length) throw new Error(`--only names unknown artifacts: ${unknown.join(", ")}`);
  mkdirSync(join(stage, "files"));
  await remote(cfg, `mkdir -p ${q(`${cfg.host.root}/releases/${id}/files`)}`);

  for (const a of cfg.artifacts) {
    if (only && !only.includes(a.id)) {
      notes.push(`${a.id}: not published in this release (not selected by --only)`);
      continue;
    }
    if (a.kind === "plugin") {
      files.push(...(await stagePlugin(a, id, commit)));
      continue;
    }
    for (const p of a.platforms ?? []) {
      if (!p.enabled) {
        notes.push(`${a.id} ${p.platform}: not published (${p.reason ?? "disabled"})`);
        continue;
      }
      if (a.kind === "factory-binary" && p.optional) {
        const present = await remote(
          factoryCfg(cfg),
          `test -f ${q(`${cfg.factory.cargoTargetDir}/${p.binary}`)} && echo yes || echo no`,
        );
        if (present.trim() !== "yes") {
          notes.push(`${a.id} ${p.platform}: not published (the factory has no build of it for this revision)`);
          continue;
        }
      }
      if (a.stage) files.push(...(await stageLocal(a, p, id, cfg)));
      else
        files.push(
          a.kind === "factory-binary"
            ? await stageFactoryBinary(cfg, a, p, id, commit)
            : await stageYolo(a, p, id, commit, cfg),
        );
    }
  }

  // plugin archives are scanned after extraction by `git archive` (tracked files only)
  for (const f of files.filter(x => x.kind === "plugin" && x.file.endsWith(".tar.gz"))) {
    const work = mkdtempSync(join(tmpdir(), "plugin-scan-"));
    try {
      await tar(["-xzf", join(stage, "files", f.file), "-C", work]);
      const hits = scanTree(work, cfg.secrets);
      if (hits.length)
        throw new Error(`secret scan failed for ${f.file}:\n${hits.map(h => `${h.where}: ${h.rule}`).join("\n")}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const remoteFiles = `${cfg.host.root}/releases/${id}/files`;
  for (const f of files) {
    const local = join(stage, "files", f.file);
    if (existsSync(local)) {
      console.log(`upload ${f.file} (${f.size} bytes)`);
      await put(cfg, local, `${remoteFiles}/${f.file}`);
    }
  }
  // integrity on the host: every file must hash to the value in the manifest
  for (const f of files) {
    const got = (await remote(cfg, `sha256sum ${q(`${remoteFiles}/${f.file}`)} | cut -d' ' -f1`, 600)).trim();
    if (got !== f.sha256) throw new Error(`host checksum mismatch for ${f.file}: ${got} != ${f.sha256}`);
  }

  const manifest = buildManifest({
    baseUrl: cfg.site.baseUrl,
    id,
    commit,
    files,
    notes,
  });
  await finalizeRelease(cfg, id, stage, manifest, files);
}

type ReleaseTransport = {
  remote: (cfg: DownloadsConfig, command: string, timeoutSecs?: number) => Promise<string>;
  put: (cfg: DownloadsConfig, local: string, dest: string) => Promise<void>;
};
const releaseTransport: ReleaseTransport = { remote, put };
const safeReleaseName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
const safePayloadName = (name: string): boolean => !!name && !/[\\/\0\r\n]/.test(name) && !name.startsWith(".");

/** Freeze source bytes before scanning/uploading so source edits cannot race publication. */
function stageAssets(cfg: DownloadsConfig, stage: string, sourceRoot = root): Record<string, string> {
  const hashes: Record<string, string> = {};
  const realRoot = realpathSync(sourceRoot);
  for (const [name, source] of Object.entries(cfg.assets)) {
    if (!safePayloadName(name) || ["latest.json", "manifest.json", "SHA256SUMS", "files"].includes(name))
      throw new Error(`invalid asset name: ${name}`);
    const path = realpathSync(join(sourceRoot, source));
    if (!path.startsWith(realRoot + sep) || !statSync(path).isFile())
      throw new Error(`asset source outside repository: ${source}`);
    const bytes = new Uint8Array(readFileSync(path));
    const hits = [
      ...scanName(name, cfg.secrets.deniedNames),
      ...scanName(source, cfg.secrets.deniedNames),
      ...scanBytes(name, bytes, cfg.secrets.contentPatterns),
    ];
    if (hits.length) throw new Error(`secret scan failed for ${name}`);
    writeFileSync(join(stage, name), bytes);
    hashes[name] = sha256Bytes(bytes);
  }
  return hashes;
}

/** Shared metadata upload, verification, atomic selection and declared retention. */
async function finalizeRelease(
  cfg: DownloadsConfig,
  id: string,
  stage: string,
  manifest: Record<string, unknown>,
  files: PublishedFile[],
  io = releaseTransport,
  assetHashes = stageAssets(cfg, stage),
  expectedCurrent?: string,
  recordLocalRelease = true,
) {
  const rel = `${cfg.host.root}/releases/${id}`;
  writeFileSync(join(stage, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(stage, "SHA256SUMS"), buildSums(files));
  for (const f of files) writeFileSync(join(stage, "files", `${f.file}.sha256`), `${f.sha256}  ${f.file}\n`);
  const small = ["latest.json", "SHA256SUMS", ...Object.keys(assetHashes)];
  for (const name of small) {
    const local = join(stage, name);
    await io.put(cfg, local, `${rel}/${name}`);
    const got = (await io.remote(cfg, `sha256sum ${q(`${rel}/${name}`)} | cut -d' ' -f1`, 600)).trim();
    if (got !== (await sha256File(local))) throw new Error(`host checksum mismatch for ${name}`);
  }
  for (const f of files) await io.put(cfg, join(stage, "files", `${f.file}.sha256`), `${rel}/files/${f.file}.sha256`);
  // All payloads and sidecars must agree before publishing this tree.
  await io.remote(
    cfg,
    [
      "set -e",
      `cd ${q(`${rel}/files`)}`,
      `sha256sum -c ${q(`${rel}/SHA256SUMS`)}`,
      ...files.map(f => `sha256sum -c ${q(`${f.file}.sha256`)}`),
    ].join("\n"),
    600,
  );
  await io.remote(
    cfg,
    [
      "set -e",
      `cd ${q(cfg.host.root)}`,
      "exec 9> .publish.lock",
      "flock -x 9",
      ...(expectedCurrent ? [`test "$(readlink -f current)" = ${q(expectedCurrent)}`] : []),
      `test -f ${q(`${rel}/latest.json`)}`,
      `ln -sfn ${q(`releases/${id}`)} current.new`,
      "mv -T current.new current",
      `ls -1dt releases/* | tail -n +${cfg.host.keepReleases + 1} | xargs -r rm -rf`,
    ].join("\n"),
  );
  console.log(`release ${id} published (current -> releases/${id})`);
  if (recordLocalRelease)
    writeFileSync(
      join(stage, "../last-release.json"),
      `${JSON.stringify({ id, commit: (manifest.release as { commit?: string }).commit, files }, null, 2)}\n`,
    );
}

interface SnapshotManifest extends Record<string, unknown> {
  release: { id: string; commit?: string; [key: string]: unknown };
  artifacts: Record<string, unknown>[];
  baseUrl: string;
}

export interface PrebuiltStage {
  directory: string;
  /** Full source commit of the qualified stage build, independently of the inherited binaries. */
  commit: string;
}

/** Adopt only configured, qualified stage outputs; never execute a build during a snapshot refresh. */
async function adoptPrebuiltStages(
  cfg: DownloadsConfig,
  inputs: PrebuiltStage[],
  stage: string,
): Promise<{ files: PublishedFile[]; artifacts: Record<string, unknown>[] }> {
  const files: PublishedFile[] = [];
  const artifacts: Record<string, unknown>[] = [];
  const groups = new Set<string>();
  const names = new Set<string>();
  for (const input of inputs) {
    if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new Error("invalid staged source commit");
    const directory = resolve(input.directory);
    if (!lstatSync(directory).isDirectory()) throw new Error("staged directory must be regular");
    let found = false;
    for (const artifact of cfg.artifacts.filter(item => item.stage)) {
      const manifestName = artifact.stage!.manifest;
      if (!safePayloadName(manifestName)) throw new Error("invalid staged manifest name");
      const manifestPath = join(directory, manifestName);
      if (!existsSync(manifestPath)) continue;
      found = true;
      const metadata = lstatSync(manifestPath);
      if (!metadata.isFile() || metadata.size > 1_048_576) throw new Error(`invalid staged manifest: ${manifestName}`);
      const bytes = new Uint8Array(readFileSync(manifestPath));
      if (scanBytes(manifestName, bytes, cfg.secrets.contentPatterns).length)
        throw new Error(`secret scan failed for ${manifestName}`);
      const entries: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(entries) || !entries.length) throw new Error("empty staged manifest");
      const platformGroups = new Set<string>();
      for (const entry of entries as StagedEntry[]) {
        const platform = artifact.platforms?.find(item => item.platform === entry?.platform && item.enabled !== false);
        if (
          !entry ||
          entry.name !== artifact.id ||
          !platform ||
          entry.target !== platform.target ||
          typeof entry.version !== "string" ||
          !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(entry.version) ||
          !(
            (artifact.kind === "desktop" && ["desktop", "update"].includes(entry.kind)) ||
            (artifact.kind === "kit" && entry.kind === "kit") ||
            (artifact.kind === "wasm" && entry.kind === "wasm" && entry.file?.endsWith(".tar.gz"))
          ) ||
          typeof entry.file !== "string" ||
          !safePayloadName(entry.file) ||
          names.has(entry.file) ||
          typeof entry.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(entry.sha256) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0
        )
          throw new Error(`invalid staged entry: ${JSON.stringify(entry)}`);
        const source = join(directory, entry.file);
        if (!lstatSync(source).isFile()) throw new Error(`staged payload must be regular: ${entry.file}`);
        const copied = join(stage, "files", entry.file);
        // Verify the staged copy itself so later source changes cannot alter the release bytes.
        copyFileSync(source, copied);
        if (statSync(copied).size !== entry.size || (await sha256File(copied)) !== entry.sha256)
          throw new Error(`staged size or checksum mismatch: ${entry.file}`);
        if (
          scanName(entry.file, cfg.secrets.deniedNames).length ||
          scanBytes(entry.file, new Uint8Array(readFileSync(copied)), cfg.secrets.contentPatterns).length
        )
          throw new Error(`secret scan failed for ${entry.file}`);
        names.add(entry.file);
        platformGroups.add(`${entry.name}/${entry.platform}`);
        const file: PublishedFile = {
          component: entry.name,
          version: entry.version,
          platform: entry.platform,
          target: entry.target,
          kind: entry.kind,
          file: entry.file,
          size: entry.size,
          sha256: entry.sha256,
        };
        files.push(file);
        artifacts.push({
          name: file.component,
          version: file.version,
          platform: file.platform,
          target: file.target,
          kind: file.kind,
          file: file.file,
          size: file.size,
          sha256: file.sha256,
          provenance: {
            revision: input.commit,
            builder: "staged",
            manifest: manifestName,
          },
        });
      }
      for (const group of platformGroups) {
        if (groups.has(group)) throw new Error(`duplicate staged component/platform: ${group}`);
        groups.add(group);
      }
    }
    if (!found) throw new Error(`no configured staged manifest in ${directory}`);
  }
  return { files, artifacts };
}

/** Preserve build provenance while pinning every inherited artifact to the new release. */
export function planAssetsSnapshot(
  source: SnapshotManifest,
  sums: string,
  id: string,
  assetCommit: string,
  secrets: DownloadsConfig["secrets"],
  now = new Date(),
): { manifest: SnapshotManifest; files: PublishedFile[] } {
  if (
    !safeReleaseName(id) ||
    !source.release ||
    !safeReleaseName(source.release.id) ||
    id === source.release.id ||
    typeof source.baseUrl !== "string" ||
    !Array.isArray(source.artifacts)
  )
    throw new Error("invalid release snapshot");
  if (scanBytes("latest.json", new TextEncoder().encode(JSON.stringify(source)), secrets.contentPatterns).length)
    throw new Error("secret scan failed for inherited manifest");
  const checksums = new Map<string, string>();
  for (const line of sums.trim().split("\n").filter(Boolean)) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
    if (!match || checksums.has(match[2]!)) throw new Error("invalid or duplicate SHA256SUMS entry");
    checksums.set(match[2]!, match[1]!);
  }
  const names = new Set<string>();
  const files = source.artifacts.map((artifact): PublishedFile => {
    const file = artifact.file ?? (typeof artifact.url === "string" ? basename(new URL(artifact.url).pathname) : "");
    if (
      typeof file !== "string" ||
      !safePayloadName(file) ||
      names.has(file) ||
      scanName(file, secrets.deniedNames).length ||
      checksums.get(file) !== artifact.sha256 ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      typeof artifact.size !== "number" ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 0 ||
      ![artifact.name, artifact.version, artifact.platform].every(value => typeof value === "string" && value.length)
    )
      throw new Error(`invalid or unchecked inherited artifact: ${String(file)}`);
    names.add(file);
    return {
      component: artifact.name as string,
      version: artifact.version as string,
      platform: artifact.platform as string,
      target: typeof artifact.target === "string" ? artifact.target : "",
      kind: typeof artifact.kind === "string" ? artifact.kind : "",
      file,
      sha256: artifact.sha256,
      size: artifact.size,
      ...(Array.isArray(artifact.provides) ? { provides: artifact.provides as string[] } : {}),
    };
  });
  if (checksums.size !== names.size) throw new Error("unlisted inherited checksum payload");
  return {
    files,
    manifest: {
      ...source,
      generatedAt: now.toISOString(),
      release: {
        ...source.release,
        id,
        assetsFrom: source.release.id,
        assetsCommit: assetCommit,
      },
      artifacts: source.artifacts.map((artifact, index) => ({
        ...artifact,
        file: files[index]!.file,
        url: `${source.baseUrl.replace(/\/$/, "")}/releases/${id}/files/${files[index]!.file}`,
      })),
    },
  };
}

/** Reuse only immutable artifact payloads; new mutable metadata is never hardlinked. */
export async function publishAssetsSnapshot(
  cfg: DownloadsConfig,
  options: {
    id: string;
    assetCommit: string;
    sourceRoot?: string;
    io?: ReleaseTransport;
    staged?: PrebuiltStage[];
  },
) {
  const io = options.io ?? releaseTransport;
  const sourceRoot = options.sourceRoot ?? root;
  if (!safeReleaseName(options.id)) throw new Error("invalid release ID");
  const current = (await io.remote(cfg, `readlink -f ${q(`${cfg.host.root}/current`)}`)).trim();
  const oldId = basename(current);
  if (!safeReleaseName(oldId) || current !== `${cfg.host.root}/releases/${oldId}`)
    throw new Error(`no current release (${current})`);
  await io.remote(
    cfg,
    [
      "set -e",
      ...["latest.json", "SHA256SUMS"].map(
        name =>
          `test -f ${q(`${current}/${name}`)} && test "$(readlink -f ${q(`${current}/${name}`)})" = ${q(`${current}/${name}`)}`,
      ),
    ].join("\n"),
  );
  const source = JSON.parse(await io.remote(cfg, `cat ${q(`${current}/latest.json`)}`)) as SnapshotManifest;
  if (source.release?.id !== oldId) throw new Error("current manifest release ID mismatch");
  const sums = await io.remote(cfg, `cat ${q(`${current}/SHA256SUMS`)}`);
  const { manifest, files: inherited } = planAssetsSnapshot(source, sums, options.id, options.assetCommit, cfg.secrets);
  const stage = join(sourceRoot, "dist/downloads", options.id);
  mkdirSync(join(sourceRoot, "dist/downloads"), { recursive: true });
  mkdirSync(stage); // never destroy an existing local snapshot
  mkdirSync(join(stage, "files"));
  const rel = `${cfg.host.root}/releases/${options.id}`;
  let reserved = false;
  try {
    const prebuilt = await adoptPrebuiltStages(cfg, options.staged ?? [], stage);
    const replaced = new Set(prebuilt.files.map(file => `${file.component}/${file.platform}`));
    const inheritedFiles = inherited.filter(file => !replaced.has(`${file.component}/${file.platform}`));
    const files = [...inheritedFiles, ...prebuilt.files];
    if (new Set(files.map(file => file.file)).size !== files.length)
      throw new Error("staged payload collides with inherited artifact");
    manifest.artifacts = [
      ...manifest.artifacts.filter(artifact => !replaced.has(`${artifact.name}/${artifact.platform}`)),
      ...prebuilt.artifacts.map(artifact => ({
        ...artifact,
        url: `${manifest.baseUrl.replace(/\/$/, "")}/releases/${options.id}/files/${artifact.file}`,
      })),
    ];
    const assetHashes = stageAssets(cfg, stage, sourceRoot);
    manifest.assetChecksums = assetHashes;
    // Reject aliases and linked payloads before reuse; mkdir reserves a genuinely new tree.
    await io.remote(
      cfg,
      [
        "set -e",
        `test "$(readlink -f ${q(`${cfg.host.root}/releases`)})" = ${q(`${cfg.host.root}/releases`)}`,
        `mkdir ${q(rel)}`,
      ].join("\n"),
    );
    reserved = true;
    await io.remote(cfg, `mkdir ${q(`${rel}/files`)}`);
    for (const f of inheritedFiles) {
      const path = `${current}/files/${f.file}`;
      await io.remote(
        cfg,
        [
          "set -e",
          `test -f ${q(path)}`,
          `test ! -L ${q(path)}`,
          `test "$(readlink -f ${q(path)})" = ${q(path)}`,
          `test "$(stat -c %s ${q(path)})" = ${q(String(f.size))}`,
          `test "$(sha256sum ${q(path)} | cut -d' ' -f1)" = ${q(f.sha256)}`,
          `ln ${q(path)} ${q(`${rel}/files/${f.file}`)}`,
        ].join("\n"),
        600,
      );
    }
    for (const file of prebuilt.files) await io.put(cfg, join(stage, "files", file.file), `${rel}/files/${file.file}`);
    await finalizeRelease(cfg, options.id, stage, manifest, files, io, assetHashes, current, false);
    return manifest;
  } catch (error) {
    if (reserved)
      await io
        .remote(
          cfg,
          [
            "set -e",
            `if [ "$(readlink -f ${q(`${cfg.host.root}/current`)})" != ${q(rel)} ]; then rm -rf ${q(rel)}; fi`,
          ].join("\n"),
        )
        .catch(() => undefined);
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

/** Publish new installers with current artifact payloads, without rebuilding or uploading binaries. */
async function assets(cfg: DownloadsConfig) {
  const assetCommit = await gitOut(root, "rev-parse", "HEAD");
  const directories: string[] = [];
  for (let index = 3; index < Bun.argv.length; index += 1) {
    if (Bun.argv[index] !== "--staged") continue;
    const directory = Bun.argv[++index];
    if (!directory || directory.startsWith("--")) throw new Error("--staged requires a directory");
    directories.push(directory);
  }
  const stagedCommit = arg("staged-revision") ?? "";
  if (directories.length && !/^[0-9a-f]{40}$/.test(stagedCommit))
    throw new Error("--staged requires --staged-revision with a full source commit");
  await publishAssetsSnapshot(cfg, {
    assetCommit,
    id: arg("id") ?? `${releaseId(assetCommit)}-assets-${randomUUID().slice(0, 8)}`,
    staged: directories.map(directory => ({
      directory,
      commit: stagedCommit,
    })),
  });
}

async function ghJson(
  route: string,
  method = "GET",
  body?: unknown,
  apply = false,
): Promise<{ status: number; body: any }> {
  const args = ["aphrody", "git", "api", route, "--method", method];
  let bodyFile: string | undefined;
  if (body !== undefined) {
    bodyFile = join(tmpdir(), `gh-body-${process.pid}-${Date.now()}.json`);
    writeFileSync(bodyFile, JSON.stringify(body));
    args.push("--body", `@${bodyFile}`);
  }
  if (apply) args.push("--apply");
  try {
    const out = await run(args, { allowFail: true });
    try {
      return JSON.parse(out.stdout);
    } catch {
      // errors are printed as text by the CLI: keep the HTTP status
      const status = Number(/HTTP (\d{3})/.exec(out.stderr + out.stdout)?.[1] ?? 0);
      return {
        status,
        body: { message: (out.stderr + out.stdout).slice(0, 300) },
      };
    }
  } finally {
    if (bodyFile) rmSync(bodyFile, { force: true });
  }
}

async function github(cfg: DownloadsConfig) {
  const last = JSON.parse(readFileSync(join(root, "dist/downloads/last-release.json"), "utf8")) as {
    id: string;
    commit: string;
    files: PublishedFile[];
  };
  const id = arg("release") ?? last.id;
  const stage = stageRoot(id);
  const created: string[] = [];
  for (const target of cfg.github.releases) {
    const repo = target.repository;
    const meta = await ghJson(`/repos/${repo}`);
    if (meta.status !== 200) throw new Error(`repository ${repo} is not reachable: HTTP ${meta.status}`);
    // never create a repository, never change visibility: only releases on an existing one
    const sourceCommit = (await ghJson(`/repos/${repo}/commits/${meta.body.default_branch}`)).body.sha as string;
    const tag = `${cfg.github.tagPrefix}${id}`;
    const existing = await ghJson(`/repos/${repo}/releases/tags/${tag}`);
    if (existing.status !== 200) {
      const sha = repo === "aphrody-labs/aphrody" ? last.commit : sourceCommit;
      const made = await ghJson(
        `/repos/${repo}/releases`,
        "POST",
        {
          tag_name: tag,
          target_commitish: sha,
          name: `Downloads ${id}`,
          body: `Binaries and archives of release ${id}. SHA-256 sums are in SHA256SUMS; the public download path is ${cfg.site.baseUrl} (assets of a private repository need authentication).`,
          draft: false,
          prerelease: false,
          make_latest: "false",
        },
        true,
      );
      if (made.status !== 201)
        throw new Error(
          `release creation failed on ${repo}: HTTP ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`,
        );
    }
    const names = [
      ...last.files.filter(f => target.artifacts.includes(f.component)).map(f => join("files", f.file)),
      ...target.extra,
    ];
    if (target.repository !== "aphrody-labs/aphrody" && target.extra.includes("SHA256SUMS")) {
      const subset = last.files.filter(f => target.artifacts.includes(f.component));
      writeFileSync(join(stage, `SHA256SUMS.${repo.split("/")[1]}`), buildSums(subset));
    }
    for (const name of names) {
      const path =
        name === "SHA256SUMS" && repo !== "aphrody-labs/aphrody"
          ? join(stage, `SHA256SUMS.${repo.split("/")[1]}`)
          : join(stage, name);
      if (!existsSync(path) && name.startsWith("files/")) {
        // archives built on the host are fetched back from the public site and checked against the manifest
        const wanted = last.files.find(f => `files/${f.file}` === name)!;
        mkdirSync(join(stage, "files"), { recursive: true });
        await Bun.write(path, await fetch(`${cfg.site.baseUrl}/${name}`));
        if ((await sha256File(path)) !== wanted.sha256) throw new Error(`checksum mismatch fetching ${name}`);
      }
      if (!existsSync(path)) continue;
      const assetName = name === "SHA256SUMS" ? "SHA256SUMS" : basename(name);
      console.log(`  ${repo} ${tag}: ${assetName}`);
      await run(["gh", "release", "upload", tag, `${path}#${assetName}`, "--repo", repo, "--clobber"]);
    }
    created.push(`https://github.com/${repo}/releases/tag/${tag} (${meta.body.private ? "private" : "public"})`);
  }
  console.log(created.join("\n"));
}

/** Sends MCP `initialize` on stdin and reads the JSON-RPC reply from stdout. */
export async function mcpHandshake(exe: string): Promise<string> {
  const proc = Bun.spawn([exe], {
    windowsHide: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-downloads", version: "1" } } })}\n`,
  );
  proc.stdin.flush();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const line = buffer.split("\n").find(l => l.includes('"jsonrpc"'));
      if (line) {
        const reply = JSON.parse(line) as {
          result?: {
            protocolVersion?: string;
            serverInfo?: { name: string; version: string };
          };
        };
        const info = reply.result?.serverInfo;
        return info ? `ok ${info.name} ${info.version} (protocol ${reply.result?.protocolVersion})` : "no serverInfo";
      }
    }
    return "timeout";
  } finally {
    proc.kill();
  }
}

async function verify(cfg: DownloadsConfig) {
  const base = arg("url") ?? cfg.site.baseUrl;
  const manifest = (await (await fetch(`${base}/latest.json`)).json()) as {
    release: { id: string };
    artifacts: {
      name: string;
      platform: string;
      url: string;
      sha256: string;
      size: number;
    }[];
  };
  const work = mkdtempSync(join(tmpdir(), "verify-downloads-"));
  const wanted = process.platform === "win32" ? "windows-x86_64" : "linux-x86_64";
  let failures = 0;
  for (const a of manifest.artifacts) {
    const response = await fetch(a.url);
    if (!response.ok) {
      console.log(`FAIL ${a.url} HTTP ${response.status}`);
      failures++;
      continue;
    }
    const dest = join(work, basename(a.url));
    await Bun.write(dest, response);
    const sum = await sha256File(dest);
    const ok = sum === a.sha256 && statSync(dest).size === a.size;
    console.log(`${ok ? "OK  " : "FAIL"} ${a.name} ${a.platform} ${a.url} sha256=${sum.slice(0, 16)}...`);
    if (!ok) failures++;
    if (ok && a.platform === wanted && (a.name === "aphrody" || a.name === "yolo")) {
      const dir = join(work, a.name);
      mkdirSync(dir);
      await run(["tar", "-xzf", dest, "-C", dir]);
      const exe = a.name === "yolo" ? join(dir, "bin/yolo") : join(dir, "aphrody");
      console.log(
        `     ${a.name} --version: ${(await run([exe, "--version"], { allowFail: true })).stdout.trim().split("\n")[0]}`,
      );
      if (a.name === "aphrody") {
        // the MCP server is the same binary under its former name: initialize handshake over stdio
        symlinkSync(exe, join(dir, "aphrody-mcp"));
        const handshake = await mcpHandshake(join(dir, "aphrody-mcp"));
        console.log(`     aphrody-mcp handshake: ${handshake}`);
        if (!handshake.startsWith("ok")) failures++;
      }
    }
  }
  rmSync(work, { recursive: true, force: true });
  if (failures) throw new Error(`${failures} verification failure(s)`);
}

export function downloadsHostPlan(cfg: DownloadsConfig) {
  const catalog = JSON.parse(readFileSync(join(root, "infra/config/service-catalog.json"), "utf8")) as {
    services: {
      id: string;
      host?: string;
      unit?: string;
      port?: number;
      releaseRoot?: string;
    }[];
  };
  const service = catalog.services.find(item => item.id === cfg.host.service);
  if (
    !service ||
    service.host !== cfg.host.target ||
    service.unit !== `${cfg.host.service}.service` ||
    service.port !== cfg.host.port ||
    service.releaseRoot !== `${cfg.host.root}/releases` ||
    !/^[a-zA-Z0-9_-]+$/.test(cfg.host.service) ||
    !/^[a-z0-9.-]+$/.test(cfg.site.certName) ||
    !cfg.site.hosts.length ||
    cfg.site.hosts.some(host => !/^[a-z0-9.-]+$/.test(host))
  )
    throw new Error("downloads host does not match the declared native service catalog");
  const rootDir = cfg.host.root;
  const certDir = `/etc/letsencrypt/live/${cfg.site.certName}`;
  const certificate = `${certDir}/fullchain.pem`;
  const preflight = [
    "set -e",
    `test "$(systemctl show --property=FragmentPath --value ${q(service.unit!)})" = ${q(`/etc/systemd/system/${service.unit}`)}`,
    `test -x ${q(cfg.host.bun)}`,
    `sudo test -s ${q(certificate)}`,
    ...cfg.site.hosts.map(host => `sudo openssl x509 -in ${q(certificate)} -noout -checkend 0 -checkhost ${q(host)}`),
    "sudo nginx -t",
  ].join("\n");
  const setup = `sudo install -d -o ubuntu -g ubuntu ${q(rootDir)} ${q(`${rootDir}/releases`)} ${q(`${rootDir}/app`)}`;
  const activate = [
    "set -e",
    `sudo systemctl restart ${q(service.unit!)}`,
    `systemctl is-active --quiet ${q(service.unit!)}`,
    `curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 3 http://127.0.0.1:${cfg.host.port}/health >/dev/null`,
    "sudo nginx -t && sudo systemctl reload nginx",
  ].join("\n");
  const steps = [
    `target ${cfg.host.target}: preflight cataloged ${service.unit}, native nginx and valid ${cfg.site.certName} certificate`,
    `create ${rootDir}/{releases,app} owned by ubuntu`,
    `upload packages/product/src/downloads/server.ts -> ${rootDir}/app/server.ts`,
    `restart ${service.unit}; require loopback /health; native nginx -t/reload`,
  ];
  return { preflight, setup, activate, steps };
}

export async function hostCommands(cfg: DownloadsConfig, apply: boolean, io = releaseTransport) {
  const hostPlan = downloadsHostPlan(cfg);
  const rootDir = cfg.host.root;
  console.log(hostPlan.steps.map(s => `- ${s}`).join("\n"));
  if (!apply) {
    console.log("plan only: pass --apply to execute");
    return;
  }
  await io.remote(cfg, hostPlan.preflight);
  await io.remote(cfg, hostPlan.setup);
  await io.put(cfg, join(root, "packages/product/src/downloads/server.ts"), `${rootDir}/app/server.ts`);
  await io.remote(cfg, hostPlan.activate);
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "plan";
  const cfg = loadConfig();
  switch (command) {
    case "plan":
      await plan(cfg);
      break;
    case "build":
      await build(cfg);
      break;
    case "release":
      await release(cfg);
      break;
    case "assets":
      await assets(cfg);
      break;
    case "github":
      await github(cfg);
      break;
    case "verify":
      await verify(cfg);
      break;
    case "host-plan":
      await hostCommands(cfg, false);
      break;
    case "host-apply":
      await hostCommands(cfg, flag("apply"));
      break;
    default:
      console.error(
        "usage: publish-downloads.ts plan|build|release|assets|github|verify|host-plan|host-apply [--revision <sha>] [--id <release>] [--only <id,...>] [--release <id>] [--staged <dir> --staged-revision <sha>] [--apply]",
      );
      process.exit(2);
  }
}
