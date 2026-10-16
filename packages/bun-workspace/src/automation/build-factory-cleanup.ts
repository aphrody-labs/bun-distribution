// SPDX-License-Identifier: Apache-2.0
import { posix } from "node:path";
import { readFileSync, statSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import type { BuildFactoryConfig } from "./build-factory.ts";

export interface FactoryCleanupPolicy {
  transientRoot: string;
  privilegeBinary?: "/usr/bin/sudo-rs" | "/usr/bin/sudo";
  retiredOutputs: { path: string; terminalReceipt: string; reason: string }[];
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

export function validateFactoryCleanup(config: BuildFactoryConfig, policy: FactoryCleanupPolicy) {
  const base = posix.dirname(config.cacheRoot);
  if (policy.privilegeBinary && !["/usr/bin/sudo-rs", "/usr/bin/sudo"].includes(policy.privilegeBinary))
    throw new Error("Factory privilege binary must be a declared installed sudo owner");
  if (policy.transientRoot !== posix.join(base, "transient"))
    throw new Error("The factory has one declared transient resource below its root");
  for (const entry of policy.retiredOutputs) {
    const name = posix.relative(posix.join(config.cacheRoot, "cargo"), entry.path);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) || posix.normalize(entry.path) !== entry.path)
      throw new Error("Cleanup accepts only explicitly retired Cargo intermediate target directories");
    if (Object.values(config.repositories).some(source => overlaps(source, entry.path)))
      throw new Error("Factory source checkouts are preserved");
    if (
      !entry.terminalReceipt.startsWith(base + "/") ||
      posix.normalize(entry.terminalReceipt) !== entry.terminalReceipt
    )
      throw new Error("Terminal evidence must remain inside the declared factory");
  }
}

/** Match a path token or descendant, never another directory with the same prefix. */
export function factoryPathReferenced(value: string, path: string): boolean {
  let index = -1;
  while ((index = value.indexOf(path, index + 1)) !== -1) {
    const before = value[index - 1];
    const after = value[index + path.length];
    if ((before === undefined || /[=\s'";,:([{]/.test(before)) && (after === undefined || /[/\s'";,:)\]}]/.test(after)))
      return true;
  }
  return false;
}

/** Runs on the native Infra transport; no protected stores, retained artifacts or compiler caches are removed. */
export function factoryCleanupScript(config: BuildFactoryConfig, policy: FactoryCleanupPolicy, apply: boolean) {
  validateFactoryCleanup(config, policy);
  const input = { policy, apply };
  const program = String.raw`
import { readdirSync, readFileSync, readlinkSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const input = JSON.parse(process.argv[1]);
const pathReferenced = ${factoryPathReferenced.toString()};
const ancestors = new Set([process.pid]);
let parent = process.ppid;
while (parent > 1 && !ancestors.has(parent)) {
  ancestors.add(parent);
  try { parent = Number(readFileSync("/proc/" + parent + "/stat", "utf8").split(") ")[1].split(" ")[1]); }
  catch { break; }
}
function terminal(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Terminal evidence is not a regular file");
  const text = readFileSync(path, "utf8").trim();
  if (/^\d+$/.test(text)) {
    if (Number(text) > 255) throw new Error("Invalid terminal exit code");
    return;
  }
  const receipt = JSON.parse(text);
  if (!Number.isFinite(Date.parse(receipt.finishedAt)) ||
      !(typeof receipt.exitCode === "number" || typeof receipt.ok === "boolean"))
    throw new Error("No verified terminal receipt");
}
function processUse(path) {
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || ancestors.has(Number(name))) continue;
    const root = "/proc/" + name;
    const matches = (value) => value === path || value.startsWith(path + "/");
    try {
      for (const part of ["cwd", "exe"]) {
        try { if (matches(readlinkSync(join(root, part)))) return Number(name); }
        catch (error) { if (! ["ENOENT", "ESRCH"].includes(error.code)) throw error; }
      }
      // A queued owner command can name its target before opening any output: retain it too.
      for (const file of ["cmdline", "environ"]) {
        if (readFileSync(join(root, file), "utf8").split("\0").some((value) => pathReferenced(value, path))) return Number(name);
      }
      for (const fd of readdirSync(join(root, "fd"))) {
        try { if (matches(readlinkSync(join(root, "fd", fd)))) return Number(name); }
        catch (error) { if (! ["ENOENT", "ESRCH", "EINVAL"].includes(error.code)) throw error; }
      }
    } catch (error) {
      if (! ["ENOENT", "ESRCH"].includes(error.code)) throw new Error("Cannot prove process isolation");
    }
  }
  return null;
}
const results = [];
for (const entry of input.policy.retiredOutputs) {
  try {
    const stat = lstatSync(entry.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(entry.path) !== entry.path)
      throw new Error("Output path is not a canonical directory");
    for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
      const mount = line.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
      if (mount === entry.path || mount?.startsWith(entry.path + "/"))
        throw new Error("A mounted filesystem is protected inside this output");
    }
    terminal(entry.terminalReceipt);
    const pid = processUse(entry.path);
    if (pid) { results.push({ path: entry.path, status: "active", pid }); continue; }
    // Docker bind mounts are independent live users even with no host cwd in this directory.
    const ids = execFileSync("docker", ["ps", "-q"], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
    if (ids.length) {
      const containers = JSON.parse(execFileSync("docker", ["inspect", ...ids], { encoding: "utf8" }));
      if (containers.some((container) => container.Mounts.some((mount) =>
          mount.Source === entry.path || mount.Source.startsWith(entry.path + "/") || entry.path.startsWith(mount.Source + "/"))))
        throw new Error("A running container uses this output");
    }
    const allocatedBytes = Number(execFileSync("du", ["-s", "-B1", "--", entry.path], { encoding: "utf8" }).split(/\s+/)[0]);
    // Recheck immediately before apply: read-only observations never authorize removal of a newly active owner.
    const latest = processUse(entry.path);
    if (latest) { results.push({ path: entry.path, status: "active", pid: latest }); continue; }
    if (input.apply) rmSync(entry.path, { recursive: true });
    results.push({ path: entry.path, status: input.apply ? "removed" : "planned", allocatedBytes });
  } catch (error) {
    if (error.code === "ENOENT") results.push({ path: entry.path, status: "absent" });
    else results.push({ path: entry.path, status: "preserved", reason: error.message });
  }
}
console.log(JSON.stringify({ schema: "aphrody.factory-cleanup/1", apply: input.apply, results }));
`;
  // Privilege is needed to inspect every /proc fd and Docker mount; inability to inspect fails closed.
  const command = `${quote(policy.privilegeBinary ?? "/usr/bin/sudo-rs")} -n "$HOME/.bun/bin/bun" -e ${quote(program)} -- ${quote(JSON.stringify(input))}`;
  return apply ? `flock --exclusive --timeout 1800 ${quote(config.lockPath)} sh -c ${quote(command)}` : command;
}

/** Called only inside the existing factory heavy lock; the directory persists, its temporary contents do not. */
export function factoryTransientShell(
  root: string,
  dockerBinary = "docker",
  lockPath = posix.join(posix.dirname(root), "locks/heavy.lock"),
  sudoBinary = "/usr/bin/sudo-rs",
  leaseSupervisor?: number,
) {
  if (!root.startsWith("/") || posix.normalize(root) !== root || !root.endsWith("/transient"))
    throw new Error("Invalid factory transient root");
  const cleanup = String.raw`
import { readdirSync, readlinkSync, readFileSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const root = process.argv[1];
const pathReferenced = ${factoryPathReferenced.toString()};
for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
  const mount = line.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  if (mount === root || mount?.startsWith(root + "/")) throw new Error("Factory transient mount preserved");
}
const ancestors = new Set([process.pid]);
let parent = process.ppid;
while (parent > 1 && !ancestors.has(parent)) {
  ancestors.add(parent);
  try { parent = Number(readFileSync("/proc/" + parent + "/stat", "utf8").split(") ")[1].split(" ")[1]); }
  catch { break; }
}
const leaseOwner = Number(process.argv[4]);
let lockIdentity;
try { if (process.argv[3]) lockIdentity = statSync(process.argv[3], { bigint: true }); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const lockLines = readFileSync("/proc/locks", "utf8").split("\n");
function matchesLock(fields) {
  const index = fields.indexOf("FLOCK");
  if (!lockIdentity || index < 0 || fields[index + 2] !== "WRITE") return false;
  const major = ((lockIdentity.dev >> 8n) & 0xfffn) | ((lockIdentity.dev >> 32n) & 0xfffff000n);
  const minor = (lockIdentity.dev & 0xffn) | ((lockIdentity.dev >> 12n) & 0xffffff00n);
  const [lockMajor, lockMinor, inode] = fields[index + 4].split(":");
  return inode === String(lockIdentity.ino) && BigInt("0x" + lockMajor) === major && BigInt("0x" + lockMinor) === minor;
}
const leaseStat = leaseOwner && lockLines.some(line => {
  const fields = line.trim().split(/\s+/);
  return !fields.includes("->") && Number(fields[fields.indexOf("FLOCK") + 3]) === leaseOwner && matchesLock(fields);
});
const queuedOwners = new Set();
for (const line of lockLines) {
  const fields = line.trim().split(/\s+/);
  if (!fields.includes("->") || !matchesLock(fields)) continue;
  let pid = Number(fields[fields.indexOf("FLOCK") + 3]);
  while (pid > 1 && !queuedOwners.has(pid)) {
    queuedOwners.add(pid);
    try { pid = Number(readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" ")[1]); }
    catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; break; }
  }
}
for (const pid of readdirSync("/proc")) {
  if (!/^\d+$/.test(pid) || ancestors.has(Number(pid))) continue;
  // The direct-route guardian only holds the lease and waits on its control pipe.
  // Its command includes the cleanup script, so ignore it only after kernel ownership proof.
  if (leaseStat) {
    try {
      const parent = Number(readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" ")[1]);
      if (Number(pid) === leaseOwner || parent === leaseOwner) continue;
    } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  }
  try {
    for (const file of queuedOwners.has(Number(pid)) ? [] : ["cmdline", "environ"]) {
      if (readFileSync("/proc/" + pid + "/" + file, "utf8").split("\0").some(value => pathReferenced(value, root))) {
        console.error("Factory transient resource retained for live process " + pid); process.exit(3);
      }
    }
    const links = ["cwd", "exe", ...readdirSync("/proc/" + pid + "/fd").map(fd => "fd/" + fd)];
    for (const link of links) {
      try {
        const path = readlinkSync("/proc/" + pid + "/" + link);
        if (path === root || path.startsWith(root + "/")) {
          console.error("Factory transient resource retained for live process " + pid);
          process.exit(3);
        }
      } catch (error) { if (!["ENOENT", "ESRCH", "EINVAL"].includes(error.code)) throw error; }
    }
  } catch(error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
}
const ids = execFileSync(process.argv[2], ["ps", "-q"], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
if (ids.length) {
  const containers = JSON.parse(execFileSync(process.argv[2], ["inspect", ...ids], { encoding: "utf8" }));
  if (containers.some(container => container.Mounts.some(mount => mount.Source === root || mount.Source.startsWith(root + "/") || root.startsWith(mount.Source + "/"))))
    throw new Error("Factory transient container mount preserved");
}
for (const entry of readdirSync(root)) rmSync(root + "/" + entry, { recursive: true });
`;
  return [
    `test ! -L ${quote(root)} || { echo 'Factory transient root is a symlink; preserved' >&2; exit 2; }`,
    `if test ! -d ${quote(root)}; then ${quote(sudoBinary)} -n install -d -m 0700 -o "$(id -u)" -g "$(id -g)" -- ${quote(root)}; fi`,
    `test "$(realpath -e -- ${quote(root)})" = ${quote(root)} || exit 2`,
    `${quote(sudoBinary)} -n "$HOME/.bun/bin/bun" -e ${quote(cleanup)} -- ${quote(root)} ${quote(dockerBinary)} ${quote(lockPath)} ${quote(String(leaseSupervisor ?? ""))} || exit 3`,
    `export TMPDIR=${quote(root)}`,
    `export APHRODY_FACTORY_RESOURCE=${quote(root)}`,
    `export APHRODY_FACTORY_LOCK_PATH=${quote(lockPath)}`,
    // A background child can outlive a foreground command: refuse cleanup of any live cwd/exe/fd.
    // KILL or an unobservable process retains temporary contents for a later qualified cleanup.
    `factory_cleanup() { factory_status=$?; ${quote(sudoBinary)} -n "$HOME/.bun/bin/bun" -e ${quote(cleanup)} -- ${quote(root)} ${quote(dockerBinary)} ${quote(lockPath)} ${quote(String(leaseSupervisor ?? ""))} || echo 'Factory temporary contents preserved; cleanup not qualified' >&2; exit "$factory_status"; }`,
    "trap factory_cleanup EXIT",
    "trap 'exit 143' TERM",
    "trap 'exit 130' INT",
  ];
}

const localLeases = new Map<string, number>();

/** A direct-route guardian is a sibling of build children, supervised by their Bun ancestor. */
function supervisedFactoryGuardian(owner: number, lockPath: string, ancestors: Set<number>): boolean {
  const fields = readFileSync(`/proc/${owner}/stat`, "utf8").split(") ")[1]?.split(" ");
  const supervisor = Number(fields?.[1]);
  if (!ancestors.has(supervisor)) return false;
  const uid = process.getuid?.();
  if (uid === undefined || statSync(`/proc/${owner}`).uid !== uid || statSync(`/proc/${supervisor}`).uid !== uid)
    return false;
  const executable = statSync(`/proc/${supervisor}/exe`, { bigint: true });
  const currentExecutable = statSync(`/proc/self/exe`, { bigint: true });
  if (executable.dev !== currentExecutable.dev || executable.ino !== currentExecutable.ino) return false;
  const args = readFileSync(`/proc/${owner}/cmdline`, "utf8").split("\0").filter(Boolean);
  return (
    posix.basename(args[0] ?? "") === "flock" &&
    args[1] === "--exclusive" &&
    args[2] === "--close" &&
    args[3] === "--timeout" &&
    args[4] === "1800" &&
    args[5] === lockPath &&
    args[6] === "bash" &&
    args[7] === "-c" &&
    args[8] ===
      'printf READY; action=$(cat); if [ "$action" = ABORT ]; then exit 0; fi; until bash -c "$1"; do sleep 1; done' &&
    args[9] === "factory-guardian" &&
    args.length === 11
  );
}

/** A marker alone cannot bypass serialization: match the kernel lease to its actual inode and owner. */
export function factoryLeaseHeld(lockPath: string, directOwner?: number): boolean {
  try {
    const stat = statSync(lockPath, { bigint: true });
    // Linux encodes major/minor device numbers in dev_t, while /proc/locks prints them in hex.
    const major = ((stat.dev >> 8n) & 0xfffn) | ((stat.dev >> 32n) & 0xfffff000n);
    const minor = (stat.dev & 0xffn) | ((stat.dev >> 12n) & 0xffffff00n);
    const ancestors = new Set<number>([process.pid]);
    let parent = process.ppid;
    while (parent > 1 && !ancestors.has(parent)) {
      ancestors.add(parent);
      const fields = readFileSync(`/proc/${parent}/stat`, "utf8").split(") ")[1]?.split(" ");
      parent = Number(fields?.[1]);
    }
    return readFileSync("/proc/locks", "utf8")
      .split("\n")
      .some(line => {
        const fields = line.trim().split(/\s+/);
        if (fields[1] !== "FLOCK" || fields[3] !== "WRITE") return false;
        const owner = Number(fields[4]);
        const [lockMajor, lockMinor, inode] = fields[5]?.split(":") ?? [];
        return (
          inode === String(stat.ino) &&
          BigInt(`0x${lockMajor}`) === major &&
          BigInt(`0x${lockMinor}`) === minor &&
          (ancestors.has(owner) || owner === directOwner || supervisedFactoryGuardian(owner, lockPath, ancestors))
        );
      });
  } catch {
    return false;
  }
}

export function inheritedFactoryResourceHeld(config?: BuildFactoryConfig): boolean {
  const root = process.env.APHRODY_FACTORY_RESOURCE;
  const lock = process.env.APHRODY_FACTORY_LOCK_PATH;
  let declaredLayout = false;
  if (config?.cleanup) {
    validateFactoryCleanup(config, config.cleanup);
    declaredLayout = config.cleanup.transientRoot === root && config.lockPath === lock;
  }
  return (
    !!root &&
    !!lock &&
    posix.isAbsolute(root) &&
    posix.normalize(root) === root &&
    root.endsWith("/transient") &&
    (declaredLayout || lock === posix.join(posix.dirname(root), "locks/heavy.lock")) &&
    factoryLeaseHeld(lock)
  );
}

/** Factory-host direct routes reuse the same OS lease; local diagnostics retain their own host policy. */
export async function withFactoryResource<T>(
  config: BuildFactoryConfig,
  body: () => Promise<T>,
  dockerBinary = Bun.which("docker") ?? "docker",
): Promise<T> {
  if (!config.cleanup) return body();
  validateFactoryCleanup(config, config.cleanup);
  const root = config.cleanup.transientRoot;
  if (
    process.env.APHRODY_FACTORY_RESOURCE === root &&
    (inheritedFactoryResourceHeld(config) || factoryLeaseHeld(config.lockPath, localLeases.get(config.lockPath)))
  )
    return body();
  const leaseEnv = { ...process.env };
  delete leaseEnv.APHRODY_FACTORY_RESOURCE;
  delete leaseEnv.APHRODY_FACTORY_LOCK_PATH;
  delete leaseEnv.TMPDIR;
  const lease = Bun.spawn(
    [
      "flock",
      "--exclusive",
      "--close",
      "--timeout",
      "1800",
      config.lockPath,
      "bash",
      "-c",
      'printf READY; action=$(cat); if [ "$action" = ABORT ]; then exit 0; fi; until bash -c "$1"; do sleep 1; done',
      "factory-guardian",
      [
        "set -euo pipefail",
        ...factoryTransientShell(root, dockerBinary, config.lockPath, config.cleanup.privilegeBinary),
      ].join("\n"),
    ],
    {
      windowsHide: true,
      env: leaseEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const reader = lease.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  if (ready.done || new TextDecoder().decode(ready.value) !== "READY") {
    await lease.exited;
    throw new Error("Factory resource lease was not acquired");
  }
  if (!factoryLeaseHeld(config.lockPath, lease.pid)) {
    lease.stdin.write("ABORT");
    lease.stdin.end();
    await lease.exited;
    throw new Error("Factory lock ownership could not be verified");
  }
  localLeases.set(config.lockPath, lease.pid);
  const previous = {
    tmp: process.env.TMPDIR,
    resource: process.env.APHRODY_FACTORY_RESOURCE,
    lock: process.env.APHRODY_FACTORY_LOCK_PATH,
  };
  const clean = () => {
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        [
          "set -euo pipefail",
          ...factoryTransientShell(root, dockerBinary, config.lockPath, config.cleanup!.privilegeBinary, lease.pid),
        ].join("\n"),
      ],
      { windowsHide: true, stdout: "inherit", stderr: "inherit" },
    );
    if (result.exitCode !== 0) throw new Error("Factory transient isolation could not be qualified");
  };
  let bodyStarted = false;
  try {
    clean();
    bodyStarted = true;
    process.env.TMPDIR = root;
    process.env.APHRODY_FACTORY_RESOURCE = root;
    process.env.APHRODY_FACTORY_LOCK_PATH = config.lockPath;
    return await body();
  } finally {
    if (previous.tmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous.tmp;
    if (previous.resource === undefined) delete process.env.APHRODY_FACTORY_RESOURCE;
    else process.env.APHRODY_FACTORY_RESOURCE = previous.resource;
    if (previous.lock === undefined) delete process.env.APHRODY_FACTORY_LOCK_PATH;
    else process.env.APHRODY_FACTORY_LOCK_PATH = previous.lock;
    try {
      if (bodyStarted) clean();
    } catch (error) {
      console.error(
        "Factory temporary contents preserved; guardian retains the heavy lease:",
        (error as Error).message,
      );
    } finally {
      localLeases.delete(config.lockPath);
      if (!bodyStarted) lease.stdin.write("ABORT");
      lease.stdin.end();
      await lease.exited;
    }
  }
}

/** Persistent sccache control-plane metadata must never retain a job's disposable lease. */
export async function prewarmFactorySccache(config: BuildFactoryConfig, binary = "sccache") {
  const inheritedLease = inheritedFactoryResourceHeld(config);
  if (!inheritedLease && !factoryLeaseHeld(config.lockPath, localLeases.get(config.lockPath)))
    throw new Error("Shared sccache startup requires the actual factory heavy lease");
  // Secondary hosts inherit their own proven lease and persistent cache root.
  const cacheRoot = inheritedLease
    ? posix.join(posix.dirname(process.env.APHRODY_FACTORY_RESOURCE!), "cache")
    : config.cacheRoot;
  // The cache root may be a host-managed symlink (storage pool); compare against its real path.
  mkdirSync(posix.join(cacheRoot, "sccache"), { recursive: true, mode: 0o700 });
  const cache = realpathSync(posix.join(cacheRoot, "sccache"));
  const controlTmp = posix.join(cache, "control-plane-tmp");
  mkdirSync(controlTmp, { recursive: true, mode: 0o700 });
  if (lstatSync(controlTmp).isSymbolicLink() || realpathSync(controlTmp) !== controlTmp)
    throw new Error("Shared sccache control-plane temporary directory must be canonical");
  const env: Record<string, string | undefined> = {
    ...process.env,
    SCCACHE_DIR: cache,
    // Toolchain acquisition can outlast the daemon's default idle timeout.
    // A later client must not respawn it with the disposable job environment.
    SCCACHE_IDLE_TIMEOUT: "0",
    TMPDIR: controlTmp,
  };
  for (const key of [
    "APHRODY_FACTORY_RESOURCE",
    "APHRODY_FACTORY_LOCK_PATH",
    "SCCACHE_STARTUP_NOTIFY",
    "CARGO_TARGET_DIR",
    "APHRODY_CARGO_TARGET_DIR",
  ])
    delete env[key];
  const run = async (arg: string) => {
    const child = Bun.spawn([binary, arg], {
      windowsHide: true,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    });
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output, error };
  };
  let started = await run("--start-server");
  if (started.code === 0) return;
  // The owner reports a nonzero status when its server already exists. With no idle timeout, a server started
  // for an earlier cache root (the retired /srv layout) outlives it and fails every compile: replace it.
  const stats = await run("--show-stats");
  if (stats.code === 0 && stats.output.includes(`Local disk: ${JSON.stringify(cache)}`)) return;
  if (stats.code === 0) {
    await run("--stop-server");
    started = await run("--start-server");
    if (started.code === 0) return;
  }
  throw new Error(`Shared sccache server could not start: ${started.error.trim()}`);
}

async function resourceMain() {
  let [configPath, ...command] = Bun.argv.slice(2);
  const sccacheOnly = configPath === "--sccache";
  if (sccacheOnly) [configPath, ...command] = command;
  if (configPath === "--held") {
    const config = command[0] ? ((await Bun.file(command[0]).json()) as BuildFactoryConfig) : undefined;
    process.exitCode = inheritedFactoryResourceHeld(config) ? 0 : 1;
    return;
  }
  if (!configPath || (!sccacheOnly && command.length === 0))
    throw new Error("usage: factory-resource <config> <command...>");
  const config = (await Bun.file(configPath).json()) as BuildFactoryConfig;
  if (!config.cleanup) throw new Error("Factory transient policy is required for direct resource routing");
  if (sccacheOnly) {
    await prewarmFactorySccache(config, command[0]);
    return;
  }
  const code = await withFactoryResource(config, async () => {
    const child = Bun.spawn(command, {
      windowsHide: true,
      env: { ...process.env },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return child.exited;
  });
  process.exitCode = code;
}

if (import.meta.main)
  resourceMain().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
