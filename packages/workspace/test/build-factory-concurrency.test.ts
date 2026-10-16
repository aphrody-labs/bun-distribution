// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFactoryPlan,
  buildFactoryPreparePlan,
  type BuildFactoryConfig,
} from "../src/build-factory.ts";

type Environment = Record<string, string | undefined>;
function launch(args: readonly string[], env: Environment, cwd?: string) {
  const child = Bun.spawn([...args], {
    windowsHide: true,
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 12_000,
  });
  const result = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => ({ stdout, stderr, code }));
  return { child, result };
}
async function until(
  label: string,
  predicate: () => Promise<boolean>,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- Poll a real process barrier, rather than infer ordering from a fixed delay.
    if (await predicate()) return;
    // eslint-disable-next-line no-await-in-loop -- The fixture barrier must be observed before advancing the next process.
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for " + label);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-concurrency-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const processes: ReturnType<typeof launch>[] = [];
  const env: Environment = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
  };
  async function git(cwd: string, ...args: string[]) {
    const result = await launch(["git", ...args], env, cwd).result;
    if (result.code !== 0)
      throw new Error("Fixture Git failed: " + result.stderr);
    return result.stdout.trim();
  }
  await git(root, "init", "--quiet", "-b", "main", source);
  await git(source, "config", "user.name", "fixture");
  await git(source, "config", "user.email", "fixture@localhost");
  await writeFile(join(source, "source.txt"), "pinned source\n");
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "fixture source");
  const revision = await git(source, "rev-parse", "HEAD");
  await git(root, "clone", "--quiet", "--bare", source, remote);
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    rust: { maxJobs: 1 },
    cacheRoot: join(root, "cache"),
    artifactRoot: join(root, "artifacts"),
    lockPath: join(root, "locks/heavy.lock"),
    repositories: {
      aphrody: join(root, "workspaces/aphrody"),
      yolo: join(root, "workspaces/yolo"),
    },
  };
  await mkdir(join(root, "locks"), { recursive: true });
  await mkdir(join(root, "workspaces"), { recursive: true });
  function start(args: readonly string[], environment: Environment = env) {
    const job = launch(args, environment);
    processes.push(job);
    return job;
  }
  async function lease(repository: string) {
    const held = join(root, repository + "-lease-held");
    const lock =
      repository === "heavy"
        ? config.lockPath
        : join(root, "locks", repository + ".source.lock");
    const job = start([
      "flock",
      "--close",
      "--",
      lock,
      process.execPath,
      "-e",
      'await Bun.write(process.argv.at(-1), "held"); await Bun.stdin.text();',
      held,
    ]);
    await until("source lease acquired", () => Bun.file(held).exists());
    let released = false;
    return {
      lock,
      async release() {
        if (!released) {
          released = true;
          job.child.stdin.end();
        }
        return job.result;
      },
    };
  }
  function prepare(repository: "aphrody" | "yolo", pin = revision) {
    const url = "https://github.com/aphrody-labs/" + repository + ".git";
    const environment: Environment = {
      ...env,
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_1: "url.file://" + remote + ".insteadOf",
      GIT_CONFIG_VALUE_1: url,
      GIT_CONFIG_KEY_2: "protocol.file.allow",
      GIT_CONFIG_VALUE_2: "always",
    };
    const plan = buildFactoryPreparePlan(
      config,
      repository,
      pin,
      {
        path: source,
        remote: "origin",
        url,
        owners: ["aphrody-labs"],
      },
      { initializeSubmodules: false },
    );
    return start(["bash", "-c", plan.transport[5]!], environment);
  }
  async function buildCheckout() {
    await git(root, "clone", "--quiet", source, config.repositories.yolo!);
    await git(config.repositories.yolo!, "config", "user.name", "fixture");
    await git(
      config.repositories.yolo!,
      "config",
      "user.email",
      "fixture@localhost",
    );
  }
  function build() {
    const marker = join(root, "owner-command-entered");
    const plan = buildFactoryPlan(config, "yolo", revision, [
      process.execPath,
      "-e",
      'await Bun.write(process.argv.at(-1), "owner ran");',
      marker,
    ]);
    return { marker, process: start(["bash", "-c", plan.transport[5]!]) };
  }
  async function buildOwnsHeavyLock() {
    await until(
      "build owns heavy lock while waiting for its source",
      async () => {
        const probe = await launch(
          ["flock", "-n", "--", config.lockPath, "true"],
          env,
        ).result;
        return probe.code === 1;
      },
    );
  }
  return {
    root,
    source,
    revision,
    config,
    git,
    lease,
    prepare,
    buildCheckout,
    build,
    buildOwnsHeavyLock,
    async cleanup() {
      for (const process of processes) {
        if (process.child.exitCode === null) process.child.stdin.end();
      }
      await Promise.allSettled(processes.map((job) => job.result));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test.skipIf(process.platform === "win32")(
  "a queued build cannot run the owner command until its source lease is released",
  async () => {
    const f = await fixture();
    try {
      await f.buildCheckout();
      const lease = await f.lease("yolo");
      const build = f.build();
      await f.buildOwnsHeavyLock();
      // This barrier proves the build supervisor reached its locks; absence alone could race process startup.
      expect(await Bun.file(build.marker).exists()).toBe(false);
      expect((await lease.release()).code).toBe(0);
      const result = await build.process.result;
      expect(result.code).toBe(0);
      expect(await readFile(build.marker, "utf8")).toBe("owner ran");
    } finally {
      await f.cleanup();
    }
  },
  20_000,
);

test.skipIf(process.platform === "win32")(
  "fresh disjoint preparation progresses while both a heavy job and another source lease are held",
  async () => {
    const f = await fixture();
    try {
      const lease = await f.lease("yolo");
      const heavy = await f.lease("heavy");
      let yoloFinished = false;
      const yolo = f.prepare("yolo");
      const yoloResult = yolo.result.then((result) => {
        yoloFinished = true;
        return result;
      });
      const aphrody = await f.prepare("aphrody").result;
      expect(aphrody.code).toBe(0);
      expect(yoloFinished).toBe(false);
      expect(
        await Bun.file(
          join(f.config.repositories.yolo!, "source.txt"),
        ).exists(),
      ).toBe(false);
      expect(
        await f.git(f.config.repositories.aphrody!, "rev-parse", "HEAD"),
      ).toBe(f.revision);
      // The independent fresh preparation completed despite the existing heavy job.
      const heavyProbe = await launch(
        ["flock", "-n", "--", f.config.lockPath, "true"],
        process.env,
      ).result;
      expect(heavyProbe.code).toBe(1);
      expect((await heavy.release()).code).toBe(0);
      expect((await lease.release()).code).toBe(0);
      expect((await yoloResult).code).toBe(0);
      expect(
        await f.git(f.config.repositories.yolo!, "rev-parse", "HEAD"),
      ).toBe(f.revision);
    } finally {
      await f.cleanup();
    }
  },
  20_000,
);

test.skipIf(process.platform === "win32")(
  "a queued build rechecks the requested pin after source preparation releases its lease",
  async () => {
    const f = await fixture();
    try {
      await f.buildCheckout();
      const lease = await f.lease("yolo");
      const build = f.build();
      await f.buildOwnsHeavyLock();
      await writeFile(
        join(f.config.repositories.yolo!, "source.txt"),
        "new prepared source\n",
      );
      await f.git(f.config.repositories.yolo!, "add", "source.txt");
      await f.git(
        f.config.repositories.yolo!,
        "commit",
        "--quiet",
        "-m",
        "changed source pin",
      );
      expect((await lease.release()).code).toBe(0);
      const result = await build.process.result;
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("source revision differs");
      expect(await Bun.file(build.marker).exists()).toBe(false);
    } finally {
      await f.cleanup();
    }
  },
  20_000,
);

test.skipIf(process.platform !== "linux")(
  "existing-source preparation waits behind the heavy lock until legacy work finishes",
  async () => {
    const f = await fixture();
    try {
      expect((await f.prepare("yolo").result).code).toBe(0);
      await writeFile(join(f.source, "source.txt"), "next prepared pin\n");
      await f.git(f.source, "add", "source.txt");
      await f.git(f.source, "commit", "--quiet", "-m", "next source");
      const next = await f.git(f.source, "rev-parse", "HEAD");
      await f.git(
        f.source,
        "push",
        "--quiet",
        join(f.root, "remote.git"),
        "main",
      );
      const heavy = await f.lease("heavy");
      const pending = f.prepare("yolo", next);
      const inode = (await stat(f.config.lockPath)).ino;
      await until(
        "existing preparation queued on the legacy heavy lock",
        async () => {
          const locks = await Bun.file("/proc/locks").text();
          return locks
            .split("\n")
            .some(
              (line) =>
                /->\s+FLOCK\s/.test(line) &&
                line.split(/\s+/).some((field) => field.endsWith(":" + inode)),
            );
        },
      );
      expect(pending.child.exitCode).toBeNull();
      expect(
        await f.git(f.config.repositories.yolo!, "rev-parse", "HEAD"),
      ).toBe(f.revision);
      expect(
        await readFile(join(f.config.repositories.yolo!, "source.txt"), "utf8"),
      ).toBe("pinned source\n");
      // The compatibility probe must release the source mutex before waiting for heavy: no inverse lock order.
      const sourceProbe = await launch(
        ["flock", "-n", "--", join(f.root, "locks/yolo.source.lock"), "true"],
        process.env,
      ).result;
      expect(sourceProbe.code).toBe(0);
      expect((await heavy.release()).code).toBe(0);
      const prepared = await pending.result;
      expect(prepared.code).toBe(0);
      expect(
        await f.git(f.config.repositories.yolo!, "rev-parse", "HEAD"),
      ).toBe(next);
      expect(
        await readFile(join(f.config.repositories.yolo!, "source.txt"), "utf8"),
      ).toBe("next prepared pin\n");
    } finally {
      await f.cleanup();
    }
  },
  20_000,
);
