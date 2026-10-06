import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import pkg from "../../package.json";

export const VERSION: string = pkg.version;
export const UPDATE_BASE_URL = "https://creator.aphrody.com";

/** Identity of a kit built on this engine (creator-kit by default; omar-kit passes its own). */
export interface AppIdentity {
  /** Folder name under LOCALAPPDATA / XDG_CACHE_HOME that holds the update state. */
  name: string;
  version: string;
  /** Environment variable that disables the background check. */
  disableEnv: string;
  /** Sub-command spawned (detached, `--quiet`) to download an update. */
  updateCommand: string;
}

export const CREATOR_APP: AppIdentity = {
  name: "creator-kit",
  version: VERSION,
  disableEnv: "CREATOR_KIT_NO_UPDATE",
  updateCommand: "self-update",
};

export interface ReleaseArtifact {
  id: string;
  kind: "pack" | "update";
  format: "zip" | "tar.gz";
  platform: string;
  file: string;
  url: string;
  sha256: string;
  size: number;
}

export interface Release {
  schemaVersion: number;
  name: string;
  version: string;
  releasedAt: string;
  artifacts: ReleaseArtifact[];
  notes?: string[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Numeric semver comparison (prerelease tags are ignored). Returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function currentPlatform(): string {
  const os = process.platform === "win32" ? "windows" : process.platform;
  return `${os}-${process.arch === "arm64" ? "arm64" : "x64"}`;
}

/** True for a `bun build --compile` binary (the only form that can replace itself). */
export function isCompiled(execPath = process.execPath): boolean {
  const name = execPath.split(/[\\/]/).pop() ?? "";
  return !/^bun(\.exe)?$/i.test(name);
}

export async function fetchLatest(
  baseUrl = UPDATE_BASE_URL,
  fetchImpl: Fetch = fetch,
  timeoutMs = 4000,
): Promise<Release> {
  const res = await fetchImpl(`${baseUrl}/latest.json`, {
    headers: { accept: "application/json", "user-agent": `creator-kit/${VERSION}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${baseUrl}/latest.json`);
  const release = (await res.json()) as Release;
  if (release.schemaVersion !== 1 || !release.version || !Array.isArray(release.artifacts)) {
    throw new Error("latest.json invalide");
  }
  return release;
}

export function pickUpdate(
  release: Release,
  platform = currentPlatform(),
): ReleaseArtifact | undefined {
  return release.artifacts.find((a) => a.kind === "update" && a.platform === platform);
}

export async function downloadVerified(
  artifact: ReleaseArtifact,
  dest: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(artifact.url, {
    headers: { "user-agent": `creator-kit/${VERSION}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${artifact.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== artifact.sha256.toLowerCase())
    throw new Error(`SHA-256 invalide pour ${artifact.file}`);
  if (bytes.byteLength !== artifact.size) throw new Error(`taille invalide pour ${artifact.file}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
}

/** Extract a gzip-compressed ustar archive (regular files and folders only) into `dest`, without any external tool. */
export async function extractTarGz(archive: string, dest: string): Promise<void> {
  const data = Bun.gunzipSync(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  const decoder = new TextDecoder();
  const field = (start: number, length: number) =>
    decoder.decode(data.subarray(start, start + length)).replace(/\0.*$/s, "");
  let offset = 0;
  while (offset + 512 <= data.length) {
    if (data[offset] === 0) break;
    const prefix = field(offset + 345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(offset, 100);
    const size = Number.parseInt(field(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(data[offset + 156] || 48);
    offset += 512;
    const clean = name.replace(/^\.\//, "").replace(/\/$/, "");
    if (clean === "" || clean === ".") {
      offset += Math.ceil(size / 512) * 512;
      continue;
    }
    if (clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split(/[\\/]/).includes("..")) {
      throw new Error(`entrée refusée : ${name}`);
    }
    const target = join(dest, clean);
    if (type === "5") await mkdir(target, { recursive: true });
    else if (type === "0" || type === "\0") {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

/**
 * Extract a verified `tar.gz` into a staging folder, then swap it in: the running executable is renamed to
 * `<exe>.old` (allowed on Windows even while it runs), other entries replace the old ones. Nothing is deleted
 * before the new files are fully extracted.
 */
export async function applyPack(
  archive: string,
  installDir: string,
  exeName: string,
): Promise<void> {
  const staging = join(installDir, `.update-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    await extractTarGz(archive, staging);
    const entries = await readdir(staging);
    if (!entries.includes(exeName)) throw new Error(`${exeName} absent de l'archive`);
    for (const entry of entries) {
      const target = join(installDir, entry);
      if (entry === exeName) {
        await rm(`${target}.old`, { force: true });
        await rename(target, `${target}.old`).catch(() => undefined);
      } else {
        await rm(target, { recursive: true, force: true });
      }
      await rename(join(staging, entry), target);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function stateFile(
  env: Record<string, string | undefined> = process.env,
  app: AppIdentity = CREATOR_APP,
): string {
  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), ".cache");
  return join(base, app.name, "update.json");
}

interface State {
  lastCheck?: number;
  latest?: string;
}

async function readState(file: string): Promise<State> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as State;
  } catch {
    return {};
  }
}

async function writeState(file: string, state: State): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state));
}

export interface UpdateResult {
  status: "up-to-date" | "available" | "updated" | "skipped";
  latest?: string;
  detail?: string;
}

export interface UpdateOptions {
  checkOnly?: boolean;
  baseUrl?: string;
  fetchImpl?: Fetch;
  execPath?: string;
  platform?: string;
  version?: string;
  statePath?: string;
}

/**
 * Install the update described by an already fetched `release` when it is newer than `opts.version`.
 * `checkOnly` never modifies anything. Kits whose manifest has another shape convert it to a `Release` first.
 */
export async function updateFromRelease(
  release: Release,
  opts: UpdateOptions = {},
): Promise<UpdateResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const state = opts.statePath ?? stateFile();
  await writeState(state, { lastCheck: Date.now(), latest: release.version });
  if (compareVersions(release.version, opts.version ?? VERSION) <= 0)
    return { status: "up-to-date", latest: release.version };
  if (opts.checkOnly) return { status: "available", latest: release.version };
  const execPath = opts.execPath ?? process.execPath;
  if (!isCompiled(execPath)) {
    return {
      status: "skipped",
      latest: release.version,
      detail: "installation depuis les sources : fais un git pull",
    };
  }
  const artifact = pickUpdate(release, opts.platform);
  if (!artifact)
    return {
      status: "skipped",
      latest: release.version,
      detail: "pas de paquet pour cette plateforme",
    };
  const installDir = dirname(execPath);
  const archive = join(installDir, `.update-${release.version}.tar.gz`);
  try {
    await downloadVerified(artifact, archive, fetchImpl);
    await applyPack(archive, installDir, basename(execPath));
  } finally {
    await rm(archive, { force: true });
  }
  return { status: "updated", latest: release.version };
}

/** Download and install the newest release when there is one. `checkOnly` never modifies anything. */
export async function updateNow(opts: UpdateOptions): Promise<UpdateResult> {
  const release = await fetchLatest(opts.baseUrl, opts.fetchImpl ?? fetch, 10_000);
  return updateFromRelease(release, opts);
}

/** Remove the previous executable left by a swap. */
export async function cleanupOld(execPath = process.execPath): Promise<void> {
  await rm(`${execPath}.old`, { force: true }).catch(() => undefined);
}

/**
 * Called at every start of a compiled executable: at most one check per 12 h, never blocking. When a newer
 * version exists, a detached `<updateCommand> --quiet` downloads it; it takes effect at the next launch.
 */
export async function autoUpdateInBackground(
  env: Record<string, string | undefined> = process.env,
  app: AppIdentity = CREATOR_APP,
): Promise<string | undefined> {
  if (env[app.disableEnv] || !isCompiled()) return undefined;
  await cleanupOld();
  const file = stateFile(env, app);
  const state = await readState(file);
  if (
    state.latest &&
    compareVersions(state.latest, app.version) > 0 &&
    Date.now() - (state.lastCheck ?? 0) < 12 * 3_600_000
  ) {
    return `Mise à jour ${state.latest} en cours d'installation en arrière-plan (active au prochain lancement).`;
  }
  if (Date.now() - (state.lastCheck ?? 0) < 12 * 3_600_000) return undefined;
  const child = Bun.spawn([process.execPath, app.updateCommand, "--quiet"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...env, [app.disableEnv]: "1" },
  });
  child.unref();
  await writeState(file, { ...state, lastCheck: Date.now() });
  return undefined;
}
