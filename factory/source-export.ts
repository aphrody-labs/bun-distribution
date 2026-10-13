import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  readlink,
  realpath,
  rename,
  statfs,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { readLock, type Source, type SourceLock } from "../src/distribution.ts";

/** Upper bounds, measured by the source owner before acquisition. Entries include directories and symlinks. */
export interface SourceEstimate {
  archiveBytes: number;
  expandedBytes: number;
  entries: number;
}

export interface StorageInventory {
  path: string;
  device: string;
  freeBytes: number;
  freeInodes: number | null;
  blockBytes: number;
  observedAt: string;
}

export interface LfsRequest {
  repository: string;
  revision: string;
  path: string;
  oid: string;
  size: number;
  signal: AbortSignal;
}

/** The owner supplies a stream, never a path into credentials, sessions, databases or model stores. */
export type LfsOwner = (request: LfsRequest) => Promise<ReadableStream<Uint8Array> | undefined>;

export interface SourceExportOptions {
  lock?: SourceLock;
  cache?: string;
  /** Keys are repository@revision, source id, or repository, in that order. No checkout is inferred. */
  checkouts?: Record<string, string>;
  /** Read-only existing Git object repositories, including bare metadata; never cloned or modified. */
  repositories?: Record<string, string>;
  estimates: Record<string, SourceEstimate>;
  protectedRoots?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  reserveBytes?: number;
  reserveInodes?: number;
  lfsOwner?: LfsOwner;
  /** Explicit credentials owner for api.github.com and codeload.github.com. Headers are never persisted. */
  githubHeaders?: (repository: string, host: string, signal: AbortSignal) => Promise<HeadersInit | undefined>;
}

type Digest = { sha256: string; bytes: number };
type TreeEntry = { path: string; mode: string; type: string; sha: string; size?: number };
type Coverage = { files: Map<string, TreeEntry>; directories: Set<string>; seen: Set<string> };
type Acquisition = Digest & {
  key: string;
  repository: string;
  revision: string;
  archive: string;
  encoding: "tar" | "gzip";
  strip: number;
  coverage: "local-git-all-tracked" | "github-git-tree";
};
type RepositoryReceipt = Source & {
  archiveSHA256: string;
  archiveBytes: number;
  entries: number;
  acquisition: string;
  coverage: Acquisition["coverage"];
};
type Issue = { code: string; source?: string; path?: string; oid?: string };

export interface SourceExportReceipt {
  schemaVersion: 1;
  kind: "bun-os-sources";
  complete: boolean;
  status: "running" | "complete" | "incomplete";
  startedAt: string;
  finishedAt?: string;
  repositories: RepositoryReceipt[];
  acquisitions: Omit<Acquisition, "archive">[];
  storage: StorageInventory[];
  estimates: Record<string, SourceEstimate>;
  materializedLfs: { repository: string; revision: string; path: string; oid: string; bytes: number }[];
  issues: Issue[];
  expectedRepositories: number;
  integrityComplete: boolean;
  files: number;
  bytes: number;
  lfsPointers: string[];
  treeSHA256?: string;
}

class ExportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new ExportError(code);
}
const keyOf = (source: Source) => `${source.repository}@${source.revision}`;
const now = () => new Date().toISOString();
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function inside(root: string, path: string, allowRoot = false): string {
  const result = resolve(root, path);
  const rel = relative(root, result);
  if ((!allowRoot && !rel) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("path-outside-root");
  return result;
}

function sourcePath(path: string): string {
  const parts = path.replace(/\/$/, "").split("/");
  if (
    !path ||
    path.includes("\\") ||
    path.includes(":") ||
    parts.some(
      part =>
        !part ||
        part === "." ||
        part === ".." ||
        [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
    ) ||
    parts.some(part => part.toLowerCase() === ".git")
  )
    fail("unsafe-source-path");
  if (
    process.platform === "win32" &&
    parts.some(part => /[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
  )
    fail("source-path-not-representable-on-windows");
  return parts.join("/");
}

async function safeDirectory(path: string, create = false, mode = 0o700) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute) await safeDirectory(parent, create, mode);
  try {
    const stat = await lstat(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("directory-is-symlink-or-special-file");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT" || !create) throw error;
    await mkdir(absolute, { mode });
  }
}

function protect(path: string, roots: string[]) {
  const absolute = resolve(path);
  if ([...absolute].some(char => char.charCodeAt(0) < 32)) fail("unsafe-local-path");
  const homes = [Bun.env.USERPROFILE, Bun.env.HOME].filter((value): value is string => Boolean(value));
  const isolated = homes.flatMap(home => [".aphrody", ".codex", ".claude"].map(name => join(home, name)));
  if (Bun.env.APHRODY_HOME) isolated.push(Bun.env.APHRODY_HOME);
  for (const root of [...isolated, ...roots]) {
    const rel = relative(resolve(root), absolute);
    if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) fail("protected-store");
  }
}

function validate(lock: SourceLock) {
  if (lock.schemaVersion !== 1 || !lock.repositories?.length) fail("invalid-source-lock");
  const seen = new Map<string, Source>();
  const mounts = new Set<string>();
  const identities = new Map<string, string>();
  for (const source of lock.repositories) {
    if (
      !/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(source.repository) ||
      !/^[a-f0-9]{40}$/.test(source.revision) ||
      !source.id ||
      seen.has(source.id) ||
      mounts.has(source.mount) ||
      sourcePath(source.mount) !== source.mount ||
      !source.mount.startsWith("sources/") ||
      !Array.isArray(source.gitlinks)
    )
      fail("invalid-source-identity");
    if (source.parent) {
      const parent = seen.get(source.parent);
      if (!parent || !source.submodulePath || source.mount !== `${parent.mount}/${sourcePath(source.submodulePath)}`)
        fail("invalid-source-parent");
    } else if (source.submodulePath) fail("invalid-source-parent");
    for (const other of seen.values()) {
      if (source.mount.startsWith(`${other.mount}/`)) {
        let ancestor = source.parent;
        while (ancestor && ancestor !== other.id) ancestor = seen.get(ancestor)?.parent;
        if (!ancestor) fail("overlapping-independent-source-mounts");
      }
    }
    seen.set(source.id, source);
    mounts.add(source.mount);
  }
  for (const source of lock.repositories) {
    const children = lock.repositories.filter(child => child.parent === source.id);
    if (children.length !== source.gitlinks.length) fail("incomplete-gitlink-lock");
    const links = new Set<string>();
    for (const link of source.gitlinks) {
      const path = sourcePath(link.path);
      const child = children.find(item => item.submodulePath === path);
      if (links.has(path) || child?.repository !== link.repository || child?.revision !== link.revision)
        fail("unverified-gitlink-lock");
      links.add(path);
    }
    const fingerprint = JSON.stringify(source.gitlinks.map(link => [link.path, link.repository, link.revision]).sort());
    if (identities.has(keyOf(source)) && identities.get(keyOf(source)) !== fingerprint)
      fail("conflicting-gitlinks-for-identical-revision");
    identities.set(keyOf(source), fingerprint);
  }
}

function validateOptions(options: SourceExportOptions) {
  for (const value of [options.reserveBytes ?? 2 * 1024 ** 3, options.reserveInodes ?? 100_000])
    if (!Number.isSafeInteger(value) || value < 0) fail("invalid-storage-reserve");
  const timeout = options.timeoutMs ?? 30 * 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) fail("invalid-source-export-timeout");
}

async function claim(path: string) {
  const handle = await open(path, "wx", 0o600);
  const token = JSON.stringify({ pid: process.pid, nonce: crypto.randomUUID(), startedAt: now() });
  await handle.writeFile(token);
  return async () => {
    await handle.close();
    if ((await Bun.file(path).text()) !== token) fail("lock-owner-changed");
    await unlink(path);
  };
}

async function inventory(path: string): Promise<StorageInventory> {
  const [space, stat] = await Promise.all([statfs(path, { bigint: true }), lstat(path, { bigint: true })]);
  const number = (value: bigint) =>
    Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
  return {
    path,
    device: stat.dev.toString(),
    freeBytes: number(space.bavail * space.bsize),
    freeInodes: process.platform === "win32" ? null : number(space.ffree),
    blockBytes: number(space.bsize),
    observedAt: now(),
  };
}

function estimateFor(source: Source, options: SourceExportOptions): SourceEstimate {
  const estimate = options.estimates[keyOf(source)];
  if (
    !estimate ||
    ![estimate.archiveBytes, estimate.expandedBytes, estimate.entries].every(Number.isSafeInteger) ||
    estimate.archiveBytes < 1024 ||
    estimate.expandedBytes < 0 ||
    estimate.entries < 1
  )
    fail("missing-or-invalid-source-estimate");
  return estimate;
}

function checkBudget(lock: SourceLock, options: SourceExportOptions, storage: StorageInventory[]) {
  const usage = new Map<string, { bytes: number; inodes: number; inventory: StorageInventory }>();
  for (const item of storage)
    if (!usage.has(item.device)) usage.set(item.device, { bytes: 0, inodes: 0, inventory: item });
  const output = usage.get(storage[0]!.device)!;
  const cache = usage.get(storage[1]!.device)!;
  const acquired = new Set<string>();
  for (const source of lock.repositories) {
    const estimate = estimateFor(source, options);
    output.bytes += estimate.expandedBytes + (estimate.entries + 2) * output.inventory.blockBytes;
    output.inodes += estimate.entries + 2;
    if (!acquired.has(keyOf(source))) {
      // One retained archive, one verified LFS cache, one bounded Git-tree metadata response and wrapper.
      cache.bytes +=
        estimate.archiveBytes +
        estimate.expandedBytes +
        (estimate.entries + 16) * cache.inventory.blockBytes +
        32 * 1024 * 1024;
      cache.inodes += estimate.entries + 16;
      acquired.add(keyOf(source));
    }
  }
  for (const item of usage.values()) {
    if (
      !Number.isSafeInteger(item.bytes) ||
      item.bytes + (options.reserveBytes ?? 2 * 1024 ** 3) > item.inventory.freeBytes
    )
      fail("insufficient-free-bytes");
    if (
      item.inventory.freeInodes !== null &&
      item.inodes + (options.reserveInodes ?? 100_000) > item.inventory.freeInodes
    )
      fail("insufficient-free-inodes");
  }
}

function gitEnvironment() {
  const env = { ...Bun.env };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_NO_LAZY_FETCH: "1",
  };
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // A credential-owner promise may already be running; suppress its eventual rejection without logging it.
    void work.catch(() => {});
    fail("source-export-deadline-or-cancellation");
  }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new ExportError("source-export-deadline-or-cancellation"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function* chunksOf(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal);
      if (next.done) break;
      yield next.value;
    }
  } finally {
    // Cancel closes the reader immediately; a third-party owner's cancel hook must not hold the job open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function bytesOf(stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for await (const chunk of chunksOf(stream, signal)) {
    signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > maximum) fail("metadata-size-limit");
    chunks.push(new Uint8Array(chunk));
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

async function gitText(
  checkout: string,
  args: string[],
  signal: AbortSignal,
  settings: { overrides?: string[]; trim?: boolean } = {},
) {
  signal.throwIfAborted();
  try {
    const result = await runProcess(
      [
        "git",
        "-c",
        "core.hooksPath=",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.pager=",
        ...(settings.overrides ?? []).flatMap(value => ["-c", value]),
        ...args,
      ],
      checkout,
      {
        env: gitEnvironment(),
        timeoutMs: 120_000,
        maxOutputBytes: 1024 * 1024,
        signal,
        stdout: "capture",
        stderr: "discard",
      },
    );
    if (result.code !== 0) fail("git-owner-command-failed");
    return settings.trim === false ? result.stdout : result.stdout.trim();
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (signal.aborted) fail("source-export-deadline-or-cancellation");
    fail("git-owner-command-failed");
  }
}

async function writeChunk(handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (!bytesWritten) fail("short-file-write");
    offset += bytesWritten;
  }
}

async function saveStream(
  path: string,
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  signal: AbortSignal,
  expected?: { oid: string; size: number },
): Promise<Digest> {
  await safeDirectory(dirname(path), true);
  const handle = await open(path, "wx", 0o600);
  const hash = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  let complete = false;
  try {
    for await (const chunk of chunksOf(stream, signal)) {
      signal.throwIfAborted();
      bytes += chunk.byteLength;
      if (bytes > maximum) fail("stream-size-limit");
      hash.update(chunk);
      await writeChunk(handle, chunk);
    }
    signal.throwIfAborted();
    const sha256 = hash.digest("hex");
    if (expected && (sha256 !== expected.oid || bytes !== expected.size)) fail("lfs-sha256-or-size-mismatch");
    await handle.sync();
    complete = true;
    return { sha256, bytes };
  } finally {
    await handle.close();
    if (!complete) await unlink(path);
  }
}

async function fileDigest(path: string, signal: AbortSignal): Promise<Digest> {
  await safeDirectory(dirname(path));
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("artifact-is-not-regular");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) fail("artifact-is-not-regular");
    let bytes = 0;
    const hash = new Bun.CryptoHasher("sha256");
    for await (const chunk of chunksOf(Bun.file(handle.fd).stream(), signal)) {
      signal.throwIfAborted();
      bytes += chunk.byteLength;
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function githubJson(source: Source, path: string, options: SourceExportOptions, signal: AbortSignal) {
  const headers = new Headers(
    await abortable(Promise.resolve(options.githubHeaders?.(source.repository, "api.github.com", signal)), signal),
  );
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  const response = await fetch(`https://api.github.com/repos/${source.repository}/${path}`, {
    headers,
    signal,
    redirect: "error",
  });
  if (!response.ok || !response.body) fail(`github-metadata-http-${response.status}`);
  return JSON.parse(decoder.decode(await bytesOf(response.body, 20 * 1024 * 1024, signal)));
}

async function githubCoverage(source: Source, options: SourceExportOptions, signal: AbortSignal): Promise<Coverage> {
  const commit = await githubJson(source, `git/commits/${source.revision}`, options, signal);
  if (commit.sha !== source.revision || !/^[a-f0-9]{40}$/.test(commit.tree?.sha)) fail("github-commit-mismatch");
  const tree = await githubJson(source, `git/trees/${commit.tree.sha}?recursive=1`, options, signal);
  if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree))
    fail("github-tree-truncated-or-invalid-use-existing-checkout");
  if (tree.tree.length > estimateFor(source, options).entries) fail("git-tree-entry-estimate-exceeded");
  const files = new Map<string, TreeEntry>();
  const directories = new Set<string>();
  const links = new Map<string, string>();
  for (const item of tree.tree as TreeEntry[]) {
    const path = sourcePath(item.path);
    if (!/^[a-f0-9]{40}$/.test(item.sha)) fail("invalid-github-tree-object");
    if (item.type === "blob" && ["100644", "100755", "120000"].includes(item.mode)) files.set(path, item);
    else if (item.type === "tree" && item.mode === "040000") directories.add(path);
    else if (item.type === "commit" && item.mode === "160000") {
      links.set(path, item.sha);
      directories.add(path);
    } else fail("unsupported-github-tree-object");
  }
  if (links.size !== source.gitlinks.length || source.gitlinks.some(link => links.get(link.path) !== link.revision))
    fail("source-gitlink-mismatch");
  return { files, directories, seen: new Set() };
}

async function localTree(source: Source, checkout: string, maximum: number, signal: AbortSignal) {
  let pending = "";
  let files = 0;
  let entries = 0;
  const links = new Map<string, string>();
  const text = new TextDecoder("utf-8", { fatal: true });
  const parse = (chunk: Uint8Array, final = false) => {
    pending += text.decode(chunk, { stream: !final });
    const lines = pending.split("\0");
    pending = lines.pop()!;
    if (pending.length > 64 * 1024) fail("git-tree-path-size-limit");
    for (const line of lines) {
      if (++entries > maximum) fail("git-tree-entry-estimate-exceeded");
      const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
      if (!match) fail("unsupported-local-git-tree-entry");
      const path = sourcePath(match[4]!);
      if (match[1] === "160000" && match[2] === "commit") links.set(path, match[3]!);
      else if (match[2] === "blob" && match[1] !== "160000") files++;
      else fail("unsupported-local-git-tree-entry");
    }
  };
  try {
    const result = await runProcess(
      [
        "git",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=",
        "-c",
        "core.pager=",
        "-C",
        checkout,
        "ls-tree",
        "-r",
        "--full-tree",
        "-z",
        source.revision,
      ],
      checkout,
      {
        env: gitEnvironment(),
        timeoutMs: 600_000,
        maxOutputBytes: maximum * 64 * 1024,
        signal,
        stdout: "discard",
        stderr: "discard",
        onOutput(channel, chunk) {
          if (channel === "stdout") parse(chunk);
        },
      },
    );
    parse(new Uint8Array(), true);
    if (result.code !== 0 || pending) fail("local-git-tree-inventory-failed");
    if (links.size !== source.gitlinks.length || source.gitlinks.some(link => links.get(link.path) !== link.revision))
      fail("source-gitlink-mismatch");
    return files;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (signal.aborted) fail("source-export-deadline-or-cancellation");
    fail("local-git-tree-inventory-failed");
  }
}

async function localCheckout(source: Source, options: SourceExportOptions, signal: AbortSignal) {
  const workingCheckout =
    options.checkouts?.[keyOf(source)] ?? options.checkouts?.[source.id] ?? options.checkouts?.[source.repository];
  const configured =
    workingCheckout ??
    options.repositories?.[keyOf(source)] ??
    options.repositories?.[source.id] ??
    options.repositories?.[source.repository];
  if (!configured) return;
  const checkout = resolve(configured);
  protect(checkout, options.protectedRoots ?? []);
  await safeDirectory(checkout);
  const keys = (await gitText(checkout, ["config", "--includes", "--name-only", "--list"], signal)).split("\n");
  // Reject partial clones before reading any object, including on Git versions predating GIT_NO_LAZY_FETCH.
  if (keys.some(key => key.toLowerCase() === "extensions.partialclone" || /^remote\..*\.promisor$/i.test(key)))
    fail("partial-git-repository-not-qualified");
  if ((await gitText(checkout, ["rev-parse", `${source.revision}^{commit}`], signal)) !== source.revision)
    fail("local-source-revision-mismatch");
  const bare = await gitText(checkout, ["rev-parse", "--is-bare-repository"], signal);
  if (bare !== "true" && bare !== "false") fail("invalid-local-git-repository");
  if (bare === "true" && workingCheckout) fail("configure-bare-source-as-repository");
  if (bare === "false") {
    const filters = new Set<string>(["lfs"]);
    for (const key of keys) {
      const match = /^filter\.(.+)\.(clean|process|smudge|required)$/i.exec(key);
      if (match) {
        if (!/^[A-Za-z0-9_.-]+$/.test(match[1]!)) fail("unsupported-git-filter-name");
        filters.add(match[1]!);
      }
    }
    const overrides = [...filters].flatMap(filter => [
      `filter.${filter}.clean=`,
      `filter.${filter}.process=`,
      `filter.${filter}.smudge=`,
      `filter.${filter}.required=false`,
    ]);
    const status = await gitText(
      checkout,
      ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all"],
      signal,
      { overrides, trim: false },
    );
    for (const entry of status.split("\0").filter(Boolean)) {
      // With external filters disabled, a materialized LFS file can appear dirty. Verify it directly against HEAD.
      if (!entry.startsWith(" M ")) fail("local-checkout-has-tracked-changes");
      const path = sourcePath(entry.slice(3));
      const expected = pointer(
        await gitText(checkout, ["show", "--no-ext-diff", "--no-textconv", `HEAD:${path}`], signal, { trim: false }),
      );
      if (!expected) fail("local-checkout-has-tracked-changes");
      const original = inside(checkout, path);
      protect(original, options.protectedRoots ?? []);
      const digest = await fileDigest(original, signal);
      if (digest.sha256 !== expected.oid || digest.bytes !== expected.size) fail("local-checkout-has-tracked-changes");
      if (process.platform !== "win32") {
        const mode = await gitText(checkout, ["ls-tree", "HEAD", "--", path], signal);
        if (Boolean((await lstat(original)).mode & 0o100) !== mode.startsWith("100755 "))
          fail("local-checkout-has-tracked-mode-changes");
      }
    }
  }
  return {
    path: checkout,
    head: bare === "false" ? await gitText(checkout, ["rev-parse", "HEAD"], signal) : undefined,
    files: await localTree(source, checkout, estimateFor(source, options).entries, signal),
  };
}

async function acquire(
  source: Source,
  cache: string,
  checkout: Awaited<ReturnType<typeof localCheckout>>,
  options: SourceExportOptions,
  signal: AbortSignal,
) {
  const key = keyOf(source);
  const name = new Bun.CryptoHasher("sha256").update(key).digest("hex");
  const base = inside(cache, name);
  await safeDirectory(base, true);
  const metadata = join(base, "archive.receipt.json");
  const coverage = checkout ? undefined : await githubCoverage(source, options, signal);
  const expectedCoverage = checkout ? "local-git-all-tracked" : "github-git-tree";
  const archive = join(base, checkout ? "source.tar" : "source.tar.gz");
  if (await Bun.file(metadata).exists()) {
    if (!(await lstat(metadata)).isFile() || (await lstat(metadata)).isSymbolicLink())
      fail("cached-acquisition-receipt-is-not-regular");
    const existing = (await Bun.file(metadata).json()) as Acquisition;
    if (
      existing.key !== key ||
      existing.coverage !== expectedCoverage ||
      existing.repository !== source.repository ||
      existing.revision !== source.revision ||
      existing.encoding !== (checkout ? "tar" : "gzip") ||
      existing.strip !== (checkout ? 0 : 1)
    )
      fail("cached-acquisition-identity-mismatch");
    const digest = await fileDigest(archive, signal);
    if (digest.bytes > estimateFor(source, options).archiveBytes) fail("cached-archive-size-estimate-exceeded");
    if (digest.bytes !== existing.bytes || digest.sha256 !== existing.sha256) fail("cached-archive-digest-mismatch");
    return { acquisition: { ...existing, archive }, coverage };
  }
  const incoming = `${archive}.incoming-${crypto.randomUUID()}`;
  const estimate = estimateFor(source, options);
  let digest: Digest;
  if (checkout) {
    // A private bare view reads existing objects without cloning or changing the owner's .git/info/attributes.
    const objects = await realpath(
      resolve(checkout.path, await gitText(checkout.path, ["rev-parse", "--git-path", "objects"], signal)),
    );
    protect(objects, options.protectedRoots ?? []);
    await safeDirectory(objects);
    const view = join(base, `git-view-${crypto.randomUUID()}`);
    for (const directory of ["objects/info", "refs", "info"]) await safeDirectory(join(view, directory), true);
    await Bun.write(join(view, "HEAD"), "ref: refs/heads/source-export\n");
    await Bun.write(join(view, "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = true\n");
    await Bun.write(join(view, "objects/info/alternates"), `${objects.replaceAll("\\", "/")}\n`);
    await Bun.write(join(view, "info/attributes"), "* -export-ignore -export-subst\n");
    await safeDirectory(dirname(incoming), true);
    const handle = await open(incoming, "wx", 0o600);
    const hash = new Bun.CryptoHasher("sha256");
    let bytes = 0;
    let complete = false;
    try {
      const result = await runProcess(["git", `--git-dir=${view}`, "archive", "--format=tar", source.revision], view, {
        env: gitEnvironment(),
        timeoutMs: 600_000,
        maxOutputBytes: estimate.archiveBytes + 64 * 1024,
        signal,
        stdout: "discard",
        stderr: "discard",
        async onOutput(channel, chunk) {
          if (channel !== "stdout") return;
          bytes += chunk.byteLength;
          if (bytes > estimate.archiveBytes) fail("stream-size-limit");
          hash.update(chunk);
          await writeChunk(handle, chunk);
        },
      });
      if (result.code !== 0) fail("git-archive-failed");
      signal.throwIfAborted();
      await handle.sync();
      digest = { sha256: hash.digest("hex"), bytes };
      complete = true;
    } catch (error) {
      if (error instanceof ExportError) throw error;
      if (signal.aborted) fail("source-export-deadline-or-cancellation");
      fail("git-archive-failed");
    } finally {
      await handle.close();
      if (!complete) await unlink(incoming);
    }
  } else {
    const headers = await abortable(
      Promise.resolve(options.githubHeaders?.(source.repository, "codeload.github.com", signal)),
      signal,
    );
    const response = await fetch(`https://codeload.github.com/${source.repository}/tar.gz/${source.revision}`, {
      headers,
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) fail(`archive-http-${response.status}`);
    digest = await saveStream(incoming, response.body, estimate.archiveBytes, signal);
  }
  signal.throwIfAborted();
  await rename(incoming, archive);
  const acquisition: Acquisition = {
    key,
    repository: source.repository,
    revision: source.revision,
    archive,
    ...digest,
    encoding: checkout ? "tar" : "gzip",
    strip: checkout ? 0 : 1,
    coverage: expectedCoverage,
  };
  await Bun.write(metadata, JSON.stringify(acquisition, null, 2) + "\n");
  return { acquisition, coverage };
}

class TarReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private offset = 0;
  constructor(
    stream: ReadableStream<Uint8Array>,
    private signal: AbortSignal,
  ) {
    this.reader = stream.getReader();
  }
  async take(size: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    while (this.offset === this.chunk.byteLength) {
      const next = await abortable(this.reader.read(), this.signal);
      if (next.done) fail("truncated-tar");
      this.chunk = next.value;
      this.offset = 0;
    }
    const length = Math.min(size, this.chunk.byteLength - this.offset);
    const value = this.chunk.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  async read(size: number) {
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size;) {
      const chunk = await this.take(size - offset);
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  async consume(size: number, write?: (chunk: Uint8Array) => Promise<void>) {
    while (size) {
      const chunk = await this.take(Math.min(size, 256 * 1024));
      if (write) await write(chunk);
      size -= chunk.byteLength;
    }
  }
  async finish() {
    // Read to EOF so the gzip trailer is checked and additional nonzero tar data is rejected.
    while (this.offset < this.chunk.byteLength || !(await this.more())) {
      this.signal.throwIfAborted();
      if (this.chunk.subarray(this.offset).some(byte => byte !== 0)) fail("data-after-tar-end");
      this.offset = this.chunk.byteLength;
    }
  }
  private async more() {
    const next = await abortable(this.reader.read(), this.signal);
    if (next.done) return true;
    this.chunk = next.value;
    this.offset = 0;
    return false;
  }
  async close() {
    await abortable(this.reader.cancel(), AbortSignal.timeout(30_000));
    this.reader.releaseLock();
  }
}

function tarText(header: Uint8Array, start: number, length: number) {
  const bytes = header.subarray(start, start + length);
  const zero = bytes.indexOf(0);
  return decoder.decode(zero < 0 ? bytes : bytes.subarray(0, zero));
}

function octal(value: string) {
  const text = value.trim();
  if (text && !/^[0-7]+$/.test(text)) fail("unsupported-tar-number");
  const number = text ? parseInt(text, 8) : 0;
  if (!Number.isSafeInteger(number) || number < 0) fail("invalid-tar-number");
  return number;
}

function pax(bytes: Uint8Array) {
  const fields: Record<string, string> = Object.create(null);
  for (let offset = 0; offset < bytes.byteLength;) {
    const space = bytes.indexOf(32, offset);
    if (space < 0) fail("invalid-pax-header");
    const text = decoder.decode(bytes.subarray(offset, space));
    if (!/^[1-9][0-9]*$/.test(text)) fail("invalid-pax-header");
    const length = Number(text);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.byteLength || end <= space + 2 || bytes[end - 1] !== 10)
      fail("invalid-pax-header");
    const line = decoder.decode(bytes.subarray(space + 1, end - 1));
    const equals = line.indexOf("=");
    if (equals < 1) fail("invalid-pax-header");
    const key = line.slice(0, equals);
    if (key.startsWith("GNU.sparse") || key.startsWith("SCHILY")) fail("unsupported-pax-transformation");
    fields[key] = line.slice(equals + 1);
    offset = end;
  }
  return fields;
}

async function extractTar(
  source: Source,
  acquisition: Acquisition,
  destination: string,
  coverage: Coverage | undefined,
  estimate: SourceEstimate,
  signal: AbortSignal,
) {
  await safeDirectory(destination, true, 0o755);
  const archiveMetadata = await lstat(acquisition.archive);
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink()) fail("archive-is-not-regular");
  const archive = await open(acquisition.archive, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let stream = Bun.file(archive.fd).stream();
  if (acquisition.encoding === "gzip") stream = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = new TarReader(stream, signal);
  let local: Record<string, string> = {};
  let global: Record<string, string> = {};
  let entries = 0;
  let files = 0;
  let bytes = 0;
  let prefix: string | undefined;
  coverage?.seen.clear();
  try {
    for (;;) {
      const header = await reader.read(512);
      if (header.every(byte => byte === 0)) {
        if (!(await reader.read(512)).every(byte => byte === 0)) fail("invalid-tar-terminator");
        await reader.finish();
        break;
      }
      const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
      if (checksum !== octal(tarText(header, 148, 8))) fail("tar-checksum-mismatch");
      const type = String.fromCharCode(header[156]!);
      let size = octal(tarText(header, 124, 12));
      if (["x", "g", "L", "K"].includes(type)) {
        if (size > 1024 * 1024) fail("tar-metadata-size-limit");
        const data = await reader.read(size);
        await reader.consume((512 - (size % 512)) % 512);
        if (type === "x") local = { ...local, ...pax(data) };
        else if (type === "g") global = { ...global, ...pax(data) };
        else local[type === "L" ? "path" : "linkpath"] = decoder.decode(data).replace(/\0$/, "");
        continue;
      }
      const attributes = { ...global, ...local };
      local = {};
      if (attributes.comment && attributes.comment !== source.revision) fail("tar-commit-mismatch");
      if (attributes.size !== undefined) {
        if (!/^(0|[1-9][0-9]*)$/.test(attributes.size)) fail("invalid-pax-size");
        size = Number(attributes.size);
        if (!Number.isSafeInteger(size)) fail("invalid-pax-size");
      }
      const name = tarText(header, 0, 100);
      const parent = tarText(header, 345, 155);
      let path = sourcePath(attributes.path ?? (parent ? `${parent}/${name}` : name));
      if (acquisition.strip) {
        const [top, ...parts] = path.split("/");
        prefix ??= top;
        if (top !== prefix) fail("multiple-archive-roots");
        if (!parts.length) {
          if (type !== "5" || size) fail("invalid-archive-root");
          continue;
        }
        path = parts.join("/");
      }
      if (++entries > estimate.entries || bytes + size > estimate.expandedBytes) fail("extraction-estimate-exceeded");
      const output = inside(destination, path);
      await safeDirectory(dirname(output), true, 0o755);
      const expected = coverage?.files.get(path);
      if (type === "5") {
        if (size || (coverage && !coverage.directories.has(path))) fail("unexpected-archive-directory");
        await safeDirectory(output, true, 0o755);
      } else if (type === "2") {
        files++;
        if (size || (coverage && expected?.mode !== "120000")) fail("unexpected-archive-symlink");
        const target = attributes.linkpath ?? tarText(header, 157, 100);
        if (!target || target.includes("\0")) fail("invalid-symlink-target");
        // Keep the exact Git link text, including external targets. No operation dereferences it.
        if (expected) {
          const data = encoder.encode(target);
          const sha = new Bun.CryptoHasher("sha1").update(`blob ${data.byteLength}\0`).update(data).digest("hex");
          if (sha !== expected.sha) fail("git-symlink-blob-mismatch");
          coverage!.seen.add(path);
        }
        await symlink(target, output);
      } else if (type === "0" || type === "\0") {
        files++;
        if (coverage && (!expected || !["100644", "100755"].includes(expected.mode))) fail("unexpected-archive-file");
        const mode = expected
          ? expected.mode === "100755"
            ? 0o755
            : 0o644
          : octal(tarText(header, 100, 8)) & 0o111
            ? 0o755
            : 0o644;
        if (expected?.size !== undefined && expected.size !== size) fail("git-blob-size-mismatch");
        const hash = new Bun.CryptoHasher("sha1").update(`blob ${size}\0`);
        const handle = await open(output, "wx", 0o600);
        try {
          await reader.consume(size, async chunk => {
            hash.update(chunk);
            await writeChunk(handle, chunk);
          });
        } finally {
          await handle.close();
        }
        if (expected && hash.digest("hex") !== expected.sha) fail("git-blob-sha1-mismatch");
        if (expected) coverage!.seen.add(path);
        await chmod(output, mode);
        if (mode === 0o755 && ((await lstat(output)).mode & 0o111) !== 0o111)
          fail("source-executable-mode-not-supported");
        bytes += size;
      } else fail("unsupported-tar-entry-type");
      await reader.consume((512 - (size % 512)) % 512);
    }
    if (coverage && coverage.seen.size !== coverage.files.size) fail("archive-omits-tracked-files");
    return { entries, files, bytes };
  } finally {
    await reader.close();
    await archive.close();
  }
}

function pointer(text: string): { oid: string; size: number } | undefined {
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return;
  const match =
    /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (0|[1-9][0-9]*)\n$/.exec(text);
  // Extension-bearing pointers need the owner's transformation adapter; leave them explicitly incomplete.
  if (!match || !Number.isSafeInteger(Number(match[2]))) fail("unsupported-or-invalid-lfs-pointer");
  return { oid: match[1]!, size: Number(match[2]) };
}

async function* regularFiles(root: string, prefix = ""): AsyncGenerator<string> {
  const directory = await opendir(join(root, prefix));
  for await (const entry of directory) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* regularFiles(root, path);
    else if (entry.isFile()) yield path;
    else if (!entry.isSymbolicLink()) fail("unsupported-source-file-type");
  }
}

async function materializeLfs(
  source: Source,
  destination: string,
  cache: string,
  checkout: Awaited<ReturnType<typeof localCheckout>>,
  options: SourceExportOptions,
  receipt: SourceExportReceipt,
  expanded: number,
  signal: AbortSignal,
) {
  for await (const path of regularFiles(destination)) {
    signal.throwIfAborted();
    const output = inside(destination, path);
    const stat = await lstat(output);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("lfs-pointer-is-not-regular");
    if (stat.size >= 1024) continue;
    let object: ReturnType<typeof pointer>;
    try {
      object = pointer(await Bun.file(output).text());
    } catch {
      receipt.issues.push({ code: "unsupported-or-invalid-lfs-pointer", source: source.id, path });
      continue;
    }
    if (!object) continue;
    if (expanded + object.size - stat.size > estimateFor(source, options).expandedBytes)
      fail("lfs-expansion-estimate-exceeded");
    const objectPath = inside(
      cache,
      `lfs/${new Bun.CryptoHasher("sha256").update(source.repository).digest("hex")}/${object.oid}`,
    );
    await safeDirectory(dirname(objectPath), true);
    try {
      if (!(await Bun.file(objectPath).exists())) {
        let saved = false;
        if (checkout?.head === source.revision) {
          try {
            const original = inside(checkout.path, path);
            protect(original, options.protectedRoots ?? []);
            await safeDirectory(dirname(original));
            const ownerStat = await lstat(original);
            if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) fail("local-lfs-owner-is-not-regular");
            const ownerHandle = await open(original, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const incoming = `${objectPath}.incoming-${crypto.randomUUID()}`;
            try {
              await saveStream(incoming, Bun.file(ownerHandle.fd).stream(), object.size, signal, object);
              await rename(incoming, objectPath);
              saved = true;
            } finally {
              await ownerHandle.close();
            }
          } catch {
            signal.throwIfAborted();
            // A clean checkout can still contain an unsmudged pointer; try the explicitly configured owner.
          }
        }
        if (!saved) {
          const stream = await abortable(
            Promise.resolve(
              options.lfsOwner?.({
                ...object,
                repository: source.repository,
                revision: source.revision,
                path,
                signal,
              }),
            ),
            signal,
          );
          if (!stream) fail("lfs-owner-unavailable");
          const incoming = `${objectPath}.incoming-${crypto.randomUUID()}`;
          await saveStream(incoming, stream, object.size, signal, object);
          await rename(incoming, objectPath);
        }
      }
      const verified = await fileDigest(objectPath, signal);
      if (verified.sha256 !== object.oid || verified.bytes !== object.size) fail("cached-lfs-digest-mismatch");
      const incoming = `${output}.lfs-${crypto.randomUUID()}`;
      await saveStream(incoming, Bun.file(objectPath).stream(), object.size, signal, object);
      await chmod(incoming, stat.mode & 0o111 ? 0o755 : 0o644);
      // The pointer survives until the replacement bytes have passed both checks.
      await rename(incoming, output);
      expanded += object.size - stat.size;
      receipt.materializedLfs.push({
        repository: source.repository,
        revision: source.revision,
        path,
        oid: object.oid,
        bytes: object.size,
      });
    } catch (error) {
      signal.throwIfAborted();
      receipt.issues.push({
        code: error instanceof ExportError ? error.code : "lfs-owner-or-io-failed",
        source: source.id,
        path,
        oid: object.oid,
      });
    }
  }
}

/** Same tree hash contract as container/source-integrity.ts, with a cancellation check in every stream. */
async function integrity(root: string, signal: AbortSignal) {
  const tree = new Bun.CryptoHasher("sha256");
  let files = 0;
  let bytes = 0;
  const lfsPointers: string[] = [];
  async function visit(prefix: string) {
    signal.throwIfAborted();
    const directory = await opendir(join(root, prefix));
    const entries = [];
    for await (const entry of directory) entries.push(entry);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      signal.throwIfAborted();
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(root, path);
      if (entry.isSymbolicLink()) tree.update(JSON.stringify([path, "symlink", await readlink(absolute)]) + "\n");
      else if (entry.isDirectory()) {
        tree.update(JSON.stringify([path, "directory"]) + "\n");
        await visit(path);
      } else if (entry.isFile()) {
        const digest = await fileDigest(absolute, signal);
        files++;
        bytes += digest.bytes;
        tree.update(JSON.stringify([path, "file", digest.bytes, digest.sha256]) + "\n");
        if (
          digest.bytes < 1024 &&
          (await Bun.file(absolute).slice(0, 80).text()).startsWith("version https://git-lfs.github.com/spec/v1")
        )
          lfsPointers.push(path);
      } else fail("unsupported-source-file-type");
    }
  }
  await visit("");
  return { files, bytes, lfsPointers, treeSHA256: tree.digest("hex") };
}

/** Return incomplete receipts for recoverable LFS failures; never label a partial tree complete. */
export async function exportPinnedSources(output: string, options: SourceExportOptions): Promise<SourceExportReceipt> {
  options = {
    ...options,
    estimates: structuredClone(options.estimates),
    checkouts: { ...options.checkouts },
    repositories: { ...options.repositories },
    protectedRoots: [...(options.protectedRoots ?? [])],
  };
  validateOptions(options);
  const lock = structuredClone(options.lock ?? (await readLock()));
  validate(lock);
  const root = resolve(output);
  const cache = resolve(options.cache ?? join(root, ".source-cache"));
  for (const path of [root, cache]) protect(path, options.protectedRoots ?? []);
  if (relative(root, cache).split(sep)[0] === "sources" || relative(cache, root).split(sep)[0] === "sources")
    fail("cache-overlaps-source-mounts");
  await safeDirectory(root, true);
  await safeDirectory(cache, true);
  const releaseOutput = await claim(join(root, ".assembling"));
  let releaseCache: (() => Promise<void>) | undefined;
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 30 * 60_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const receipt: SourceExportReceipt = {
    schemaVersion: 1,
    kind: "bun-os-sources",
    complete: false,
    status: "running",
    startedAt: now(),
    repositories: [],
    acquisitions: [],
    storage: [],
    estimates: {},
    materializedLfs: [],
    issues: [],
    expectedRepositories: lock.repositories.length,
    integrityComplete: false,
    files: 0,
    bytes: 0,
    lfsPointers: [],
  };
  const writeReceipt = async () => {
    const path = join(root, "sources.receipt.json");
    const incoming = `${path}.incoming-${crypto.randomUUID()}`;
    await saveStream(
      incoming,
      new Blob([JSON.stringify(receipt, null, 2) + "\n"]).stream(),
      32 * 1024 * 1024,
      AbortSignal.timeout(30_000),
    );
    await rename(incoming, path);
  };
  let current: Source | undefined;
  try {
    releaseCache = await claim(join(cache, ".source-export.lock"));
    for (const source of lock.repositories) receipt.estimates[keyOf(source)] = estimateFor(source, options);
    receipt.storage = await Promise.all([inventory(root), inventory(cache)]);
    await writeReceipt();
    checkBudget(lock, options, receipt.storage);
    const sourcesRoot = inside(root, "sources");
    await safeDirectory(sourcesRoot, true, 0o755);
    const sourceDirectory = await opendir(sourcesRoot);
    for await (const _entry of sourceDirectory) fail("source-root-already-populated");
    const acquisitions = new Map<string, Awaited<ReturnType<typeof acquire>>>();
    const localOwners = new Map<string, Awaited<ReturnType<typeof localCheckout>>>();
    for (const source of lock.repositories) {
      current = source;
      signal.throwIfAborted();
      const destination = inside(root, source.mount);
      await safeDirectory(destination, true, 0o755);
      const directory = await opendir(destination);
      for await (const _entry of directory) fail("source-destination-already-populated");
      const key = keyOf(source);
      if (!acquisitions.has(key)) {
        const peers = lock.repositories.filter(item => keyOf(item) === key);
        const configuredPeer =
          peers.find(item => options.checkouts?.[item.id] || options.repositories?.[item.id]) ?? source;
        const owner = await localCheckout(configuredPeer, options, signal);
        localOwners.set(key, owner);
        const acquired = await acquire(source, cache, owner, options, signal);
        acquisitions.set(key, acquired);
        const { archive: _archive, ...metadata } = acquired.acquisition;
        receipt.acquisitions.push(metadata);
        await writeReceipt();
      }
      const { acquisition, coverage } = acquisitions.get(key)!;
      const result = await extractTar(source, acquisition, destination, coverage, estimateFor(source, options), signal);
      if (localOwners.get(key) && result.files !== localOwners.get(key)!.files) fail("archive-omits-tracked-files");
      await materializeLfs(source, destination, cache, localOwners.get(key), options, receipt, result.bytes, signal);
      receipt.repositories.push({
        ...source,
        archiveSHA256: acquisition.sha256,
        archiveBytes: acquisition.bytes,
        entries: result.entries,
        acquisition: key,
        coverage: acquisition.coverage,
      });
      await writeReceipt();
    }
    Object.assign(receipt, await integrity(join(root, "sources"), signal));
    receipt.integrityComplete = true;
    receipt.complete =
      receipt.repositories.length === lock.repositories.length && !receipt.issues.length && !receipt.lfsPointers.length;
    receipt.status = receipt.complete ? "complete" : "incomplete";
  } catch (error) {
    receipt.status = "incomplete";
    receipt.issues.push({
      code: signal.aborted
        ? "source-export-deadline-or-cancellation"
        : error instanceof ExportError
          ? error.code
          : "source-export-owner-or-io-failed",
      ...(current ? { source: current.id } : {}),
    });
  } finally {
    receipt.finishedAt = now();
    try {
      await writeReceipt();
    } finally {
      try {
        await releaseCache?.();
      } finally {
        await releaseOutput();
      }
    }
  }
  return receipt;
}

/** Explicit Git LFS basic-transfer owner. Authorization is obtained only from the supplied callback. */
export function createLfsBatchOwner(options: {
  endpoint: (repository: string) => string;
  headers: (repository: string, signal: AbortSignal) => Promise<HeadersInit | undefined>;
  allowedDownloadHosts: string[];
}): LfsOwner {
  return async request => {
    const endpoint = new URL(options.endpoint(request.repository));
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      fail("unsafe-lfs-batch-endpoint");
    const headers = new Headers(await abortable(options.headers(request.repository, request.signal), request.signal));
    headers.set("Accept", "application/vnd.git-lfs+json");
    headers.set("Content-Type", "application/vnd.git-lfs+json");
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "download",
        transfers: ["basic"],
        objects: [{ oid: request.oid, size: request.size }],
        hash_algo: "sha256",
      }),
      signal: request.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) fail(`lfs-batch-http-${response.status}`);
    const batch = JSON.parse(decoder.decode(await bytesOf(response.body, 1024 * 1024, request.signal)));
    if (
      (batch.transfer ?? "basic") !== "basic" ||
      (batch.hash_algo ?? "sha256") !== "sha256" ||
      batch.objects?.length !== 1
    )
      fail("unsupported-lfs-transfer");
    const object = batch.objects[0];
    if (object.oid !== request.oid || object.size !== request.size || object.error || !object.actions?.download?.href)
      fail("lfs-batch-object-unavailable-or-mismatched");
    const action = object.actions.download;
    const download = new URL(action.href);
    if (
      download.protocol !== "https:" ||
      download.username ||
      download.password ||
      !options.allowedDownloadHosts.includes(download.hostname)
    )
      fail("unapproved-lfs-download-host");
    // Only the action's headers go to the object host. Batch authorization is never forwarded.
    const payload = await fetch(download, { headers: action.header, signal: request.signal, redirect: "error" });
    if (!payload.ok || !payload.body) fail(`lfs-download-http-${payload.status}`);
    return payload.body;
  };
}
