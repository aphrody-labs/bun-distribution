// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactoryPlan, type BuildFactoryConfig } from "../src/build-factory.ts";
import { factoryJobPlan } from "../src/build-factory-jobs.ts";

const roots: string[] = [];
const revision = "a".repeat(40);
const jobId = "ffi-qualification-20261005";
const config: BuildFactoryConfig = {
  schemaVersion: 1,
  enabled: true,
  target: "vps",
  cacheRoot: "/srv/factory/cache",
  artifactRoot: "/srv/factory/artifacts",
  lockPath: "/srv/factory/locks/heavy.lock",
  repositories: { aphrody: "/srv/factory/workspaces/aphrody" },
  rust: { maxJobs: 6 },
  commandTimeoutSeconds: 21600,
};
const ownerCommand = [
  "scripts/build/rust/cargo-serial.sh",
  "build",
  "--locked",
  "-p",
  "aphrody-ffi",
];
const durable = factoryJobPlan(
  config,
  buildFactoryPlan(config, "aphrody", revision, ownerCommand),
  jobId,
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-job-cli-"));
  roots.push(root);
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/build-factory.json"), JSON.stringify(config));
  const marker = join(root, "invocation.json");
  const response = join(root, "response.json");
  const infra = join(root, "infra-fixture");
  await writeFile(
    infra,
    `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({args: process.argv.slice(2), timeout: process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS}));
const reply = JSON.parse(readFileSync(${JSON.stringify(response)}, "utf8"));
process.stdout.write(reply.stdout);
process.stderr.write(reply.stderr ?? "");
process.exitCode = reply.code ?? 0;
`,
  );
  await chmod(infra, 0o755);
  const receipt = {
    schemaVersion: 1,
    jobId,
    fingerprint: durable.fingerprint,
    repository: "aphrody",
    revision,
    target: "vps",
    requestedAt: "2026-10-05T00:00:00.000Z",
    status: "queued",
    phase: "dispatch",
    submission: "created",
  };
  await writeFile(response, JSON.stringify({ stdout: JSON.stringify(receipt) }));
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "../src/build-factory.ts"), ...args],
      {
        env: { ...process.env, APHRODY_ROOT: root, APHRODY_INFRA_BIN: infra },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stderr, value: JSON.parse(stdout) };
  };
  const request = (action: string) => [
    action,
    "--repo",
    "aphrody",
    "--revision",
    revision,
    "--detach",
    "--job",
    jobId,
    "--",
    ...ownerCommand,
  ];
  const reply = async (stdout: string, code = 0, stderr = "") =>
    writeFile(response, JSON.stringify({ stdout, code, stderr }));
  const invocation = async () => JSON.parse(await readFile(marker, "utf8"));
  return { run, request, reply, receipt, marker, invocation };
}

test("detached planning is explicit, deterministic and never dispatches", async () => {
  const f = await fixture();
  const result = await f.run(...f.request("plan"));
  expect(result.code).toBe(0);
  expect(result.value.executed).toBe(false);
  expect(result.value.detached).toBe(true);
  expect(result.value.jobId).toBe(jobId);
  expect(result.value.fingerprint).toBe(durable.fingerprint);
  expect(result.value.transport).toEqual(durable.transport);
  expect(await Bun.file(f.marker).exists()).toBe(false);
});

test("detached run confirms submission through the installed native Infra owner without asserting compilation", async () => {
  const f = await fixture();
  const result = await f.run(...f.request("run"));
  expect(result.code).toBe(0);
  expect(result.value.status).toBe("queued");
  expect(result.value.dispatchConfirmed).toBe(true);
  expect(result.value.reconciliationRequired).toBe(false);
  expect(result.value.executed).toBeUndefined();
  expect(result.value.exitCode).toBeUndefined();
  const invocation = await f.invocation();
  expect(invocation.args.slice(2)).toEqual(durable.transport);
  expect(invocation.timeout).toBe("60");
});

test("status uses a bounded read-only native observation and preserves a terminal failure", async () => {
  const f = await fixture();
  const terminal = {
    ...f.receipt,
    status: "failed",
    phase: "complete",
    exitCode: 17,
    finishedAt: "2026-10-05T00:01:00.000Z",
    submission: undefined,
    logs: {
      stdout: { text: "\u0001".repeat(65536), truncated: true },
      stderr: { text: "\u0001".repeat(65536), truncated: true },
    },
  };
  await f.reply(JSON.stringify(terminal));
  const result = await f.run("status", "--job", jobId, "--tail", "12");
  expect(result.code).toBe(0);
  expect(result.value.status).toBe("failed");
  expect(result.value.exitCode).toBe(17);
  expect(result.value.operation).toBe("status");
  expect(Buffer.byteLength(result.value.logs.stdout.text)).toBe(65536);
  expect(Buffer.byteLength(result.value.logs.stderr.text)).toBe(65536);
  expect(result.value.dispatchConfirmed).toBe(false);
  const invocation = await f.invocation();
  expect(invocation.args.slice(2, 7)).toEqual(["ssh", "exec", "--host", "vps", "--cmd"]);
  expect(invocation.args[7]).toContain('"tailLines":12');
  expect(invocation.args[7]).not.toContain("setsid");
  expect(invocation.timeout).toBe("60");
});

test("SSH255 after dispatch remains unknown with a stable identity and no terminal exit claim", async () => {
  const f = await fixture();
  await f.reply("", 255, "client disconnected");
  const result = await f.run(...f.request("run"));
  expect(result.code).toBe(255);
  expect(result.value.status).toBe("unknown");
  expect(result.value.jobId).toBe(jobId);
  expect(result.value.fingerprint).toBe(durable.fingerprint);
  expect(result.value.reconciliationRequired).toBe(true);
  expect(result.value.transportExitCode).toBe(255);
  expect(result.value.exitCode).toBeUndefined();
  expect(result.value.executed).toBeUndefined();
});

test("malformed, conflicting or contradictory acknowledgements require reconciliation", async () => {
  const f = await fixture();
  const invalid = [
    "not-json",
    JSON.stringify({ ...f.receipt, jobId: "someone-else" }),
    JSON.stringify({ ...f.receipt, fingerprint: "b".repeat(64) }),
    JSON.stringify({ ...f.receipt, repository: "yolo" }),
    JSON.stringify({ ...f.receipt, revision: "c".repeat(40) }),
    JSON.stringify({ ...f.receipt, status: "active", exitCode: 0 }),
    JSON.stringify({ ...f.receipt, status: "active", pid: 123, processAlive: false }),
    JSON.stringify({ ...f.receipt, status: "active", pid: -1, processAlive: true }),
    JSON.stringify({ ...f.receipt, padding: "😀".repeat(300000) }),
    JSON.stringify({
      ...f.receipt,
      status: "succeeded",
      phase: "complete",
      exitCode: 17,
      finishedAt: "2026-10-05T00:01:00.000Z",
    }),
  ];
  await Promise.all(
    invalid.map(async (reply) => {
      const isolated = await fixture();
      await isolated.reply(reply);
      const result = await isolated.run(...isolated.request("run"));
      expect(result.code).toBe(2);
      expect(result.value.status).toBe("unknown");
      expect(result.value.reconciliationRequired).toBe(true);
      expect(result.value.exitCode).toBeUndefined();
    }),
  );
});

test("invalid IDs, missing detach pairs, duplicate options and excessive tails fail before transport", async () => {
  const f = await fixture();
  const requests = [
    ["run", "--revision", revision, "--detach", "--", ...ownerCommand],
    ["run", "--revision", revision, "--job", jobId, "--", ...ownerCommand],
    ["run", "--revision", revision, "--detach", "--job", "../escape", "--", ...ownerCommand],
    ["status", "--job", jobId, "--tail", "201"],
    ["status", "--job", jobId, "--tail", "-1"],
    ["status", "--job", jobId, "--tail", "1e2"],
    ["status", "--job", jobId, "--route"],
    ["status", "--job", jobId, "--job", jobId],
    ["run", "--revision", revision, "--revision", revision, "--", ...ownerCommand],
  ];
  await Promise.all(
    requests.map(async (args) => {
      const result = await f.run(...args);
      expect(result.code).toBe(2);
      expect(result.value.executed).toBe(false);
    }),
  );
  expect(await Bun.file(f.marker).exists()).toBe(false);
});
