import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  name: "Aphrody/Setup",
  version: VERSION,
  disableEnv: "CREATOR_KIT_NO_UPDATE",
  updateCommand: "mise-a-jour",
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

const parseVersion = (v: string) =>
  v
    .split("-")[0]!
    .split(".")
    .map(n => Number.parseInt(n, 10) || 0);

/** Numeric semver comparison (prerelease tags are ignored). Returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
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
  return !/^(?:bun|yolo|vu)(\.exe)?$/i.test(name);
}

export async function fetchLatest(
  baseUrl = UPDATE_BASE_URL,
  fetchImpl: Fetch = fetch,
  timeoutMs = 4000,
): Promise<Release> {
  const res = await fetchImpl(`${baseUrl}/latest.json`, {
    headers: {
      accept: "application/json",
      "user-agent": `creator-kit/${VERSION}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${baseUrl}/latest.json`);
  const release = (await res.json()) as Release;
  if (release.schemaVersion !== 1 || !release.version || !Array.isArray(release.artifacts)) {
    throw new Error("latest.json invalide");
  }
  return release;
}

export function pickUpdate(release: Release, platform = currentPlatform()): ReleaseArtifact | undefined {
  return release.artifacts.find(a => a.kind === "update" && a.platform === platform);
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
  const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (sha !== artifact.sha256.toLowerCase()) throw new Error(`SHA-256 invalide pour ${artifact.file}`);
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
  const entries: {
    name: string;
    size: number;
    type: string;
    offset: number;
  }[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (offset + 512 <= data.length) {
    if (data.subarray(offset, offset + 512).every(byte => byte === 0)) break;
    const prefix = field(offset + 345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(offset, 100);
    const sizeField = field(offset + 124, 12).trim();
    const size = /^[0-7]+$/.test(sizeField) ? Number.parseInt(sizeField, 8) : Number.NaN;
    const type = String.fromCharCode(data[offset + 156] || 48);
    const checksum = Number.parseInt(field(offset + 148, 8).trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : data[offset + i]!;
    if (checksum !== sum || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > data.length)
      throw new Error(`archive tronquée ou en-tête invalide : ${name}`);
    offset += 512;
    const clean = name.replace(/^\.\//, "").replace(/\/$/, "");
    if (!["0", "\0", "5"].includes(type)) throw new Error(`type d'entrée refusé : ${name}`);
    if (clean !== "" && clean !== ".") {
      if (
        clean.startsWith("/") ||
        clean.includes("\\") ||
        clean.includes(":") ||
        [...clean].some(char => char.charCodeAt(0) < 32) ||
        /[<>"|?*]/.test(clean) ||
        clean.split("/").some(part => part === ".." || part === "" || part === ".") ||
        clean
          .split("/")
          .some(part => /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) ||
        seen.has(clean.toLowerCase())
      )
        throw new Error(`entrée refusée : ${name}`);
      seen.add(clean.toLowerCase());
      entries.push({ name: clean, size, type, offset });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (offset + 1024 > data.length || !data.subarray(offset).every(byte => byte === 0))
    throw new Error("fin d'archive invalide");
  // Validate every header before the first write, then reject pre-existing symlink parents.
  for (const entry of entries) {
    let parent = dest;
    for (const part of ["", ...entry.name.split("/")]) {
      parent = part ? join(parent, part) : parent;
      // oxlint-disable-next-line no-await-in-loop -- contrôle séquentiel de la chaîne des parents : arrêt au premier lien symbolique, ordre déterministe
      const stat = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (stat?.isSymbolicLink()) throw new Error(`lien refusé : ${parent}`);
    }
    const target = join(dest, entry.name);
    // oxlint-disable-next-line no-await-in-loop -- écritures séquentielles dans l'ordre de l'archive : un chemin peut être répété (la dernière entrée gagne) et les parents doivent exister
    if (entry.type === "5") await mkdir(target, { recursive: true });
    else {
      // oxlint-disable-next-line no-await-in-loop -- écriture séquentielle (même raison : ordre de l'archive, parents créés avant fichiers)
      await mkdir(dirname(target), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- écriture séquentielle (même raison : ordre de l'archive)
      await writeFile(target, data.subarray(entry.offset, entry.offset + entry.size));
    }
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
  operations: { rename?: typeof rename } = {},
): Promise<void> {
  const move = operations.rename ?? rename;
  await mkdir(installDir, { recursive: true });
  if ((await lstat(installDir)).isSymbolicLink()) throw new Error("dossier d’installation lié refusé");
  const staging = await mkdtemp(join(dirname(installDir), ".update-"));
  const backup = await mkdtemp(join(dirname(installDir), ".rollback-"));
  const moved: string[] = [];
  const promoted: string[] = [];
  let preserveBackup = false;
  try {
    await extractTarGz(archive, staging);
    const entries = await readdir(staging);
    if (!entries.includes(exeName) || !(await lstat(join(staging, exeName))).isFile())
      throw new Error(`${exeName} absent de l'archive`);
    try {
      for (const entry of entries) {
        const target = join(installDir, entry);
        try {
          // oxlint-disable-next-line no-await-in-loop -- bascule séquentielle : chaque déplacement enregistré dans moved/promoted doit permettre une annulation exacte
          await move(target, join(backup, entry));
          moved.push(entry);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        // oxlint-disable-next-line no-await-in-loop -- bascule séquentielle (même raison : état de rollback suivi entrée par entrée)
        await move(join(staging, entry), target);
        promoted.push(entry);
      }
    } catch (error) {
      try {
        for (const entry of promoted.toReversed())
          // oxlint-disable-next-line no-await-in-loop -- annulation séquentielle dans l'ordre inverse de la bascule
          await rm(join(installDir, entry), { recursive: true, force: true });
        for (const entry of moved.toReversed())
          // oxlint-disable-next-line no-await-in-loop -- restauration séquentielle dans l'ordre inverse de la bascule
          await move(join(backup, entry), join(installDir, entry));
      } catch (rollbackError) {
        preserveBackup = true;
        throw new AggregateError(
          [error, rollbackError],
          `restauration incomplète : sauvegarde conservée dans ${backup}`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
    // Keep the running executable's previous generation until the next launch (Windows semantics).
    if (moved.includes(exeName)) {
      try {
        await rm(join(installDir, `${exeName}.old`), { force: true });
        await move(join(backup, exeName), join(installDir, `${exeName}.old`));
      } catch {
        // Activation succeeded; Windows may hold the previous generation open.
        // Retain its backup instead of turning cleanup into a failed installation.
        preserveBackup = true;
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (!preserveBackup) await rm(backup, { recursive: true, force: true });
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
export async function updateFromRelease(release: Release, opts: UpdateOptions = {}): Promise<UpdateResult> {
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
    windowsHide: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: { ...env, [app.disableEnv]: "1" },
  });
  child.unref();
  await writeState(file, { ...state, lastCheck: Date.now() });
  return undefined;
}
