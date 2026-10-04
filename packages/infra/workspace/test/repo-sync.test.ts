// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireSourceSyncLock,
  loadSourceSyncConfig,
  syncRepository,
  watchSources,
  type SourceSyncConfig,
  type SyncOptions,
  type SyncReport,
  type SyncRepository,
} from "../../../../scripts/source-sync.ts";
import { FactoryBuildQueue, runFactoryWorker, type FactoryJob } from "../src/repo-sync.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Fixture Git failed: ${stderr}`);
  return stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-commit-sync-"));
  roots.push(root);
  const local = join(root, "source");
  const remote = join(root, "remote.git");
  await mkdir(local);
  await run(root, "init", "--bare", "--quiet", remote);
  await run(local, "init", "--quiet", "--initial-branch=main");
  await run(local, "config", "user.name", "fixture-owner");
  await run(local, "config", "user.email", "fixture@localhost");
  const commit = async (value: string) => {
    await writeFile(join(local, "source.txt"), value);
    await run(local, "add", "source.txt");
    await run(local, "commit", "--quiet", "-m", value);
    return run(local, "rev-parse", "HEAD");
  };
  const base = await commit("initial");
  await run(local, "remote", "add", "origin", remote);
  await run(local, "push", "--quiet", "origin", "main");
  await run(local, "checkout", "--quiet", "-b", "dev");
  const repository: SyncRepository = {
    id: "fixture",
    path: local,
    remote: "origin",
    sourceBranch: "dev",
    destinationBranch: "main",
    fastForward: false,
  };
  const config: SourceSyncConfig = {
    schemaVersion: 1,
    owners: ["aphrody-labs"],
    repositories: [repository],
    pollIntervalMs: 60000,
    debounceMs: 25,
    commandTimeoutMs: 10000,
  };
  const options: SyncOptions = { apply: true, remoteValidator: (url) => url === remote };
  return { root, local, remote, base, commit, repository, config, options };
}

test("exact3 declaration uses existing owner remotes and explicit main destinations", async () => {
  const config = await loadSourceSyncConfig();
  expect(
    config.repositories.map((repo) => [
      repo.id,
      repo.remote,
      repo.sourceBranch,
      repo.destinationBranch,
    ]),
  ).toEqual([
    ["yolo", "origin", "dev", "main"],
    ["aphrody", "workspace", "main", "main"],
    ["aphrody-py", "origin", "main", "main"],
  ]);
});
test("plan does not fetch or push and dirty source commits synchronize without staging private files", async () => {
  const value = await fixture();
  const head = await value.commit("completed commit");
  await writeFile(join(value.local, "private.env"), "SECRET_FIXTURE_VALUE");
  await writeFile(join(value.local, "source.txt"), "concurrent owner work");
  const index = await run(value.local, "write-tree");
  const planned = await syncRepository(value.repository, value.config, {
    ...value.options,
    apply: false,
  });
  expect(planned).toMatchObject({ status: "ahead", action: "planned", ahead: 1, dirty: true });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
  const synchronized = await syncRepository(value.repository, value.config, value.options);
  expect(synchronized).toMatchObject({ status: "current", action: "pushed", dirty: true });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(head);
  expect(await run(value.local, "write-tree")).toBe(index);
  expect(await readFile(join(value.local, "source.txt"), "utf8")).toBe("concurrent owner work");
  expect(await readFile(join(value.local, "private.env"), "utf8")).toBe("SECRET_FIXTURE_VALUE");
  expect(JSON.stringify(synchronized)).not.toContain("SECRET_FIXTURE_VALUE");
});
test("divergent destination history remains unchanged", async () => {
  const value = await fixture();
  const head = await value.commit("local commit");
  await run(value.local, "checkout", "--quiet", "main");
  const remoteHead = await value.commit("independent remote commit");
  await run(value.local, "push", "--quiet", "origin", "main");
  await run(value.local, "checkout", "--quiet", "dev");
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row.status).toBe("diverged");
  expect(await run(value.local, "rev-parse", "dev")).toBe(head);
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(remoteHead);
});
test("normal push rejection is reported without forcing destination history", async () => {
  const value = await fixture();
  await value.commit("new source");
  const hook = join(value.remote, "hooks", "update");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row).toMatchObject({ status: "push-error", action: "normal-push-refused" });
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
});
test("unowned or credential-bearing remote and in-progress Git operations are preserved", async () => {
  const value = await fixture();
  await value.commit("new source");
  expect((await syncRepository(value.repository, value.config, { apply: true })).status).toBe(
    "unowned-remote",
  );
  await run(
    value.local,
    "remote",
    "set-url",
    "--push",
    "origin",
    "https://hidden:SECRET@github.com/aphrody-labs/fixture.git",
  );
  const row = await syncRepository(value.repository, value.config, value.options);
  expect(row.status).toBe("unowned-remote");
  expect(JSON.stringify(row)).not.toContain("SECRET");
  await run(value.local, "remote", "set-url", "--push", "origin", value.remote);
  await writeFile(join(value.local, ".git", "MERGE_HEAD"), value.base);
  expect((await syncRepository(value.repository, value.config, value.options)).status).toBe(
    "operation-in-progress",
  );
  expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(value.base);
});
test("behind checkout fast-forwards only when clean and on the same declared branch", async () => {
  const value = await fixture();
  const newer = await value.commit("remote advance");
  await run(value.local, "push", "--quiet", "origin", "dev:main");
  await run(value.local, "checkout", "--quiet", "main");
  const repository = { ...value.repository, sourceBranch: "main", fastForward: true };
  await writeFile(join(value.local, "private.env"), "untouched");
  expect((await syncRepository(repository, value.config, value.options)).action).toBe(
    "local-worktree-preserved",
  );
  expect(await run(value.local, "rev-parse", "main")).toBe(value.base);
  await rm(join(value.local, "private.env"));
  expect((await syncRepository(repository, value.config, value.options)).action).toBe(
    "fast-forwarded",
  );
  expect(await run(value.local, "rev-parse", "main")).toBe(newer);
});
test("Git source-ref event triggers synchronization before the fallback and abort closes watch", async () => {
  const value = await fixture();
  const controller = new AbortController();
  const reports: SyncReport[] = [];
  let ready: (() => void) | undefined;
  const initial = new Promise<void>((resolveReady) => {
    ready = resolveReady;
  });
  const deadline = setTimeout(() => controller.abort(), 3000);
  const watched = watchSources(value.config, {
    ...value.options,
    signal: controller.signal,
    onReport: (report) => {
      reports.push(report);
      ready?.();
      ready = undefined;
      if (report.rows[0]?.action === "pushed") controller.abort();
    },
  });
  try {
    await initial;
    const head = await value.commit("event driven commit");
    await watched;
    expect(reports.length).toBe(2);
    expect(reports[1]?.rows[0]?.action).toBe("pushed");
    expect(await run(value.root, "--git-dir", value.remote, "rev-parse", "main")).toBe(head);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await watched;
  }
}, 5000);
test("protected PID lock prevents overlapping owners and releases only its own lock", async () => {
  const value = await fixture();
  const state = join(value.root, "state");
  const release = acquireSourceSyncLock(state);
  expect(() => acquireSourceSyncLock(state)).toThrow("already has an owner");
  expect((await stat(join(state, "owner.lock"))).mode & 0o777).toBe(0o600);
  release();
  expect(existsSync(join(state, "owner.lock"))).toBe(false);
});
test("factory queue coalesces later commits while a real background worker is live", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  const jobs: FactoryJob[] = [];
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const queue = new FactoryBuildQueue(value.config, directory, (path) => {
    jobs.push(JSON.parse(readFileSync(path, "utf8")) as FactoryJob);
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(200)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    children.push(child);
    return child;
  });
  const report = (revision: string): SyncReport => ({
    schemaVersion: 3,
    at: new Date().toISOString(),
    mode: "apply",
    rows: [
      {
        repo: value.repository.id,
        remote: value.repository.remote,
        sourceBranch: "dev",
        destinationBranch: "main",
        status: "current",
        action: "pushed",
        sourceHead: revision,
        destinationHead: revision,
      },
    ],
  });
  try {
    queue.enqueue(report("a".repeat(40)));
    queue.enqueue(report("b".repeat(40)));
    queue.enqueue(report("c".repeat(40)));
    expect(jobs.map((job) => job.revision)).toEqual(["a".repeat(40)]);
    await children[0]!.exited;
    await Bun.sleep(20);
    expect(jobs.map((job) => job.revision)).toEqual(["a".repeat(40), "c".repeat(40)]);
    await children[1]!.exited;
    await Bun.sleep(20);
    queue.enqueue(report("c".repeat(40)));
    expect(jobs.length).toBe(2);
  } finally {
    queue.close();
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all(children.map((child) => child.exited));
  }
});
test("factory queue adopts an existing live handle and watcher stop preserves it", async () => {
  const value = await fixture();
  value.repository.buildCommand = ["fixture"];
  const directory = join(value.root, "builds");
  await mkdir(directory);
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(1000)"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const job: FactoryJob = {
    repo: "fixture",
    revision: "a".repeat(40),
    pid: child.pid,
    status: "running",
    phase: "build",
    requestedAt: new Date().toISOString(),
  };
  await writeFile(join(directory, "fixture.json"), JSON.stringify(job));
  let launched = false;
  const queue = new FactoryBuildQueue(value.config, directory, () => {
    launched = true;
    throw new Error("must not replace live worker");
  });
  try {
    queue.enqueue({
      schemaVersion: 3,
      at: "fixture",
      mode: "apply",
      rows: [
        {
          repo: "fixture",
          remote: "origin",
          sourceBranch: "dev",
          destinationBranch: "main",
          status: "current",
          action: "pushed",
          sourceHead: "b".repeat(40),
          destinationHead: "b".repeat(40),
        },
      ],
    });
    expect(launched).toBe(false);
    queue.close();
    expect(() => process.kill(child.pid, 0)).not.toThrow();
    expect(JSON.parse(await readFile(join(directory, "pending.json"), "utf8"))).toEqual({
      fixture: "b".repeat(40),
    });
  } finally {
    queue.close();
    child.kill("SIGKILL");
    await child.exited;
  }
});
test("native factory worker prepares the exact pin before its declared build and propagates rejection", async () => {
  const value = await fixture();
  value.repository.id = "yolo";
  value.repository.buildCommand = ["bash", "owned-build.sh"];
  await mkdir(join(value.root, "config"));
  await writeFile(join(value.root, "config", "commit-sync.json"), JSON.stringify(value.config));
  const state = join(value.root, "state");
  await mkdir(join(state, "builds"), { recursive: true });
  const path = join(state, "builds", "yolo.json");
  const job: FactoryJob = {
    repo: "yolo",
    revision: "a".repeat(40),
    status: "starting",
    phase: "prepare",
    requestedAt: "fixture",
  };
  await writeFile(path, JSON.stringify(job));
  const calls: string[][] = [];
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async (args) => {
        calls.push(args);
        return 7;
      },
      state,
    ),
  ).toBe(7);
  expect(calls).toEqual([["prepare", "--repo", "yolo", "--revision", job.revision, "--apply"]]);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ status: "failed", exitCode: 7 });
  await writeFile(path, JSON.stringify(job));
  calls.length = 0;
  expect(
    await runFactoryWorker(
      path,
      value.root,
      async (args) => {
        calls.push(args);
        return 0;
      },
      state,
    ),
  ).toBe(0);
  expect(calls).toEqual([
    ["prepare", "--repo", "yolo", "--revision", job.revision, "--apply"],
    ["run", "--repo", "yolo", "--revision", job.revision, "--", "bash", "owned-build.sh"],
  ]);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    status: "succeeded",
    exitCode: 0,
  });
});
test.skipIf(process.platform === "win32")(
  "SIGTERM ends CLI watch and releases protected lock",
  async () => {
    const value = await fixture();
    await mkdir(join(value.root, "config"));
    await writeFile(join(value.root, "config", "commit-sync.json"), JSON.stringify(value.config));
    const entry = join(value.root, "watch.ts");
    await writeFile(
      entry,
      `import { runSourceSync } from ${JSON.stringify(join(import.meta.dir, "../../../../scripts/source-sync.ts"))};\nprocess.exit(await runSourceSync(["watch"], ${JSON.stringify(value.root)}));\n`,
    );
    const home = join(value.root, "protected");
    const child = Bun.spawn([process.execPath, entry], {
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, APHRODY_HOME: home },
    });
    const lock = join(home, "state", "commit-sync", "owner.lock");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      // oxlint-disable-next-line no-await-in-loop -- Poll a specific live child readiness marker.
      for (let attempt = 0; attempt < 100 && !existsSync(lock); attempt++) await Bun.sleep(10);
      expect(existsSync(lock)).toBe(true);
      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);
      expect(existsSync(lock)).toBe(false);
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  },
  5000,
);
