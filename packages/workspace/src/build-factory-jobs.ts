// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { buildFactoryPlan, type BuildFactoryConfig } from "./build-factory.ts";
import type { FactorySourceScope } from "./build-factory-source.ts";

export interface FactoryOwnerPlan {
  repository: string;
  revision: string;
  target: string;
  workspace: string;
  command: readonly string[];
  commandTimeoutSeconds: number;
  transport: readonly string[];
  sourceScope?: FactorySourceScope;
}

export const FACTORY_JOB_MAX_TAIL_LINES = 200;
export const FACTORY_JOB_MAX_TAIL_BYTES = 65536;

function quote(value: string): string {
  if (value.includes("\0"))
    throw new Error("Factory job argument contains NUL");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function normalized(path: string): string {
  if (!path.startsWith("/") || path === "/" || posix.normalize(path) !== path)
    throw new Error("Factory job paths must be normalized absolute paths");
  return path;
}

function overlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(right + "/") ||
    right.startsWith(left + "/")
  );
}

function jobLocation(config: BuildFactoryConfig, jobId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(jobId))
    throw new Error(
      "Factory job id must contain 1..64 safe letters, digits, underscores or hyphens",
    );
  if (
    config.schemaVersion !== 1 ||
    !config.enabled ||
    config.target !== "vps" ||
    config.executionOnlyTargets?.includes(config.target)
  )
    throw new Error("Durable jobs require the enabled canonical factory");
  const artifactRoot = normalized(config.artifactRoot);
  const locks = posix.dirname(normalized(config.lockPath));
  if (
    overlap(artifactRoot, locks) ||
    Object.values(config.repositories).some((source) =>
      overlap(artifactRoot, normalized(source)),
    )
  )
    throw new Error(
      "Factory job artifacts must stay outside all source checkouts and locks",
    );
  return {
    artifactRoot,
    base: posix.join(artifactRoot, "factory-jobs"),
    jobId,
  };
}

const IMPORTS = String.raw`import { constants, openSync, closeSync, readSync, writeFileSync, readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, renameSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
`;

const HELPERS = String.raw`
const uid = process.getuid();
function fail(message) { throw new Error(message); }
function directory(path, create = false) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (!create || error.code !== "ENOENT") throw error;
    try { mkdirSync(path, { mode: 0o700 }); } catch (race) { if (race.code !== "EEXIST") throw race; }
    stat = lstatSync(path);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path)
    fail("Factory job directory is not its canonical regular path; preserved");
  return stat;
}
function privateDirectory(path, create = false) {
  const stat = directory(path, create);
  if (stat.uid !== uid || (stat.mode & 0o077) !== 0)
    fail("Factory job directory ownership or permissions differ; preserved");
}
function fileStat(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0)
    fail("Factory job file ownership or permissions differ; preserved");
  return stat;
}
function exclusive(path, content) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); } finally { closeSync(fd); }
}
function readRecord(path, optional = false) {
  let stat;
  try { stat = fileStat(path); } catch (error) {
    if (optional && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (stat.size > 131072) fail("Factory job record exceeds its metadata budget");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(readFileSync(fd, "utf8")); } finally { closeSync(fd); }
}
function atomic(path, value, terminal = false) {
  try { fileStat(path); if (terminal) fail("Factory terminal receipt already exists; preserved"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = path + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
  exclusive(temporary, JSON.stringify(value) + "\n");
  try {
    if (terminal) linkSync(temporary, path);
    else renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
function canonicalBase(create = false) {
  directory(input.artifactRoot);
  privateDirectory(input.base, create);
}
function request() {
  privateDirectory(input.directory);
  const value = readRecord(join(input.directory, "request.json"));
  if (
    value.schemaVersion !== 1 || value.jobId !== input.jobId ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.repository) ||
    !/^[a-f0-9]{40}$/.test(value.revision) ||
    value.target !== "vps" || !Number.isSafeInteger(value.commandTimeoutSeconds) ||
    value.commandTimeoutSeconds < 1 || value.commandTimeoutSeconds > 86400 ||
    typeof value.requestedAt !== "string" || !Number.isFinite(Date.parse(value.requestedAt))
  ) fail("Invalid factory job request; preserved");
  return value;
}
function bootIdentity() {
  try {
    const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) ? value : undefined;
  } catch { return undefined; }
}
function startIdentity(pid) {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  } catch { return undefined; }
}
function tail(path, lines) {
  const stat = fileStat(path);
  const length = Math.min(stat.size, 65536);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const buffer = Buffer.alloc(length);
  let bytes;
  try { bytes = readSync(fd, buffer, 0, length, stat.size - length); } finally { closeSync(fd); }
  const text = buffer.subarray(0, bytes).toString("utf8");
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  const encoded = Buffer.from(parts.slice(-lines).join("\n"), "utf8");
  let offset = Math.max(0, encoded.length - 65536);
  // Decode only at a complete UTF-8 code point; invalid source bytes may have
  // expanded into replacement characters, so bound the encoded projection too.
  while (offset < encoded.length && (encoded[offset] & 0xc0) === 0x80) offset++;
  return { text: encoded.subarray(offset).toString("utf8"),
    truncated: stat.size > length || parts.length > lines || offset > 0 };

}
function projection(lines = 0) {
  const meta = request();
  const result = {
    schemaVersion: 1, jobId: meta.jobId, fingerprint: meta.fingerprint,
    ...(meta.sourceScope ? { sourceScope: meta.sourceScope } : {}),
    repository: meta.repository, revision: meta.revision, target: meta.target,
    requestedAt: meta.requestedAt, status: "queued", phase: "dispatch"
  };
  const terminal = readRecord(join(input.directory, "exit.json"), true);
  if (terminal) {
    if (
      terminal.fingerprint !== meta.fingerprint ||
      !Number.isSafeInteger(terminal.exitCode) || terminal.exitCode < 0 || terminal.exitCode > 255 ||
      typeof terminal.finishedAt !== "string" || !Number.isFinite(Date.parse(terminal.finishedAt))
    ) fail("Invalid factory terminal receipt; preserved");
    result.status = terminal.exitCode === 0 ? "succeeded" : "failed";
    result.phase = "complete";
    result.exitCode = terminal.exitCode;
    result.finishedAt = terminal.finishedAt;
  } else {
    const state = readRecord(join(input.directory, "state.json"), true);
    if (state) {
      if (state.fingerprint !== meta.fingerprint || !["queued", "active", "indeterminate"].includes(state.status))
        fail("Invalid factory job lifecycle; preserved");
      result.status = state.status;
      if (state.status === "active") {
        const validPid = Number.isSafeInteger(state.pid) && state.pid > 0;
        if (validPid) result.pid = state.pid;
        result.processAlive = validPid && /^[0-9]+$/.test(state.processStart ?? "") &&
          typeof state.bootId === "string" && state.bootId === bootIdentity() &&
          startIdentity(state.pid) === state.processStart;
        if (!result.processAlive) result.status = "indeterminate";
        if (typeof state.startedAt === "string" && Number.isFinite(Date.parse(state.startedAt)))
          result.startedAt = state.startedAt;
      }
    }
  }
  if (lines) result.logs = {
    stdout: tail(join(input.directory, "stdout.log"), lines),
    stderr: tail(join(input.directory, "stderr.log"), lines)
  };
  return result;
}
`;

const STATUS_BODY = String.raw`
try {
  canonicalBase();
  console.log(JSON.stringify(projection(input.tailLines)));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cannot read factory job");
  process.exitCode = 2;
}
`;

const RUNNER_BODY = String.raw`
try {
  canonicalBase();
  const meta = request();
  if (meta.fingerprint !== input.fingerprint) fail("Factory runner identity differs; preserved");
  if (readRecord(join(input.directory, "exit.json"), true)) process.exit(0);
  const state = readRecord(join(input.directory, "state.json"));
  if (state.status !== "queued" || state.fingerprint !== meta.fingerprint)
    fail("Factory runner refuses an already observed job; no replay");
  const processStart = startIdentity(process.pid);
  const bootId = bootIdentity();
  if (!processStart || !bootId) fail("Factory supervisor requires a verifiable native process identity");
  atomic(join(input.directory, "state.json"), {
    fingerprint: meta.fingerprint, status: "active", pid: process.pid, processStart, bootId,
    startedAt: new Date().toISOString()
  });
  // Own the session/process group directly: host timeout implementations do not
  // consistently terminate descendants, and leases must outlive their owner.
  const child = Bun.spawn(
    ["bash", "-c", input.remoteCommand],
    { detached: true, stdin: "ignore", stdout: "inherit", stderr: "inherit" }
  );
  let expired = false;
  let cancellationError;
  const deadline = setTimeout(() => {
    expired = true;
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") cancellationError = error; }
  }, meta.commandTimeoutSeconds * 1000);
  let ownerExit;
  try { ownerExit = await child.exited; }
  finally { clearTimeout(deadline); }
  if (cancellationError) throw cancellationError;
  if (expired) {
    const stopDeadline = performance.now() + 5000;
    for (;;) {
      const running = readdirSync("/proc").some((entry) => {
        if (!/^[0-9]+$/.test(entry)) return false;
        let stat;
        try { stat = readFileSync("/proc/" + entry + "/stat", "utf8"); }
        catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
        const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
        return fields[0] !== "Z" && Number(fields[2]) === child.pid && Number(fields[3]) === child.pid;
      });
      if (!running) break;
      if (performance.now() >= stopDeadline) fail("Factory owner group did not stop; completion is indeterminate");
      await Bun.sleep(10);
    }
  }
  const exitCode = expired ? 124 : ownerExit;
  atomic(join(input.directory, "exit.json"), {
    fingerprint: meta.fingerprint, exitCode, finishedAt: new Date().toISOString()
  }, true);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Factory supervisor failed");
  // A supervisor fault is indeterminate without a proven owner exit; never forge success.
  process.exitCode = 2;
}
`;

const SUBMIT_LOCKED_BODY = String.raw`
try {
  canonicalBase();
  let exists = false;
  try { lstatSync(input.directory); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (exists) {
    const meta = request();
    if (meta.fingerprint !== input.fingerprint)
      fail("Factory job id conflicts with a different request; preserved");
    console.log(JSON.stringify({ ...projection(), submission: "existing" }));
  } else {
    privateDirectory(input.directory, true);
    const meta = {
      schemaVersion: 1, jobId: input.jobId, fingerprint: input.fingerprint,
      repository: input.repository, revision: input.revision, target: input.target,
      commandTimeoutSeconds: input.commandTimeoutSeconds, requestedAt: new Date().toISOString(),
      ...(input.sourceScope ? { sourceScope: input.sourceScope } : {})
    };
    exclusive(join(input.directory, "request.json"), JSON.stringify(meta) + "\n");
    exclusive(join(input.directory, "state.json"), JSON.stringify({ fingerprint: input.fingerprint, status: "queued" }) + "\n");
    exclusive(join(input.directory, "runner.mjs"), input.runner);
    exclusive(join(input.directory, "stdout.log"), "");
    exclusive(join(input.directory, "stderr.log"), "");
    const stdout = openSync(join(input.directory, "stdout.log"), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    const stderr = openSync(join(input.directory, "stderr.log"), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    let launch;
    try {
      launch = Bun.spawnSync(["nohup", "setsid", "--fork", process.execPath, join(input.directory, "runner.mjs")],
        { stdin: "ignore", stdout, stderr });
    } finally { closeSync(stdout); closeSync(stderr); }
    if (launch.exitCode !== 0)
      atomic(join(input.directory, "state.json"), { fingerprint: input.fingerprint, status: "indeterminate" });
    console.log(JSON.stringify({ ...projection(), submission: "created" }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Factory submission failed");
  process.exitCode = 2;
}
`;

const SUBMIT_BODY = String.raw`
try {
  for (const tool of ["nohup", "setsid", "flock", "bash"])
    if (!Bun.which(tool)) fail("Required existing factory tool is missing: " + tool);
  canonicalBase(true);
  const lock = join(input.base, ".submit.lock");
  try { exclusive(lock, ""); } catch (error) { if (error.code !== "EEXIST") throw error; }
  fileStat(lock);
  const child = Bun.spawnSync(
    ["flock", "--close", "--wait", "10", "--", lock, process.execPath, "--eval", input.submitProgram, "--", JSON.stringify(input)],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit" }
  );
  process.exitCode = child.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Factory submission failed");
  process.exitCode = 2;
}
`;

const ARG_INPUT = "const input = JSON.parse(process.argv.at(-1));\n";
const STATUS = IMPORTS + ARG_INPUT + HELPERS + STATUS_BODY;
const SUBMIT_LOCKED = IMPORTS + ARG_INPUT + HELPERS + SUBMIT_LOCKED_BODY;
const SUBMIT = IMPORTS + ARG_INPUT + HELPERS + SUBMIT_BODY;

function program(source: string, input: unknown): string {
  return [
    "set -euo pipefail",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"',
    "exec bun --eval " + quote(source) + " -- " + quote(JSON.stringify(input)),
  ].join("\n");
}

function runner(input: Record<string, unknown>): string {
  return (
    IMPORTS +
    "const input = " +
    JSON.stringify(input) +
    ";\n" +
    HELPERS +
    RUNNER_BODY
  );
}

/** New jobs only. The existing owner transport command is executed byte-for-byte unchanged. */
export function factoryJobPlan(
  config: BuildFactoryConfig,
  existingPlan: FactoryOwnerPlan,
  jobId: string,
) {
  const location = jobLocation(config, jobId);
  const remoteCommand = existingPlan.transport[5];
  if (
    existingPlan.target !== config.target ||
    !Object.hasOwn(config.repositories, existingPlan.repository) ||
    existingPlan.workspace !== config.repositories[existingPlan.repository] ||
    !/^[a-f0-9]{40}$/u.test(existingPlan.revision) ||
    !existingPlan.command.length ||
    !existingPlan.command[0] ||
    existingPlan.command.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    ) ||
    existingPlan.transport.length !== 6 ||
    existingPlan.transport.slice(0, 5).join("\0") !==
      ["ssh", "exec", "--host", config.target, "--cmd"].join("\0") ||
    !remoteCommand ||
    remoteCommand.includes("\0") ||
    !Number.isSafeInteger(existingPlan.commandTimeoutSeconds) ||
    existingPlan.commandTimeoutSeconds < 1 ||
    existingPlan.commandTimeoutSeconds > 86400
  )
    throw new Error(
      "Durable submission requires an intact existing factory owner plan",
    );
  const canonical = buildFactoryPlan(
    config,
    existingPlan.repository,
    existingPlan.revision,
    existingPlan.command,
    {
      submodules:
        existingPlan.sourceScope?.kind === "gitlinks"
          ? existingPlan.sourceScope.paths
          : undefined,
    },
  );
  if (
    canonical.transport[5] !== remoteCommand ||
    canonical.workspace !== existingPlan.workspace ||
    canonical.commandTimeoutSeconds !== existingPlan.commandTimeoutSeconds
  )
    throw new Error(
      "Durable submission requires an intact existing factory owner plan",
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        repository: existingPlan.repository,
        revision: existingPlan.revision,
        target: existingPlan.target,
        command: existingPlan.command,
        remoteCommand,
        commandTimeoutSeconds: existingPlan.commandTimeoutSeconds,
      }),
    )
    .digest("hex");
  const directory = posix.join(location.base, jobId);
  const input = {
    ...location,
    directory,
    fingerprint,
    repository: existingPlan.repository,
    revision: existingPlan.revision,
    target: existingPlan.target,
    commandTimeoutSeconds: existingPlan.commandTimeoutSeconds,
    remoteCommand,
    sourceScope: existingPlan.sourceScope,
  };
  return {
    operation: "submit" as const,
    jobId,
    fingerprint,
    sourceScope: existingPlan.sourceScope,
    directory,
    target: existingPlan.target,
    commandTimeoutSeconds: existingPlan.commandTimeoutSeconds,
    transport: [
      "ssh",
      "exec",
      "--host",
      existingPlan.target,
      "--cmd",
      program(SUBMIT, {
        ...input,
        runner: runner(input),
        submitProgram: SUBMIT_LOCKED,
      }),
    ],
  };
}

/** Read only; active means the detached dispatch is alive and may still be waiting on leases. */
export function factoryJobStatusPlan(
  config: BuildFactoryConfig,
  jobId: string,
  options: { tailLines?: number } = {},
) {
  const location = jobLocation(config, jobId);
  const tailLines = options.tailLines ?? 0;
  if (
    !Number.isSafeInteger(tailLines) ||
    tailLines < 0 ||
    tailLines > FACTORY_JOB_MAX_TAIL_LINES
  )
    throw new Error("Factory log tail must contain 0..200 lines");
  const directory = posix.join(location.base, jobId);
  return {
    operation: "status" as const,
    jobId,
    directory,
    target: config.target,
    transport: [
      "ssh",
      "exec",
      "--host",
      config.target,
      "--cmd",
      program(STATUS, { ...location, directory, tailLines }),
    ],
  };
}
