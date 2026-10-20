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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  hashContent,
  hashFile,
} from "../../packages/bun-workspace/src/hash.ts";
import { runProcess } from "../../packages/bun-workspace/src/process.ts";
import {
  acquireArchHeavyLock,
  validateArchPackageLock,
  type ArchHeavyLock,
  type ArchPackage,
  type ArchPackageLock,
} from "./pacman.ts";
import type { DesktopSession } from "./index.ts";

export interface ResolveArchLockOptions {
  /** Existing absolute work directory of the selected Linux factory. */
  root: string;
  snapshot: string;
  composition: ArchPackageLock["composition"];
  desktopSession: DesktopSession | null;
  /** Package or group names; the empty installed database resolves their full closure. */
  packages: string[];
  image?: string;
  timeoutMs?: number;
}

export interface ResolvedArchLock {
  lock: ArchPackageLock;
  lockPath: string;
  job: string;
  receiptPath: string;
}

interface ResolveProfile {
  bootstrapImage: string;
  sharedHeavyLockRelative: string;
  minimumFreeBytes: number;
  commandTimeoutSeconds: number;
  jobDeadlineSeconds: number;
  desktopSessions: Record<
    DesktopSession,
    { state: "blocked" | "unqualified"; blockers: string[] }
  >;
}

interface Selection {
  name: string;
  version: string;
  url: string;
  bytes: number;
  filename: string;
}

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const imagePattern = /^archlinux(?::base-devel)?@sha256:[a-f0-9]{64}$/;
const namePattern = /^[a-z0-9][a-z0-9@._+-]{0,199}$/;

function positive(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("Invalid Arch resolution limit.");
  return value;
}

function inside(root: string, path: string): string {
  const part = relative(root, path);
  if (!part || part === ".." || part.startsWith(".." + sep) || isAbsolute(part))
    throw new Error("Arch resolver path escaped the factory owner.");
  return path;
}

async function directory(root: string, path: string): Promise<void> {
  inside(root, path);
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const state = await lstat(current);
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      (await realpath(current)) !== current
    )
      throw new Error("Arch resolver requires owned physical directories.");
  }
}

function parseSelection(
  text: string,
  snapshot: string,
  repositories: string[],
): Selection[] {
  const names = new Set<string>();
  const prefix = `https://archive.archlinux.org/repos/${snapshot.replaceAll("-", "/")}/`;
  const rows = text.trim().split(/\r?\n/);
  if (!rows.length || rows.length > 10000)
    throw new Error("Invalid Arch package closure size.");
  return rows.map((line) => {
    const match = /^([^/]+)\/([^/]+)\/(https:\/\/.+)\/(\d+)$/.exec(line);
    if (!match || !namePattern.test(match[1]!) || names.has(match[1]!))
      throw new Error("Invalid or duplicate resolved Arch package.");
    const [, name, version, address, size] = match;
    const url = new URL(address!);
    const suffix = address!.slice(prefix.length);
    const filename = url.pathname.split("/").at(-1)!;
    if (
      !address!.startsWith(prefix) ||
      !repositories.some((repository) =>
        suffix.startsWith(`${repository}/os/x86_64/`),
      ) ||
      url.href !== address ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-zA-Z0-9][a-zA-Z0-9@._+~%:-]*\.pkg\.tar\.(?:zst|xz|gz)$/.test(
        filename,
      ) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.:_+~-]{0,199}$/.test(version!)
    )
      throw new Error(
        "Resolved package is outside the selected official Arch archive snapshot.",
      );
    names.add(name!);
    return {
      name: name!,
      version: version!,
      url: address!,
      bytes: positive(Number(size), 16 * 1024 ** 3),
      filename,
    };
  });
}

function approvedSigner(status: string): string[] {
  if (
    /\[GNUPG:\] (?:BADSIG|ERRSIG|NO_PUBKEY|REVKEYSIG|EXPKEYSIG|EXPSIG|FAILURE)\b/.test(
      status,
    )
  )
    throw new Error("Arch detached package signature did not qualify.");
  if (!/\[GNUPG:\] TRUST_(?:FULLY|ULTIMATE)\b/.test(status))
    throw new Error(
      "Package signer is not trusted by the official Arch keyring.",
    );
  const fingerprints = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "[GNUPG:]" || fields[1] !== "VALIDSIG") continue;
    for (const value of [fields[2], fields[11]]) {
      if (value && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value))
        fingerprints.add(value.toUpperCase());
    }
  }
  if (!fingerprints.size)
    throw new Error(
      "Official Arch signature status contains no complete VALIDSIG fingerprint.",
    );
  return [...fingerprints];
}

function resolverScript(
  packages: string[],
  prefix: string,
  commandSeconds: number,
  uid: number,
  gid: number,
): string {
  return `#!/bin/bash
set -euo pipefail
export LC_ALL=C HOME=/job/home GNUPGHOME=/job/gnupg SYSTEMD_OFFLINE=1
umask 077
mkdir -p /job/home /job/gnupg /job/db/local /job/packages /job/signatures
handoff_outputs() {
  code=$?
  trap - EXIT
  for output in /job/selection.txt /job/pacman-version.txt /job/gpg-version.txt; do
    if [[ -f "$output" && ! -L "$output" ]]; then
      chown --no-dereference -- ${uid}:${gid} "$output" || code=1
    fi
  done
  find /job/packages /job/signatures -xdev -type f -exec chown --no-dereference -- ${uid}:${gid} {} + || code=1
  exit "$code"
}
trap handoff_outputs EXIT
pacman-key --gpgdir /job/gnupg --init
pacman-key --gpgdir /job/gnupg --populate archlinux
pacman --config /job/pacman.conf --dbpath /job/db --cachedir /job/packages --gpgdir /job/gnupg --logfile /job/pacman.log -Sy --noconfirm
pacman --config /job/pacman.conf --dbpath /job/db --cachedir /job/packages --gpgdir /job/gnupg --logfile /job/pacman.log -Sp --noconfirm --print-format '%n/%v/%l/%s' -- ${packages.map(quote).join(" ")} > /job/selection.txt
pacman --config /job/pacman.conf --dbpath /job/db --cachedir /job/packages --gpgdir /job/gnupg --logfile /job/pacman.log -Sw --noconfirm -- ${packages.map(quote).join(" ")}
count=0
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  count=$((count + 1))
  [[ "$count" -le 10000 ]]
  name="\${line%%/*}"
  tail="\${line#*/}"
  tail="\${tail#*/}"
  url="\${tail%/*}"
  [[ "$name" =~ ^[a-z0-9][a-z0-9@._+-]{0,199}$ ]]
  [[ "$url" == ${quote(prefix)}* ]]
  file="\${url##*/}"
  [[ "$file" =~ ^[a-zA-Z0-9][a-zA-Z0-9@._+~%:-]*\\.pkg\\.tar\\.(zst|xz|gz)$ ]]
  [[ -f "/job/packages/$file" && ! -L "/job/packages/$file" ]]
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time ${commandSeconds} --max-filesize 1048576 "$url.sig" --output "/job/packages/$file.sig"
  gpg --homedir /job/gnupg --batch --no-tty --no-auto-key-retrieve --no-auto-key-import --status-fd 1 --verify "/job/packages/$file.sig" "/job/packages/$file" > "/job/signatures/$name.status"
done < /job/selection.txt
[[ "$count" -gt 0 ]]
pacman --version > /job/pacman-version.txt
gpg --version > /job/gpg-version.txt
`;
}

/** Resolve/download in a disposable container; no host packages or PKGBUILDs are executed. */
export async function resolveArchLock(
  options: ResolveArchLockOptions,
): Promise<ResolvedArchLock> {
  if (process.platform !== "linux")
    throw new Error(
      "Arch resolution requires the selected Linux Docker factory; no WSL is started.",
    );
  if (!isAbsolute(options.root) || options.root.includes("\0"))
    throw new Error("An absolute existing factory root is required.");
  const requestedRoot = resolve(options.root);
  if (
    requestedRoot === dirname(requestedRoot) ||
    /(?:^|\/)(?:\.local|\.aphrody|\.codex|\.claude|cookies|sessions|datasets|databases|weights|models)(?:\/|$)/i.test(
      requestedRoot,
    )
  )
    throw new Error(
      "The resolver root must remain outside protected stores and filesystem roots.",
    );
  const rootState = await lstat(requestedRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink())
    throw new Error("The factory root must be a physical directory.");
  const root = await realpath(requestedRoot);
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (
    uid === undefined ||
    gid === undefined ||
    !Number.isSafeInteger(uid) ||
    !Number.isSafeInteger(gid) ||
    uid < 0 ||
    gid < 0
  )
    throw new Error(
      "The native Linux factory user and group must be available for artifact handoff.",
    );
  if (root !== requestedRoot)
    throw new Error(
      "Resolve the canonical factory root before package acquisition.",
    );
  const profile = (await Bun.file(
    resolve(import.meta.dir, "../profile.json"),
  ).json()) as ResolveProfile;
  const selectedImage = options.image ?? profile.bootstrapImage;
  if (
    !imagePattern.test(selectedImage) ||
    !imagePattern.test(profile.bootstrapImage) ||
    selectedImage.split("@sha256:")[1] !==
      profile.bootstrapImage.split("@sha256:")[1]
  )
    throw new Error(
      "The resolver requires the configured official Arch bootstrap image digest.",
    );
  const date = new Date(options.snapshot + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(options.snapshot) ||
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== options.snapshot
  )
    throw new Error("An immutable YYYY-MM-DD archive snapshot is required.");
  if (!["server", "desktop", "gaming"].includes(options.composition))
    throw new Error("Unknown Arch composition.");
  if (
    (options.desktopSession !== null &&
      options.desktopSession !== "cosmic" &&
      options.desktopSession !== "omarchy-hyprland") ||
    (options.composition === "desktop") !== (options.desktopSession !== null)
  )
    throw new Error(
      "Desktop session must be selected only for the desktop composition.",
    );
  const session = options.desktopSession
    ? profile.desktopSessions[options.desktopSession]
    : undefined;
  if (options.desktopSession && !session)
    throw new Error(
      "The selected desktop session is absent from the Arch profile contract.",
    );
  if (session?.state === "blocked")
    throw new Error(
      `The selected desktop session is blocked: ${session.blockers.join(" ")}`,
    );
  if (
    !Array.isArray(options.packages) ||
    !options.packages.length ||
    options.packages.length > 1000 ||
    options.packages.some((name) => !namePattern.test(name))
  )
    throw new Error("Select explicit Arch package or group names.");
  const packages = [...new Set(options.packages)];
  const timeoutMs = positive(
    options.timeoutMs ?? profile.jobDeadlineSeconds * 1000,
    43_200_000,
  );
  const commandSeconds = positive(profile.commandTimeoutSeconds, 43_200);
  positive(profile.minimumFreeBytes, Number.MAX_SAFE_INTEGER);
  if (
    !profile.sharedHeavyLockRelative ||
    isAbsolute(profile.sharedHeavyLockRelative) ||
    profile.sharedHeavyLockRelative.includes("\0")
  )
    throw new Error(
      "The shared heavy lock must be configured relative to the factory root.",
    );
  const heavyPath = resolve(root, profile.sharedHeavyLockRelative);
  const heavyDirectory = await lstat(dirname(heavyPath));
  if (!heavyDirectory.isDirectory() || heavyDirectory.isSymbolicLink())
    throw new Error(
      "The existing shared heavy-lock directory must be provisioned.",
    );
  const space = await statfs(root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(profile.minimumFreeBytes))
    throw new Error("Insufficient factory storage for Arch resolution.");
  const factoryLockPath = join(root, ".factory.lock");
  const factoryLock = await open(factoryLockPath, "wx", 0o600);
  const token = crypto.randomUUID();
  const container = `bun-os-arch-resolve-${token}`;
  const network = `bun-os-arch-resolve-network-${token}`;
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  let heavy: ArchHeavyLock | undefined;
  let job: string | undefined;
  let containerMayExist = false;
  let networkMayExist = false;
  let cleanupConfirmed = true;
  let dockerEnvironment: Record<string, string | undefined> | undefined;
  try {
    await factoryLock.writeFile(
      JSON.stringify({
        token,
        pid: process.pid,
        action: "arch-resolve",
        startedAt,
      }) + "\n",
    );
    heavy = await acquireArchHeavyLock(heavyPath);
    const jobs = join(root, "arch-resolve-jobs");
    await directory(root, jobs);
    const cache = join(root, "cache", "arch-packages");
    await directory(root, cache);
    job = inside(
      root,
      join(jobs, startedAt.replace(/[:.]/g, "") + "-" + token),
    );
    await mkdir(job, { mode: 0o700 });
    const selectedJob = job;
    for (const child of [
      "home",
      "tmp",
      "logs",
      "db",
      "packages",
      "signatures",
      "docker-config",
    ])
      await mkdir(join(job, child), { mode: 0o700 });
    if (job.includes(","))
      throw new Error("Factory paths cannot contain Docker mount separators.");
    const repositories =
      options.composition === "gaming"
        ? ["core", "extra", "multilib"]
        : ["core", "extra"];
    const prefix = `https://archive.archlinux.org/repos/${options.snapshot.replaceAll("-", "/")}/`;
    await Bun.write(
      join(job, "pacman.conf"),
      [
        "[options]",
        "Architecture = x86_64",
        "SigLevel = Required DatabaseOptional TrustedOnly",
        "LocalFileSigLevel = Required TrustedOnly",
        "GPGDir = /job/gnupg",
        ...repositories.flatMap((repository) => [
          `[${repository}]`,
          `Server = ${prefix}$repo/os/$arch`,
        ]),
        "",
      ].join("\n"),
    );
    await Bun.write(
      join(job, "resolve.sh"),
      resolverScript(packages, prefix, commandSeconds, uid, gid),
    );
    const environment = {
      PATH: Bun.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      HOME: join(job, "home"),
      TMPDIR: join(job, "tmp"),
      DOCKER_CONFIG: join(job, "docker-config"),
    };
    dockerEnvironment = environment;
    const execute = async (
      argv: string[],
      step: string,
      activeSignal?: AbortSignal,
      maximum = deadline - Date.now(),
    ) => {
      const out = await open(join(selectedJob, "logs", step + ".stdout"), "wx");
      const err = await open(join(selectedJob, "logs", step + ".stderr"), "wx");
      try {
        const result = await runProcess(argv, selectedJob, {
          timeoutMs: Math.max(1, maximum),
          maxOutputBytes: 64 * 1024 ** 2,
          signal: activeSignal,
          env: environment,
          stdout: "discard",
          stderr: "discard",
          onOutput: async (channel, bytes) => {
            const log = channel === "stdout" ? out : err;
            let offset = 0;
            while (offset < bytes.length) {
              const written = await log.write(bytes.subarray(offset));
              if (!written.bytesWritten)
                throw new Error("Resolver log write made no progress.");
              offset += written.bytesWritten;
            }
          },
          onStart: async (pid) => {
            await Bun.write(
              join(selectedJob, "status.json"),
              JSON.stringify({
                status: "running",
                step,
                token,
                pid,
                startedAt,
              }) + "\n",
            );
          },
        });
        if (result.code !== 0)
          throw new Error(
            `Arch resolver ${step} failed (${result.code}); inspect its owned logs.`,
          );
        return result;
      } finally {
        await Promise.all([out.close(), err.close()]);
      }
    };
    networkMayExist = true;
    await execute(
      [
        "docker",
        "network",
        "create",
        "--driver",
        "bridge",
        "--label",
        `bun-os.arch-owner=${token}`,
        network,
      ],
      "network-create",
      signal,
      Math.min(commandSeconds * 1000, deadline - Date.now()),
    );
    containerMayExist = true;
    await execute(
      [
        "docker",
        "run",
        "--rm",
        "--pull=missing",
        "--name",
        container,
        "--label",
        `bun-os.arch-owner=${token}`,
        "--platform",
        "linux/amd64",
        "--network",
        network,
        "--read-only",
        "--cpus",
        "2",
        "--memory",
        "4g",
        "--pids-limit",
        "512",
        "--tmpfs",
        "/tmp",
        "--tmpfs",
        "/run",
        "--mount",
        `type=bind,src=${job},dst=/job`,
        "--workdir",
        "/job",
        selectedImage,
        "/bin/bash",
        "/job/resolve.sh",
      ],
      "resolve",
      signal,
    );
    // A successful --rm exit establishes that this owned container is no longer running.
    containerMayExist = false;
    signal.throwIfAborted();
    const selectionFile = Bun.file(join(job, "selection.txt"));
    if (!(await selectionFile.exists()) || selectionFile.size > 8 * 1024 ** 2)
      throw new Error("Resolved package metadata exceeds its bound.");
    const selections = parseSelection(
      await selectionFile.text(),
      options.snapshot,
      repositories,
    );
    const approved = new Set<string>();
    const closure: ArchPackage[] = [];
    for (const selection of selections) {
      signal.throwIfAborted();
      const archive = join(job, "packages", selection.filename);
      const signature = archive + ".sig";
      const statusFile = join(job, "signatures", selection.name + ".status");
      for (const path of [archive, signature, statusFile]) {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink())
          throw new Error(
            "Expected a regular acquired package/signature record.",
          );
      }
      const status = Bun.file(statusFile);
      if (status.size > 65536)
        throw new Error("Signature status exceeds its metadata bound.");
      for (const signer of approvedSigner(await status.text()))
        approved.add(signer);
      const sha256 = await hashFile(archive, {
        signal,
        expectedBytes: selection.bytes,
        maxBytes: selection.bytes,
      });
      const signatureSha256 = await hashFile(signature, {
        signal,
        maxBytes: 1048576,
      });
      for (const object of [
        { source: archive, sha256, maximum: selection.bytes },
        { source: signature, sha256: signatureSha256, maximum: 1048576 },
      ]) {
        const destination = join(cache, object.sha256);
        try {
          await copyFile(object.source, destination, constants.COPYFILE_EXCL);
          await chmod(destination, 0o444);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const state = await lstat(destination);
        if (
          !state.isFile() ||
          state.isSymbolicLink() ||
          (await hashFile(destination, {
            signal,
            maxBytes: object.maximum,
          })) !== object.sha256
        )
          throw new Error(
            "Existing canonical Arch cache object differs from its identity; preserved.",
          );
      }
      closure.push({
        name: selection.name,
        version: selection.version,
        url: selection.url,
        bytes: selection.bytes,
        sha256,
        signatureUrl: selection.url + ".sig",
        signatureSha256,
      });
    }
    const lock = validateArchPackageLock({
      schemaVersion: 2,
      target: "linux-x64",
      architecture: "x86_64",
      snapshot: options.snapshot,
      composition: options.composition,
      desktopSession: options.desktopSession,
      desktopSessionState: session ? "unqualified" : "not-applicable",
      image: selectedImage,
      packages: closure.sort((a, b) => a.name.localeCompare(b.name)),
      approvedSigners: [...approved].sort(),
    });
    const lockPath = join(job, "package-lock.json");
    const receiptPath = join(job, "receipt.json");
    await Bun.write(lockPath, JSON.stringify(lock, null, 2) + "\n");
    await Bun.write(
      receiptPath,
      JSON.stringify(
        {
          schemaVersion: 2,
          kind: "bun-os-arch-package-resolution",
          job,
          lockPath,
          lockSha256: hashContent(JSON.stringify(lock)),
          lockFileSha256: await hashFile(lockPath, { signal }),
          cache,
          snapshot: options.snapshot,
          composition: options.composition,
          desktopSession: options.desktopSession,
          desktopSessionState: session?.state ?? "not-applicable",
          image: selectedImage,
          requestedPackages: packages,
          repositories,
          packageCount: lock.packages.length,
          approvedSigners: lock.approvedSigners,
          emptyInstalledDatabase: true,
          packageSignaturesVerified: true,
          packageHashesRecorded: true,
          hostPackagesInstalled: false,
          rootfsBuilt: false,
          qualified: false,
          startedAt,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    await Bun.write(
      join(job, "status.json"),
      JSON.stringify({ status: "complete", token, lockPath, receiptPath }) +
        "\n",
    );
    return { lock, lockPath, job, receiptPath };
  } catch (error) {
    if (job)
      await Bun.write(
        join(job, "status.json"),
        JSON.stringify({
          status: "failed",
          token,
          receipt: false,
          error:
            error instanceof Error ? error.message : "Arch resolution failed",
        }) + "\n",
      );
    throw error;
  } finally {
    await cleanup();
  }

  async function cleanup(): Promise<void> {
    if (containerMayExist && job) {
      cleanupConfirmed = false;
      try {
        const inspect = await runProcess(
          [
            "docker",
            "inspect",
            "--format",
            '{{ index .Config.Labels "bun-os.arch-owner" }}',
            container,
          ],
          job,
          { timeoutMs: 15000, maxOutputBytes: 1048576, env: dockerEnvironment },
        );
        if (inspect.code === 0) {
          if (inspect.stdout.trim() !== token)
            throw new Error("Resolver container ownership changed.");
          const removed = await runProcess(
            ["docker", "rm", "--force", container],
            job,
            {
              timeoutMs: 15000,
              maxOutputBytes: 1048576,
              env: dockerEnvironment,
            },
          );
          if (removed.code !== 0)
            throw new Error("Owned resolver container cleanup failed.");
          cleanupConfirmed = true;
        } else if (/No such (?:object|container)/i.test(inspect.stderr))
          cleanupConfirmed = true;
      } catch {
        // Uncertain ownership retains both admission locks and the complete job.
      }
    }
    if (networkMayExist && cleanupConfirmed && job) {
      cleanupConfirmed = false;
      try {
        const inspect = await runProcess(
          [
            "docker",
            "network",
            "inspect",
            "--format",
            '{{ index .Labels "bun-os.arch-owner" }}',
            network,
          ],
          job,
          { timeoutMs: 15000, maxOutputBytes: 1048576, env: dockerEnvironment },
        );
        if (inspect.code === 0 && inspect.stdout.trim() === token) {
          const removed = await runProcess(
            ["docker", "network", "rm", network],
            job,
            {
              timeoutMs: 15000,
              maxOutputBytes: 1048576,
              env: dockerEnvironment,
            },
          );
          cleanupConfirmed = removed.code === 0;
        } else if (
          inspect.code !== 0 &&
          /No such network|network .+ not found/i.test(inspect.stderr)
        )
          cleanupConfirmed = true;
      } catch {
        // Keep both admission locks when this owned bridge cannot be accounted for.
      }
    }
    if (cleanupConfirmed) {
      await heavy?.release();
      await factoryLock.close();
      const current: unknown = await Bun.file(factoryLockPath).json();
      if (
        current &&
        typeof current === "object" &&
        "token" in current &&
        current.token === token
      )
        await unlink(factoryLockPath);
      else
        throw new Error("Resolver factory lock ownership changed; preserved.");
    } else {
      heavy?.retain();
      await factoryLock.close();
      throw new Error(
        "Resolver container/network cleanup is unconfirmed; both admission locks and job were retained.",
      );
    }
  }
}
