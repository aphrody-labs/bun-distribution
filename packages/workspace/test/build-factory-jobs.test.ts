// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  buildFactoryPlan,
  type BuildFactoryConfig,
} from "../src/build-factory.ts";
import {
  FACTORY_JOB_MAX_TAIL_BYTES,
  factoryJobPlan,
  factoryJobStatusPlan,
} from "../src/build-factory-jobs.ts";
import { hasMode } from "../src/portable-fs.ts";

type Plan = { transport: readonly string[] };
const quoted = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
function launch(code: string) {
  const child = Bun.spawn(["bash", "-c", code], {
    windowsHide: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
    },
    timeout: 10000,
  });
  const result = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
  return { child, result };
}
async function execute(plan: Plan) {
  return launch(plan.transport[5]!).result;
}
async function until(label: string, condition: () => Promise<boolean>) {
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- Observe a real process/file barrier.
    if (await condition()) return;
    // eslint-disable-next-line no-await-in-loop -- Avoid a timing-only concurrency assertion.
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for " + label);
}
async function fixture(seconds = 3) {
  const root = await mkdtemp(join(tmpdir(), "aphrody-durable-jobs-"));
  const repository = join(root, "source");
  await Promise.all(
    [
      repository,
      join(root, "cache"),
      join(root, "artifacts"),
      join(root, "locks"),
    ].map((path) => mkdir(path)),
  );
  async function git(...args: string[]) {
    const child = Bun.spawn(["git", "-C", repository, ...args], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/dev/null",
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error("Fixture Git failed: " + stderr);
    return stdout.trim();
  }
  await git("init", "--quiet", "-b", "main");
  await git("config", "user.name", "fixture");
  await git("config", "user.email", "fixture@localhost");
  await writeFile(join(repository, "source.txt"), "pinned\n");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "fixture");
  const revision = await git("rev-parse", "HEAD");
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    cacheRoot: join(root, "cache"),
    artifactRoot: join(root, "artifacts"),
    lockPath: join(root, "locks", "heavy.lock"),
    repositories: { aphrody: repository },
    rust: { maxJobs: 1 },
    commandTimeoutSeconds: seconds,
  };
  const ids = new Set<string>();
  const leases: ReturnType<typeof launch>[] = [];
  function owner(command: string[]) {
    return buildFactoryPlan(config, "aphrody", revision, command);
  }
  function plan(id: string, code: string) {
    ids.add(id);
    return factoryJobPlan(
      config,
      owner([process.execPath, "--eval", code]),
      id,
    );
  }
  async function status(id: string, tailLines = 0) {
    const result = await execute(
      factoryJobStatusPlan(config, id, { tailLines }),
    );
    if (result.exitCode !== 0)
      throw new Error("Job status failed: " + result.stderr);
    return JSON.parse(result.stdout);
  }
  async function completed(id: string) {
    await until("terminal receipt " + id, () =>
      Bun.file(
        join(config.artifactRoot, "factory-jobs", id, "exit.json"),
      ).exists(),
    );
    return status(id);
  }
  async function lease(kind: "heavy" | "source") {
    const path =
      kind === "heavy"
        ? config.lockPath
        : join(root, "locks", "aphrody.source.lock");
    const entered = join(root, kind + "-held");
    const code =
      "await Bun.write(process.argv.at(-1), 'held'); await Bun.stdin.text();";
    const leaseJob = launch(
      [
        "flock",
        "--close",
        "--",
        path,
        process.execPath,
        "--eval",
        code,
        "--",
        entered,
      ]
        .map(quoted)
        .join(" "),
    );
    leases.push(leaseJob);
    await until("fixture lease", () => Bun.file(entered).exists());
    return {
      child: leaseJob.child,
      async release() {
        leaseJob.child.stdin.end();
        return leaseJob.result;
      },
    };
  }
  return {
    root,
    repository,
    revision,
    config,
    git,
    owner,
    plan,
    status,
    completed,
    lease,
    async cleanup() {
      for (const held of leases) held.child.stdin.end();
      await Promise.allSettled(leases.map((held) => held.result));
      await Promise.all(
        [...ids].map(async (id) => {
          const path = join(
            config.artifactRoot,
            "factory-jobs",
            id,
            "state.json",
          );
          if (!(await Bun.file(path).exists())) return;
          const record = await Bun.file(path).json();
          if (record.status === "active") {
            await until(
              "fixture owner completion",
              async () =>
                (await Bun.file(
                  join(config.artifactRoot, "factory-jobs", id, "exit.json"),
                ).exists()) || !(await Bun.file(path).exists()),
            );
          }
        }),
      );
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The factory host's POSIX layout, for plan validation where the Linux host scripts cannot run. */
function remoteLayout() {
  const root = "/home/ubuntu/apps/factory";
  const repository = posix.join(root, "source");
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    cacheRoot: posix.join(root, "cache"),
    artifactRoot: posix.join(root, "artifacts"),
    lockPath: posix.join(root, "locks", "heavy.lock"),
    repositories: { aphrody: repository },
    rust: { maxJobs: 1 },
    commandTimeoutSeconds: 3,
  };
  const owner = (command: string[]) =>
    buildFactoryPlan(config, "aphrody", "a".repeat(40), command);
  return { root, repository, config, owner, cleanup: async () => {} };
}

test("job plans reject traversal, unsafe identities, artifact overlaps and foreign owner plans", async () => {
  const linux = process.platform === "linux";
  const f = linux ? await fixture() : remoteLayout();
  const at = linux ? join : posix.join;
  try {
    const owner = f.owner(["true"]);
    for (const id of ["", "../job", "a/b", "bad.id", "a".repeat(65), "x\0y"])
      expect(() => factoryJobPlan(f.config, owner, id)).toThrow("job id");
    for (const path of [
      f.repository,
      at(f.repository, "artifacts"),
      f.root,
      at(f.root, "locks"),
    ])
      expect(() =>
        factoryJobPlan({ ...f.config, artifactRoot: path }, owner, "valid"),
      ).toThrow("outside");
    expect(() =>
      factoryJobPlan(f.config, { ...owner, target: "dbfr" }, "valid"),
    ).toThrow("intact");
    expect(() =>
      factoryJobPlan(
        f.config,
        { ...owner, transport: ["ssh", "exec"] },
        "valid",
      ),
    ).toThrow("intact");
    expect(() =>
      factoryJobStatusPlan(f.config, "valid", { tailLines: 201 }),
    ).toThrow("0..200");
    expect(() =>
      factoryJobStatusPlan(f.config, "valid", { tailLines: 1.5 }),
    ).toThrow("0..200");
    expect(() =>
      factoryJobPlan(
        f.config,
        { ...owner, transport: [...owner.transport.slice(0, 5), "true"] },
        "valid",
      ),
    ).toThrow("intact");
    expect(() =>
      factoryJobPlan(
        f.config,
        { ...owner, commandTimeoutSeconds: owner.commandTimeoutSeconds + 1 },
        "valid",
      ),
    ).toThrow("intact");
    const request = factoryJobPlan(f.config, owner, "valid");
    expect(request.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(request.fingerprint).toBe(
      factoryJobPlan(f.config, owner, "valid").fingerprint,
    );
    if (!linux) return;
    expect(
      (await execute(factoryJobStatusPlan(f.config, "absent"))).exitCode,
    ).toBe(2);
    expect(
      await Bun.file(
        at(f.config.artifactRoot, "factory-jobs", "absent", "request.json"),
      ).exists(),
    ).toBe(false);
  } finally {
    await f.cleanup();
  }
});

test.skipIf(process.platform !== "linux")(
  "detached dispatch survives client loss while queued and returns the same job without replay",
  async () => {
    const f = await fixture();
    const marker = join(f.root, "owner-count");
    const plan = f.plan(
      "disconnect",
      "await Bun.write(" + JSON.stringify(marker) + ", 'once');",
    );
    const held = await f.lease("heavy");
    const client = launch("(" + plan.transport[5] + ")\nexec sleep 30");
    try {
      await until("durable dispatch", async () => {
        const path = join(plan.directory, "state.json");
        return (
          (await Bun.file(path).exists()) &&
          (await Bun.file(path).json()).status === "active"
        );
      });
      client.child.kill("SIGTERM");
      await client.result;
      const queued = await f.status("disconnect");
      expect(queued.status).toBe("active");
      expect(queued.phase).toBe("dispatch");
      expect(queued.processAlive).toBe(true);
      process.kill(queued.pid, "SIGHUP");
      await Bun.sleep(20);
      expect((await f.status("disconnect")).processAlive).toBe(true);
      expect(queued.exitCode).toBeUndefined();
      expect(await Bun.file(marker).exists()).toBe(false);
      const retry = await execute(plan);
      expect(retry.exitCode).toBe(0);
      expect(JSON.parse(retry.stdout).submission).toBe("existing");
      expect((await held.release()).exitCode).toBe(0);
      expect((await f.completed("disconnect")).exitCode).toBe(0);
      expect(await Bun.file(marker).text()).toBe("once");
    } finally {
      client.child.kill("SIGTERM");
      await held.release();
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "concurrent matching submissions execute once; conflicting identities preserve the private request and receipt",
  async () => {
    const f = await fixture();
    const count = join(f.root, "count");
    const opaque = "OPAQUE_COMMAND_PRIVATE_VALUE";
    const plan = f.plan(
      "matching",
      "import { appendFileSync } from 'node:fs'; appendFileSync(" +
        JSON.stringify(count) +
        ", 'x'); // " +
        opaque,
    );
    try {
      const results = await Promise.all([execute(plan), execute(plan)]);
      expect(results.every((result) => result.exitCode === 0)).toBe(true);
      expect(
        results
          .map((result) => JSON.parse(result.stdout).submission)
          .toSorted(),
      ).toEqual(["created", "existing"]);
      const terminal = await f.completed("matching");
      expect(terminal.status).toBe("succeeded");
      expect(await Bun.file(count).text()).toBe("x");
      const prior = await readFile(
        join(plan.directory, "request.json"),
        "utf8",
      );
      const conflict = f.plan("matching", "process.exit(7)");
      const refused = await execute(conflict);
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain("conflicts");
      expect(await readFile(join(plan.directory, "request.json"), "utf8")).toBe(
        prior,
      );
      expect((await f.status("matching")).exitCode).toBe(0);
      expect(JSON.stringify(terminal)).not.toContain(opaque);
      expect(prior).not.toContain(opaque);
      expect(hasMode((await stat(plan.directory)).mode, 0o700)).toBe(true);
      const files = await Promise.all(
        [
          "request.json",
          "state.json",
          "runner.mjs",
          "stdout.log",
          "stderr.log",
          "exit.json",
        ].map((name) => stat(join(plan.directory, name))),
      );
      for (const file of files) expect(hasMode(file.mode, 0o600)).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "the exact owner plan waits on source leases and rechecks its pin after queueing",
  async () => {
    const f = await fixture();
    const marker = join(f.root, "must-not-run");
    const plan = f.plan(
      "changed-pin",
      "await Bun.write(" + JSON.stringify(marker) + ", 'bad');",
    );
    const held = await f.lease("source");
    try {
      expect((await execute(plan)).exitCode).toBe(0);
      await until(
        "heavy lease before source wait",
        async () =>
          (await launch("flock -n -- '" + f.config.lockPath + "' true").result)
            .exitCode === 1,
      );
      expect(await Bun.file(marker).exists()).toBe(false);
      await writeFile(join(f.repository, "source.txt"), "changed\n");
      await f.git("add", "source.txt");
      await f.git("commit", "--quiet", "-m", "new fixture pin");
      await held.release();
      expect((await f.completed("changed-pin")).exitCode).toBe(2);
      expect(await Bun.file(marker).exists()).toBe(false);
      expect((await f.status("changed-pin", 4)).logs.stderr.text).toContain(
        "source revision differs",
      );
      const runner = await readFile(join(plan.directory, "runner.mjs"), "utf8");
      expect(runner).toContain(
        JSON.stringify(
          f.owner([
            process.execPath,
            "--eval",
            "await Bun.write(" + JSON.stringify(marker) + ", 'bad');",
          ]).transport[5],
        ),
      );
    } finally {
      await held.release();
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "host deadline expires a queued waiter without touching the unrelated lease holder",
  async () => {
    const f = await fixture(1);
    const marker = join(f.root, "must-not-run");
    const held = await f.lease("heavy");
    const plan = f.plan(
      "queue-deadline",
      "await Bun.write(" + JSON.stringify(marker) + ", 'bad');",
    );
    try {
      expect((await execute(plan)).exitCode).toBe(0);
      const terminal = await f.completed("queue-deadline");
      expect(terminal.status).toBe("failed");
      expect([124, 137]).toContain(terminal.exitCode);
      expect(held.child.exitCode).toBeNull();
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(
        (await launch("flock -n -- '" + f.config.lockPath + "' true").result)
          .exitCode,
      ).toBe(1);
    } finally {
      await held.release();
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "host deadline stops only its owner group before releasing leases and records non-success exits",
  async () => {
    const f = await fixture(1);
    const heartbeat = join(f.root, "heartbeat");
    const unrelatedMarker = join(f.root, "unrelated-owner");
    const unrelated = launch(
      [
        process.execPath,
        "--eval",
        "await Bun.write(" +
          JSON.stringify(unrelatedMarker) +
          ", 'alive'); await Bun.stdin.text();",
      ]
        .map(quoted)
        .join(" "),
    );
    const plan = f.plan(
      "active-deadline",
      "import { appendFileSync } from 'node:fs'; setInterval(() => appendFileSync(" +
        JSON.stringify(heartbeat) +
        ", 'x'), 10); await Bun.sleep(30000);",
    );
    try {
      await until("unrelated owner actually running", () =>
        Bun.file(unrelatedMarker).exists(),
      );
      expect((await execute(plan)).exitCode).toBe(0);
      await until("owner actually running", () => Bun.file(heartbeat).exists());
      const terminal = await f.completed("active-deadline");
      expect([124, 137]).toContain(terminal.exitCode);
      const before = await Bun.file(heartbeat).text();
      await Bun.sleep(80);
      expect(await Bun.file(heartbeat).text()).toBe(before);
      expect(unrelated.child.exitCode).toBeNull();
      expect(await Bun.file(unrelatedMarker).text()).toBe("alive");
      expect(
        (await launch("flock -n -- '" + f.config.lockPath + "' true").result)
          .exitCode,
      ).toBe(0);
      expect(
        (
          await launch(
            "flock -n -- '" +
              join(f.root, "locks", "aphrody.source.lock") +
              "' true",
          ).result
        ).exitCode,
      ).toBe(0);
      const failed = f.plan(
        "owner-failed",
        "console.error('expected fixture failure'); process.exit(19);",
      );
      expect((await execute(failed)).exitCode).toBe(0);
      expect((await f.completed("owner-failed")).exitCode).toBe(19);
    } finally {
      unrelated.child.stdin.end();
      await unrelated.result;
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "status bounds private log tails and never exposes command records",
  async () => {
    const f = await fixture();
    const plan = f.plan(
      "logs",
      "for(let i=0;i<500;i++)console.log('line-'+i); console.error('fixture error');",
    );
    try {
      expect((await execute(plan)).exitCode).toBe(0);
      await f.completed("logs");
      const value = await f.status("logs", 3);
      expect(value.logs.stdout.text).toBe("line-497\nline-498\nline-499");
      expect(value.logs.stdout.truncated).toBe(true);
      expect(value.logs.stderr.text).toBe("fixture error");
      expect((await f.status("logs")).logs).toBeUndefined();
      await appendFile(join(plan.directory, "stdout.log"), "a".repeat(200000));
      const bounded = await f.status("logs", 3);
      expect(Buffer.byteLength(bounded.logs.stdout.text)).toBeLessThanOrEqual(
        FACTORY_JOB_MAX_TAIL_BYTES,
      );
      expect(bounded.logs.stdout.truncated).toBe(true);
      await writeFile(
        join(plan.directory, "stdout.log"),
        Buffer.alloc(65536, 0x80),
      );
      const invalidUtf8 = await f.status("logs", 3);
      expect(
        Buffer.byteLength(invalidUtf8.logs.stdout.text),
      ).toBeLessThanOrEqual(FACTORY_JOB_MAX_TAIL_BYTES);
      expect(invalidUtf8.logs.stdout.truncated).toBe(true);
      await writeFile(
        join(plan.directory, "stdout.log"),
        Buffer.from("😀".repeat(16384) + "END"),
      );
      const boundary = await f.status("logs", 3);
      expect(Buffer.byteLength(boundary.logs.stdout.text)).toBeLessThanOrEqual(
        FACTORY_JOB_MAX_TAIL_BYTES,
      );
      expect(boundary.logs.stdout.text).toEndWith("END");
      expect(boundary.logs.stdout.text).not.toContain("\uFFFD");
    } finally {
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "symlink and incomplete job namespaces are preserved; missing owner proof stays indeterminate",
  async () => {
    const f = await fixture();
    const outside = join(f.root, "outside");
    try {
      await mkdir(outside, { mode: 0o700 });
      await writeFile(join(outside, "sentinel"), "preserved");
      const base = join(f.config.artifactRoot, "factory-jobs");
      await symlink(outside, base);
      const refused = await execute(f.plan("symlink", "process.exit(0)"));
      expect(refused.exitCode).toBe(2);
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe(
        "preserved",
      );
      await rm(base);
      await mkdir(base, { mode: 0o700 });
      await mkdir(join(base, "incomplete"), { mode: 0o700 });
      await writeFile(join(base, "incomplete", "unowned"), "preserved");
      expect(
        (await execute(f.plan("incomplete", "process.exit(0)"))).exitCode,
      ).toBe(2);
      expect(await readFile(join(base, "incomplete", "unowned"), "utf8")).toBe(
        "preserved",
      );
      const plan = f.plan("unknown", "process.exit(0)");
      expect((await execute(plan)).exitCode).toBe(0);
      await f.completed("unknown");
      await rm(join(plan.directory, "exit.json"));
      await writeFile(
        join(plan.directory, "state.json"),
        JSON.stringify({
          fingerprint: plan.fingerprint,
          status: "active",
          pid: process.pid,
          processStart: "0",
        }),
        { mode: 0o600 },
      );
      const value = await f.status("unknown");
      expect(value.status).toBe("indeterminate");
      expect(value.exitCode).toBeUndefined();
      expect(value.processAlive).toBe(false);
      const rawStat = await readFile("/proc/" + process.pid + "/stat", "utf8");
      const processStart = rawStat
        .slice(rawStat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/)[19];
      await writeFile(
        join(plan.directory, "state.json"),
        JSON.stringify({
          fingerprint: plan.fingerprint,
          status: "active",
          pid: process.pid,
          processStart,
          bootId: "00000000-0000-0000-0000-000000000000",
        }),
        { mode: 0o600 },
      );
      const wrongBoot = await f.status("unknown");
      expect(wrongBoot.status).toBe("indeterminate");
      expect(wrongBoot.exitCode).toBeUndefined();
      expect(wrongBoot.processAlive).toBe(false);

      expect((await execute(plan)).exitCode).toBe(0);
      expect((await f.status("unknown")).status).toBe("indeterminate");
      // Leave the fixture inactive for cleanup without claiming a terminal owner result.
      await writeFile(
        join(plan.directory, "state.json"),
        JSON.stringify({
          fingerprint: plan.fingerprint,
          status: "indeterminate",
        }),
        { mode: 0o600 },
      );
      await symlink(
        join(outside, "sentinel"),
        join(plan.directory, "exit.json"),
      );
      expect(
        (await execute(factoryJobStatusPlan(f.config, "unknown"))).exitCode,
      ).toBe(2);
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe(
        "preserved",
      );
    } finally {
      await f.cleanup();
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "a detached cache-like child inherits no factory or submission lease",
  async () => {
    const f = await fixture();
    const marker = join(f.root, "detached-child-pid");
    const daemonCode =
      "await Bun.write(" +
      JSON.stringify(marker) +
      ", String(process.pid)); await Bun.sleep(600);";
    const ownerCode =
      "const child = Bun.spawn(['setsid','--fork',process.execPath,'--eval'," +
      JSON.stringify(daemonCode) +
      "], {stdin:'ignore',stdout:'inherit',stderr:'inherit'}); await child.exited;";
    const plan = f.plan("daemon-owner", ownerCode);
    try {
      expect((await execute(plan)).exitCode).toBe(0);
      expect((await f.completed("daemon-owner")).exitCode).toBe(0);
      await until("detached child started", () => Bun.file(marker).exists());
      const pid = Number(await Bun.file(marker).text());
      expect(() => process.kill(pid, 0)).not.toThrow();
      const paths = [
        f.config.lockPath,
        join(f.root, "locks", "aphrody.source.lock"),
        join(f.config.artifactRoot, "factory-jobs", ".submit.lock"),
      ];
      const probes = await Promise.all(
        paths.map(
          (path) => launch("flock -n -- " + quoted(path) + " true").result,
        ),
      );
      expect(probes.every((probe) => probe.exitCode === 0)).toBe(true);
      const next = f.plan("after-daemon", "process.exit(0)");
      expect((await execute(next)).exitCode).toBe(0);
      expect((await f.completed("after-daemon")).exitCode).toBe(0);
      await Bun.sleep(650);
    } finally {
      await f.cleanup();
    }
  },
);
