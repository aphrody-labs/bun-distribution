// SPDX-License-Identifier: MIT
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  statfs,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dlopen, read } from "bun:ffi";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "../../packages/bun-workspace/src/process.ts";
import {
  hashContent,
  hashFile,
  hashStream,
} from "../../packages/bun-workspace/src/hash.ts";
import type { Composition, DesktopSession } from "./index.ts";

export interface ArchPackage {
  name: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  signatureUrl: string;
  signatureSha256: string;
}
export interface ArchPackageLock {
  schemaVersion: 2;
  target: "linux-x64";
  architecture: "x86_64";
  snapshot: string;
  image: string;
  composition: Composition;
  desktopSession: DesktopSession | null;
  desktopSessionState: "not-applicable" | "unqualified";
  packages: ArchPackage[];
  approvedSigners: string[];
}
export interface ArchFactoryProfile {
  sharedHeavyLockRelative: string;
  minimumFreeBytes: number;
  commandTimeoutSeconds: number;
  jobDeadlineSeconds?: number;
  desktopSessions?: Partial<
    Record<
      DesktopSession,
      { state: "blocked" | "unqualified"; blockers?: string[] }
    >
  >;
}
export interface ArchFactoryOptions {
  /** Existing absolute factory work directory; jobs/cache remain below it. */
  root: string;
  lock: ArchPackageLock;
  executor: "native" | "docker";
  profile?: ArchFactoryProfile;
  timeoutMs?: number;
  minimumFreeBytes?: number;
  signal?: AbortSignal;
}
export interface ArchRootfsReceipt {
  schemaVersion: 2;
  kind: "bun-os-arch-rootfs";
  target: "linux-x64";
  architecture: "x86_64";
  composition: ArchPackageLock["composition"];
  desktopSession: ArchPackageLock["desktopSession"];
  desktopSessionState: "not-applicable" | "unqualified";
  snapshot: string;
  image: string;
  executor: ArchFactoryOptions["executor"];
  job: string;
  lockSha256: string;
  artifact: { path: string; sha256: string; bytes: number };
  inventory: { path: string; sha256: string; bytes: number };
  packages: ArchPackage[];
  approvedSigners: string[];
  packageHashesVerified: true;
  packageSignaturesVerified: true;
  exactInventoryVerified: true;
  qualified: false;
  bootQualified: false;
  startedAt: string;
  completedAt: string;
}

const hash = /^[a-f0-9]{64}$/;
const image = /^archlinux(?::base-devel)?@sha256:[a-f0-9]{64}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an Arch lock object.");
  return value as Record<string, unknown>;
}
function https(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Expected an HTTPS artifact URL.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Artifact URLs must be HTTPS without credentials, queries or fragments.",
    );
  return url.href;
}
function positive(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new Error("Invalid Arch factory numeric limit.");
  return value;
}
export function validateArchPackageLock(value: unknown): ArchPackageLock {
  const lock = record(value);
  if (
    lock.schemaVersion !== 2 ||
    lock.target !== "linux-x64" ||
    lock.architecture !== "x86_64"
  )
    throw new Error("Expected schema 2 linux-x64/x86_64 Arch lock.");
  if (
    typeof lock.snapshot !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(lock.snapshot)
  )
    throw new Error("Expected an immutable YYYY-MM-DD Arch snapshot.");
  const date = new Date(lock.snapshot + "T00:00:00Z");
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== lock.snapshot
  )
    throw new Error("Invalid Arch snapshot date.");
  if (typeof lock.image !== "string" || !image.test(lock.image))
    throw new Error(
      "Expected an official archlinux image pinned by SHA-256 digest.",
    );
  if (
    lock.composition !== "server" &&
    lock.composition !== "desktop" &&
    lock.composition !== "gaming"
  )
    throw new Error("Invalid Arch composition.");
  const desktopSession = lock.desktopSession;
  const desktopSessionState = lock.desktopSessionState;
  if (
    desktopSessionState !== "not-applicable" &&
    desktopSessionState !== "unqualified" &&
    desktopSessionState !== "blocked"
  )
    throw new Error("Invalid desktop session qualification state.");
  if (
    (desktopSession !== null &&
      desktopSession !== "cosmic" &&
      desktopSession !== "omarchy-hyprland") ||
    (lock.composition === "desktop") !== (desktopSession !== null) ||
    (desktopSession === null && desktopSessionState !== "not-applicable") ||
    (desktopSession === "cosmic" && desktopSessionState !== "unqualified") ||
    (desktopSession === "omarchy-hyprland" && desktopSessionState !== "blocked")
  )
    throw new Error(
      "Desktop session must be selected only for the desktop composition.",
    );
  if (desktopSessionState === "blocked")
    throw new Error("A blocked desktop session cannot produce a package lock.");
  if (
    !Array.isArray(lock.packages) ||
    !lock.packages.length ||
    lock.packages.length > 10000
  )
    throw new Error("An exact nonempty package closure is required.");
  const names = new Set<string>();
  const packages = lock.packages.map((value) => {
    const pkg = record(value);
    if (
      typeof pkg.name !== "string" ||
      !/^[a-z0-9][a-z0-9@._+-]{0,199}$/.test(pkg.name) ||
      names.has(pkg.name)
    )
      throw new Error("Invalid or duplicate Arch package name.");
    names.add(pkg.name);
    if (
      typeof pkg.version !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.:_+~-]{0,199}$/.test(pkg.version)
    )
      throw new Error("Invalid exact Arch package version.");
    if (
      typeof pkg.sha256 !== "string" ||
      !hash.test(pkg.sha256) ||
      typeof pkg.signatureSha256 !== "string" ||
      !hash.test(pkg.signatureSha256)
    )
      throw new Error("Every package and detached signature requires SHA-256.");
    const url = https(pkg.url);
    if (!/\.pkg\.tar\.(?:zst|xz|gz)$/.test(new URL(url).pathname))
      throw new Error("Expected an ALPM package archive URL.");
    return {
      name: pkg.name,
      version: pkg.version,
      url,
      sha256: pkg.sha256,
      bytes: positive(pkg.bytes, 16 * 1024 ** 3),
      signatureUrl: https(pkg.signatureUrl),
      signatureSha256: pkg.signatureSha256,
    };
  });
  if (
    !Array.isArray(lock.approvedSigners) ||
    !lock.approvedSigners.length ||
    lock.approvedSigners.length > 10000
  )
    throw new Error("Approved signing-key fingerprints are required.");
  const approvedSigners = lock.approvedSigners.map((value) => {
    if (
      typeof value !== "string" ||
      !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)
    )
      throw new Error("Expected a complete approved OpenPGP fingerprint.");
    return value.toUpperCase();
  });
  if (new Set(approvedSigners).size !== approvedSigners.length)
    throw new Error("Duplicate approved signer.");
  return {
    schemaVersion: 2,
    target: "linux-x64",
    architecture: "x86_64",
    snapshot: lock.snapshot,
    image: lock.image,
    composition: lock.composition,
    desktopSession,
    desktopSessionState,
    packages,
    approvedSigners,
  };
}

function safeRoot(value: string): string {
  if (!isAbsolute(value) || value.includes("\0"))
    throw new Error("An explicit absolute factory root is required.");
  const root = resolve(value);
  if (
    root === dirname(root) ||
    /(?:^|[\\/])(?:\.local|\.aphrody|\.codex|\.claude|cookies|sessions|datasets|databases|weights|models)(?:[\\/]|$)/i.test(
      root,
    )
  )
    throw new Error(
      "The factory root must be outside protected stores and filesystem roots.",
    );
  return root;
}
function inside(root: string, path: string): string {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Factory output escaped its owner.");
  return path;
}
export function planArchFactory(options: ArchFactoryOptions) {
  const lock = validateArchPackageLock(options.lock);
  const root = safeRoot(options.root);
  if (options.executor !== "native" && options.executor !== "docker")
    throw new Error("Invalid Arch executor.");
  const inputBytes = lock.packages.reduce((total, pkg) => total + pkg.bytes, 0);
  if (!Number.isSafeInteger(inputBytes))
    throw new Error("Arch lock size overflow.");
  const timeoutMs = positive(
    options.timeoutMs ?? (options.profile?.jobDeadlineSeconds ?? 3600) * 1000,
    43200000,
  );
  const minimumFreeBytes = positive(
    options.minimumFreeBytes ??
      options.profile?.minimumFreeBytes ??
      Math.max(8 * 1024 ** 3, inputBytes * 4),
    Number.MAX_SAFE_INTEGER,
  );
  return {
    schemaVersion: 1 as const,
    kind: "bun-os-arch-factory-plan" as const,
    root,
    lock,
    lockSha256: hashContent(JSON.stringify(lock)),
    executor: options.executor,
    timeoutMs,
    minimumFreeBytes,
    inputBytes,
    jobs: join(root, "arch-jobs"),
    cache: join(root, "cache", "arch-packages"),
    heavyLock: resolve(
      root,
      options.profile?.sharedHeavyLockRelative ?? "../locks/heavy.lock",
    ),
    networkDuringInstallation: false,
    hostRootInstallation: false,
    qualified: false,
    bootQualified: false,
  };
}

async function directory(root: string, path: string): Promise<string> {
  inside(root, path);
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const state = await lstat(current);
    if (!state.isDirectory() || state.isSymbolicLink())
      throw new Error("Expected an owned physical directory.");
    inside(root, await realpath(current));
  }
  return current;
}

// Keep uncertain live container ownership locked until the owning process exits.
export interface ArchHeavyLock {
  path: string;
  release(): Promise<void>;
  /** Unknown live child state: retain kernel ownership until recovery/process exit. */
  retain(): void;
}
const retainedHeavyLocks = new Map<string, ArchHeavyLock>();
export async function acquireArchHeavyLock(
  path: string,
): Promise<ArchHeavyLock> {
  if (process.platform !== "linux" || !isAbsolute(path))
    throw new Error("Heavy locks require an absolute native Linux path.");
  const file = await open(
    path,
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  let library:
    | ReturnType<
        typeof dlopen<{
          flock: { args: ["i32", "i32"]; returns: "i32" };
          __errno_location: { args: []; returns: "ptr" };
        }>
      >
    | undefined;
  try {
    if (!(await file.stat()).isFile())
      throw new Error("Invalid shared heavy-lock file.");
    library = dlopen("libc.so.6", {
      flock: { args: ["i32", "i32"], returns: "i32" },
      __errno_location: { args: [], returns: "ptr" },
    });
    const fd = file.fd;
    const result = library.symbols.flock(fd, 2 | 4);
    if (result !== 0) {
      // Read thread-local errno immediately, before asynchronous cleanup changes it.
      const pointer = library.symbols.__errno_location();
      const errno = pointer ? read.i32(pointer) : undefined;
      const errors: Record<number, string> = {
        4: "EINTR",
        9: "EBADF",
        11: "EAGAIN/EWOULDBLOCK",
        22: "EINVAL",
        37: "ENOLCK",
      };
      const name =
        errno === undefined ? "unavailable" : (errors[errno] ?? "unknown");
      throw new Error(
        `Shared heavy lock acquisition failed: flock(fd=${fd}, operation=6)=${result}; errno=${errno ?? "unavailable"} (${name}); path=${path}. Lock preserved; no retry or takeover.`,
      );
    }
  } catch (error) {
    library?.close();
    await file.close();
    throw error;
  }
  const ownedLibrary = library;
  let released = false;
  const owner: ArchHeavyLock = {
    path,
    async release() {
      if (released) return;
      released = true;
      try {
        await file.close();
      } finally {
        ownedLibrary.close();
        retainedHeavyLocks.delete(path);
      }
    },
    retain() {
      if (!released) retainedHeavyLocks.set(path, owner);
    },
  };
  return owner;
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
function packageFilename(pkg: ArchPackage): string {
  return pkg.sha256 + ".pkg.tar." + new URL(pkg.url).pathname.split(".").at(-1);
}
function factoryEnv(job: string) {
  return {
    PATH: Bun.env.PATH,
    LANG: "C",
    LC_ALL: "C",
    HOME: join(job, "home"),
    TMPDIR: join(job, "tmp"),
    DOCKER_CONFIG: join(job, "docker-config"),
  };
}
async function artifactProof(job: string, path: string, signal: AbortSignal) {
  const state = await lstat(path);
  if (!state.isFile() || state.isSymbolicLink() || !state.size)
    throw new Error("Missing or invalid Arch output artifact.");
  inside(job, await realpath(path));
  return {
    path,
    bytes: state.size,
    sha256: await hashFile(path, { signal, expectedBytes: state.size }),
  };
}

async function download(
  url: string,
  destination: string,
  expectedHash: string,
  expectedBytes: number | undefined,
  signal: AbortSignal,
) {
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(https(url), {
      signal,
      redirect: "manual",
      credentials: "omit",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 5)
      throw new Error("Artifact redirect limit exceeded.");
    url = https(new URL(location, url).href);
  }
  if (!response?.ok || !response.body)
    throw new Error("Arch artifact download failed.");
  const file = await open(destination, "wx", 0o600);
  try {
    const output = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        async transform(chunk, controller) {
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await file.write(chunk.subarray(offset));
            if (!bytesWritten)
              throw new Error("Artifact write made no progress.");
            offset += bytesWritten;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    const actual = await hashStream(output, {
      signal,
      maxBytes: expectedBytes ?? 1048576,
      expectedBytes,
    });
    if (actual !== expectedHash)
      throw new Error(
        "Downloaded Arch artifact SHA-256 differs from its lock.",
      );
    await file.sync();
  } finally {
    await file.close();
  }
}

function installer(lock: ArchPackageLock): string {
  return `#!/bin/bash
set -euo pipefail
export LC_ALL=C HOME="$1/home" GNUPGHOME="$1/gnupg" SYSTEMD_OFFLINE=1
job="$1"
cache="$2"
output_uid="$3"
output_gid="$4"
[[ "$output_uid" =~ ^[0-9]+$ && "$output_gid" =~ ^[0-9]+$ ]]
mkdir -p "$job/home" "$job/gnupg" "$job/rootfs/var/lib/pacman" "$job/rootfs/var/log" "$job/rootfs/dev"
mknod -m 666 "$job/rootfs/dev/null" c 1 3
mknod -m 666 "$job/rootfs/dev/zero" c 1 5
mknod -m 666 "$job/rootfs/dev/random" c 1 8
mknod -m 666 "$job/rootfs/dev/urandom" c 1 9
chmod 700 "$job/gnupg"
sha256sum --check "$job/hashes.txt"
pacman-key --gpgdir "$job/gnupg" --init
pacman-key --gpgdir "$job/gnupg" --populate archlinux
${lock.packages
  .map((pkg) => {
    const file = packageFilename(pkg);
    return `gpg --homedir "$job/gnupg" --batch --status-fd 1 --verify "$job/packages/${file}.sig" "$job/packages/${file}" > "$job/signatures/${pkg.sha256}.status"
awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $3; if (NF >= 12) print $12 }' "$job/signatures/${pkg.sha256}.status" | grep -F -x -f "$job/approved-signers.txt" > "$job/signatures/${pkg.sha256}.approved"
[ "$(pacman --config "$job/pacman.conf" --gpgdir "$job/gnupg" -Qp "$job/packages/${file}")" = ${quote(pkg.name + " " + pkg.version)} ]`;
  })
  .join("\n")}
pacman --config "$job/pacman.conf" --root "$job/rootfs" --dbpath "$job/rootfs/var/lib/pacman" --gpgdir "$job/gnupg" --cachedir "$cache" --logfile "$job/pacman.log" -U --noconfirm ${lock.packages.map((pkg) => `"$job/packages/${packageFilename(pkg)}"`).join(" ")}
pacman --config "$job/pacman.conf" --root "$job/rootfs" --dbpath "$job/rootfs/var/lib/pacman" -Q | LC_ALL=C sort > "$job/inventory.txt"
diff -u "$job/expected-inventory.txt" "$job/inventory.txt"
pacman --config "$job/pacman.conf" --root "$job/rootfs" --dbpath "$job/rootfs/var/lib/pacman" -Qi > "$job/package-info.txt"
pacman --version > "$job/pacman-version.txt"
gpg --version > "$job/gpg-version.txt"
tar --numeric-owner --xattrs --acls -cpf "$job/rootfs.tar" -C "$job/rootfs" .
for output in rootfs.tar inventory.txt package-info.txt; do
  [[ -f "$job/$output" && ! -L "$job/$output" ]]
  chown --no-dereference -- "$output_uid:$output_gid" "$job/$output"
done
`;
}

export async function buildArchRootfs(
  options: ArchFactoryOptions,
): Promise<ArchRootfsReceipt> {
  const profile =
    options.profile ??
    ((await Bun.file(
      resolve(import.meta.dir, "..", "profile.json"),
    ).json()) as ArchFactoryProfile);
  if (options.lock.desktopSession) {
    const session = profile.desktopSessions?.[options.lock.desktopSession];
    if (!session)
      throw new Error(
        "The selected desktop session is absent from the qualified profile contract.",
      );
    if (session.state === "blocked")
      throw new Error(
        `The selected desktop session is blocked: ${(session.blockers ?? []).join(" ")}`,
      );
  }
  if (
    !profile.sharedHeavyLockRelative ||
    isAbsolute(profile.sharedHeavyLockRelative)
  )
    throw new Error("Invalid shared heavy lock configuration.");
  positive(profile.commandTimeoutSeconds, 43200);
  const plan = planArchFactory({ ...options, profile });
  if (
    process.platform !== "linux" ||
    (options.executor === "native" && process.arch !== "x64")
  )
    throw new Error(
      "Execute Arch builds on a qualified native Linux host; Windows supports planning only. No WSL is started.",
    );
  const outputUid = process.getuid?.();
  const outputGid = process.getgid?.();
  if (
    outputUid === undefined ||
    outputGid === undefined ||
    !Number.isSafeInteger(outputUid) ||
    !Number.isSafeInteger(outputGid) ||
    outputUid < 0 ||
    outputGid < 0 ||
    outputUid > 4294967295 ||
    outputGid > 4294967295
  )
    throw new Error("Expected numeric native host output ownership.");
  const root = safeRoot(await realpath(plan.root));
  const heavyLock = resolve(root, profile.sharedHeavyLockRelative);
  if (
    !(await lstat(dirname(heavyLock))).isDirectory() ||
    (await lstat(dirname(heavyLock))).isSymbolicLink()
  )
    throw new Error(
      "The shared heavy-lock directory must already be provisioned.",
    );
  try {
    if ((await lstat(heavyLock)).isSymbolicLink())
      throw new Error("Invalid shared heavy lock.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const space = await statfs(root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(plan.minimumFreeBytes))
    throw new Error("Insufficient free factory storage.");
  const factoryLockPath = join(root, ".factory.lock");
  const factoryLock = await open(factoryLockPath, "wx", 0o600);
  const token = crypto.randomUUID();
  let job: string | undefined;
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Arch factory job deadline exceeded.")),
    plan.timeoutMs,
  );
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let containerMayExist = false;
  let cleanupFailed = false;
  let heavy: ArchHeavyLock | undefined;
  const container = "bun-os-arch-" + token;
  const deadline = Date.now() + plan.timeoutMs;
  try {
    await factoryLock.writeFile(
      JSON.stringify({
        token,
        pid: process.pid,
        action: "arch-rootfs",
        startedAt,
      }) + "\n",
    );
    heavy = await acquireArchHeavyLock(heavyLock);
    const jobs = await directory(root, join(root, "arch-jobs"));
    const cache = await directory(root, join(root, "cache", "arch-packages"));
    job = inside(
      root,
      join(jobs, startedAt.replace(/[:.]/g, "") + "-" + token),
    );
    await mkdir(job, { mode: 0o700 });
    for (const path of [
      "packages",
      "logs",
      "signatures",
      "tmp",
      "docker-config",
    ])
      await mkdir(join(job, path));
    const selectedJob = job;
    const execute = async (
      argv: string[],
      step: string,
      signal: AbortSignal | undefined = controller.signal,
      timeout = Math.min(
        profile.commandTimeoutSeconds * 1000,
        deadline - Date.now(),
      ),
    ) => {
      const out = await open(join(selectedJob, "logs", step + ".stdout"), "wx");
      const err = await open(join(selectedJob, "logs", step + ".stderr"), "wx");
      try {
        const result = await runProcess(argv, selectedJob, {
          timeoutMs: Math.max(1, timeout),
          maxOutputBytes: 128 * 1024 ** 2,
          signal,
          stdout: "discard",
          stderr: "discard",
          env: factoryEnv(selectedJob),
          onOutput: async (channel, bytes) => {
            const log = channel === "stdout" ? out : err;
            let offset = 0;
            while (offset < bytes.length) {
              const written = await log.write(bytes.subarray(offset));
              if (!written.bytesWritten)
                throw new Error("Log write made no progress.");
              offset += written.bytesWritten;
            }
          },
          onStart: async (pid) => {
            await Bun.write(
              join(selectedJob, "status.json"),
              JSON.stringify({ status: "running", step, pid, token }) + "\n",
            );
          },
        });
        if (result.code !== 0)
          throw new Error(
            `Arch factory ${step} failed (${result.code}); inspect the owned job logs.`,
          );
      } finally {
        await Promise.all([out.close(), err.close()]);
      }
    };
    await Bun.write(
      join(job, "lock.json"),
      JSON.stringify(plan.lock, null, 2) + "\n",
    );
    await Bun.write(
      join(job, "approved-signers.txt"),
      plan.lock.approvedSigners.join("\n") + "\n",
    );
    await Bun.write(
      join(job, "expected-inventory.txt"),
      plan.lock.packages
        .map((pkg) => pkg.name + " " + pkg.version)
        .sort()
        .join("\n") + "\n",
    );
    await Bun.write(
      join(job, "pacman.conf"),
      "[options]\nArchitecture = x86_64\nSigLevel = Required DatabaseOptional TrustedOnly\nLocalFileSigLevel = Required TrustedOnly\n",
    );
    const hashes: string[] = [];
    for (const pkg of plan.lock.packages) {
      for (const signature of [false, true]) {
        controller.signal.throwIfAborted();
        const sha256 = signature ? pkg.signatureSha256 : pkg.sha256;
        const bytes = signature ? undefined : pkg.bytes;
        const destination = join(
          job,
          "packages",
          packageFilename(pkg) + (signature ? ".sig" : ""),
        );
        const cached = join(cache, sha256);
        let exists = false;
        try {
          const state = await lstat(cached);
          if (!state.isFile() || state.isSymbolicLink())
            throw new Error("Invalid cache object.");
          exists = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (exists) {
          if (
            (await hashFile(cached, {
              signal: controller.signal,
              maxBytes: bytes ?? 1048576,
              expectedBytes: bytes,
            })) !== sha256
          )
            throw new Error(
              "Existing cache object differs from its content identity; preserved without deletion.",
            );
          await copyFile(cached, destination, constants.COPYFILE_EXCL);
        } else {
          await download(
            signature ? pkg.signatureUrl : pkg.url,
            destination,
            sha256,
            bytes,
            controller.signal,
          );
          try {
            await copyFile(destination, cached, constants.COPYFILE_EXCL);
            await chmod(cached, 0o444);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
        hashes.push(
          sha256 +
            "  packages/" +
            packageFilename(pkg) +
            (signature ? ".sig" : ""),
        );
      }
    }
    await Bun.write(join(job, "hashes.txt"), hashes.join("\n") + "\n");
    await Bun.write(join(job, "execute.sh"), installer(plan.lock));
    const command =
      options.executor === "native"
        ? [
            "unshare",
            "--mount",
            "--propagation",
            "private",
            "--pid",
            "--fork",
            "--net",
            "--mount-proc",
            "bash",
            join(job, "execute.sh"),
            job,
            cache,
            String(outputUid),
            String(outputGid),
          ]
        : [
            "docker",
            "run",
            "--rm",
            "--pull=missing",
            "--name",
            container,
            "--label",
            "bun-os.arch-owner=" + token,
            "--platform",
            "linux/amd64",
            "--network",
            "none",
            "--read-only",
            "--cpus",
            "2",
            "--memory",
            "4g",
            "--pids-limit",
            "512",
            "--stop-timeout",
            "10",
            "--tmpfs",
            "/tmp",
            "--tmpfs",
            "/run",
            "--mount",
            `type=bind,src=${job},dst=/job`,
            "--mount",
            `type=bind,src=${cache},dst=/cache,readonly`,
            "--workdir",
            "/job",
            "--env",
            "SYSTEMD_OFFLINE=1",
            plan.lock.image,
            "/bin/bash",
            "/job/execute.sh",
            "/job",
            "/cache",
            String(outputUid),
            String(outputGid),
          ];
    if (job.includes(",") || cache.includes(","))
      throw new Error("Factory paths cannot contain Docker mount separators.");
    containerMayExist = options.executor === "docker";
    await execute(command, "rootfs", controller.signal);
    containerMayExist = false;
    const artifactPath = join(job, "rootfs.tar");
    const inventoryPath = join(job, "inventory.txt");
    const receipt: ArchRootfsReceipt = {
      schemaVersion: 2,
      kind: "bun-os-arch-rootfs",
      target: plan.lock.target,
      architecture: plan.lock.architecture,
      composition: plan.lock.composition,
      desktopSession: plan.lock.desktopSession,
      desktopSessionState: plan.lock.desktopSessionState,
      snapshot: plan.lock.snapshot,
      image: plan.lock.image,
      executor: options.executor,
      job,
      lockSha256: plan.lockSha256,
      artifact: await artifactProof(job, artifactPath, controller.signal),
      inventory: await artifactProof(job, inventoryPath, controller.signal),
      packages: plan.lock.packages,
      approvedSigners: plan.lock.approvedSigners,
      packageHashesVerified: true,
      packageSignaturesVerified: true,
      exactInventoryVerified: true,
      qualified: false,
      bootQualified: false,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await Bun.write(
      join(job, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    await Bun.write(
      join(job, "status.json"),
      JSON.stringify({
        status: "complete",
        token,
        kind: receipt.kind,
        bootQualified: false,
      }) + "\n",
    );
    return receipt;
  } catch (error) {
    if (job)
      await Bun.write(
        join(job, "status.json"),
        JSON.stringify({
          status: "failed",
          token,
          error: error instanceof Error ? error.message : "Arch factory failed",
          receipt: false,
        }) + "\n",
      );
    throw error;
  } finally {
    if (containerMayExist && job) {
      try {
        const found = await runProcess(
          [
            "docker",
            "inspect",
            "--format",
            '{{ index .Config.Labels "bun-os.arch-owner" }}',
            container,
          ],
          job,
          { timeoutMs: 15000, maxOutputBytes: 1048576, env: factoryEnv(job) },
        );
        if (found.code === 0) {
          if (found.stdout.trim() !== token) cleanupFailed = true;
          else {
            const removed = await runProcess(
              ["docker", "rm", "--force", container],
              job,
              {
                timeoutMs: 15000,
                maxOutputBytes: 1048576,
                env: factoryEnv(job),
              },
            );
            cleanupFailed = removed.code !== 0;
          }
        } else if (!found.stderr.includes("No such")) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await factoryLock.close();
    if (cleanupFailed) heavy?.retain();
    else await heavy?.release();
    if (
      !cleanupFailed &&
      (await Bun.file(factoryLockPath).json()).token === token
    )
      await unlink(factoryLockPath);
    if (cleanupFailed && job)
      await Bun.write(
        join(job, "cleanup-blocked.json"),
        JSON.stringify({
          token,
          factoryLockRetained: true,
          heavyLockRetained: true,
          reason:
            "Owned container cleanup could not be confirmed; preserve this job and owner process.",
        }) + "\n",
      );
  }
}
