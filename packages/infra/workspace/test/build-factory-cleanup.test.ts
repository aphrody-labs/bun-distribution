// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  factoryCleanupScript,
  factoryPathReferenced,
  factoryTransientShell,
  validateFactoryCleanup,
  withFactoryResource,
  prewarmFactorySccache,
  factoryLeaseHeld,
} from "../src/build-factory-cleanup.ts";
import type { BuildFactoryConfig } from "../src/build-factory.ts";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aphrody-factory-cleanup-"));
  roots.push(root);
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    cacheRoot: join(root, "cache"),
    artifactRoot: join(root, "artifacts"),
    lockPath: join(root, "locks/heavy.lock"),
    repositories: { aphrody: join(root, "workspaces/aphrody") },
    rust: { maxJobs: 1 },
  };
  const docker = join(root, "docker-fixture");
  writeFileSync(docker, "#!/bin/sh\nexit 0\n");
  chmodSync(docker, 0o755);
  return { docker, root, config, transient: join(root, "transient") };
}
test("retired-output allowlist refuses compiler cache, source, traversal and multiple scratch roots", () => {
  const f = fixture();
  const policy = {
    transientRoot: f.transient,
    retiredOutputs: [
      {
        path: join(f.root, "cache/cargo/retired"),
        terminalReceipt: join(f.root, "artifacts/job.exit"),
        reason: "completed generated output",
      },
    ],
  };
  expect(() => validateFactoryCleanup(f.config, policy)).not.toThrow();
  for (const path of [
    f.config.cacheRoot,
    join(f.root, "cache/sccache"),
    f.config.repositories.aphrody!,
    join(f.root, "cache/cargo/../sccache"),
    join(f.root, "cache/cargo/a/b"),
  ]) {
    expect(() =>
      validateFactoryCleanup(f.config, {
        ...policy,
        retiredOutputs: [{ ...policy.retiredOutputs[0]!, path }],
      }),
    ).toThrow();
  }
  expect(() =>
    validateFactoryCleanup(f.config, { ...policy, transientRoot: join(f.root, "other") }),
  ).toThrow();
  const script = factoryCleanupScript(f.config, policy, false);
  expect(script).toContain("processUse");
  expect(script).toContain("Docker");
  expect(script).toContain('"apply":false');
});
for (const exitCode of [0, 17])
  test(`singleton scratch empties after joined command and preserves exit ${exitCode}`, () => {
    const f = fixture();
    const script = [
      "set -euo pipefail",
      ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
      'mkdir -p "$TMPDIR/nested"; printf payload > "$TMPDIR/nested/output"',
      `exit ${exitCode}`,
    ].join("\n");
    const result = Bun.spawnSync(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr.toString()).not.toContain("not qualified");
    expect(readdirSync(f.transient)).toEqual([]);
  });
test("scratch symlink is preserved without entering or deleting its target", () => {
  const f = fixture();
  const retained = join(f.root, "retained");
  mkdirSync(retained);
  writeFileSync(join(retained, "data"), "keep");
  symlinkSync(retained, f.transient);
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -euo pipefail",
        ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
      ].join("\n"),
    ],
    { stderr: "pipe" },
  );
  expect(result.exitCode).toBe(2);
  expect(readdirSync(retained)).toEqual(["data"]);
});
test("live background child keeps scratch until its handle terminates", async () => {
  const f = fixture();
  mkdirSync(f.transient);
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60000)"], {
    cwd: f.transient,
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        [
          "set -euo pipefail",
          ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
          'printf payload > "$TMPDIR/output"',
        ].join("\n"),
      ],
      { stderr: "pipe" },
    );
    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain("retained for live process");
    expect(readdirSync(f.transient)).toEqual([]);
  } finally {
    child.kill();
    await child.exited;
  }
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -euo pipefail",
        ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
      ].join("\n"),
    ],
    { stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  expect(readdirSync(f.transient)).toEqual([]);
});

test("Docker bind source preserves scratch without a host process handle", () => {
  const f = fixture();
  mkdirSync(f.transient);
  writeFileSync(join(f.transient, "keep"), "payload");
  writeFileSync(
    f.docker,
    `#!/bin/sh\nif [ "$1" = ps ]; then echo container; else printf '%s' '${JSON.stringify([{ Mounts: [{ Source: f.transient }] }])}'; fi\n`,
  );
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -euo pipefail",
        ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
      ].join("\n"),
    ],
    { stderr: "pipe" },
  );
  expect(result.exitCode).toBe(3);
  expect(readdirSync(f.transient)).toEqual(["keep"]);
});

for (const reference of ["environment", "queued argument"])
  test(`live ${reference} preserves scratch before opening an output`, async () => {
    const f = fixture();
    mkdirSync(f.transient);
    writeFileSync(join(f.transient, "keep"), "payload");
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        "await Bun.sleep(60000)",
        ...(reference === "queued argument" ? [f.transient] : []),
      ],
      {
        cwd: f.root,
        env: { ...process.env, ...(reference === "environment" ? { TMPDIR: f.transient } : {}) },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    try {
      const result = Bun.spawnSync(
        [
          "bash",
          "-c",
          [
            "set -euo pipefail",
            ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
          ].join("\n"),
        ],
        { stderr: "pipe" },
      );
      expect(result.exitCode).toBe(3);
      expect(readdirSync(f.transient)).toEqual(["keep"]);
    } finally {
      child.kill();
      await child.exited;
    }
  });

test("SIGTERM empties joined scratch and preserves signal exit status", () => {
  const f = fixture();
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -euo pipefail",
        ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
        'printf payload > "$TMPDIR/output"',
        'kill -TERM "$$"',
      ].join("\n"),
    ],
    { stderr: "pipe" },
  );
  expect(result.exitCode).toBe(143);
  expect(readdirSync(f.transient)).toEqual([]);
});

test("resource markers cannot impersonate an inherited heavy lock", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  writeFileSync(f.config.lockPath, "");
  const owner = join(import.meta.dir, "../src/build-factory-cleanup.ts");
  const env = {
    ...process.env,
    APHRODY_FACTORY_RESOURCE: f.transient,
    APHRODY_FACTORY_LOCK_PATH: f.config.lockPath,
  };
  const forged = Bun.spawnSync([process.execPath, owner, "--held"], { env });
  expect(forged.exitCode).toBe(1);
  const unrelated = Bun.spawn(
    ["flock", "--close", f.config.lockPath, "bash", "-c", "printf READY; cat >/dev/null"],
    { stdin: "pipe", stdout: "pipe" },
  );
  const reader = unrelated.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  try {
    const forgedWhileBusy = Bun.spawnSync([process.execPath, owner, "--held"], { env });
    expect(forgedWhileBusy.exitCode).toBe(1);
  } finally {
    unrelated.stdin.end();
    await unrelated.exited;
  }
  const inherited = Bun.spawnSync(
    ["flock", "--close", f.config.lockPath, process.execPath, owner, "--held"],
    { env },
  );
  expect(inherited.exitCode).toBe(0);
});

test("direct route holds the kernel lease through nested work and cleans on failure", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  const config = {
    ...f.config,
    cleanup: {
      transientRoot: f.transient,
      retiredOutputs: [],
      privilegeBinary: "/usr/bin/sudo" as const,
    },
  };
  const previousTmp = process.env.TMPDIR;
  await expect(
    withFactoryResource(
      config,
      async () => {
        expect(process.env.TMPDIR).toBe(f.transient);
        writeFileSync(join(f.transient, "generated"), "temporary");
        const competitor = Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"]);
        expect(competitor.exitCode).toBe(1);
        expect(factoryLeaseHeld(config.lockPath)).toBe(false); // The in-process route's supervisor is a child, not an inherited ancestor.
        await withFactoryResource(
          config,
          async () => {
            expect(readdirSync(f.transient)).toEqual(["generated"]);
          },
          f.docker,
        );
        throw new Error("fixture failure");
      },
      f.docker,
    ),
  ).rejects.toThrow("fixture failure");
  expect(process.env.TMPDIR).toBe(previousTmp);
  expect(readdirSync(f.transient)).toEqual([]);
  const released = Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"]);
  expect(released.exitCode).toBe(0);
});

test("a terminated direct owner keeps its lease until the surviving build child exits", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  const ownerModule = join(import.meta.dir, "../src/build-factory-cleanup.ts");
  const runner = join(f.root, "owner.ts");
  const pidFile = join(f.root, "build-child.pid");
  const config = {
    ...f.config,
    cleanup: { transientRoot: f.transient, retiredOutputs: [], privilegeBinary: "/usr/bin/sudo" },
  };
  writeFileSync(
    runner,
    `import { withFactoryResource } from ${JSON.stringify(ownerModule)};
import { writeFileSync } from "node:fs";
await withFactoryResource(${JSON.stringify(config)}, async () => {
  writeFileSync(process.env.TMPDIR + "/temporary", "generated");
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60000)"], { cwd: process.env.TMPDIR, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  process.stdout.write("READY");
  await Bun.sleep(60000);
}, ${JSON.stringify(f.docker)});
`,
  );
  const direct = Bun.spawn([process.execPath, runner], { stdout: "pipe", stderr: "ignore" });
  const reader = direct.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(ready.value)).toBe("READY");
  const childPid = Number(await Bun.file(pidFile).text());
  try {
    direct.kill("SIGKILL");
    await direct.exited;
    await Bun.sleep(100);
    expect(Bun.spawnSync(["flock", "--nonblock", f.config.lockPath, "true"]).exitCode).toBe(1);
    expect(readdirSync(f.transient)).toEqual(["temporary"]);
  } finally {
    process.kill(childPid, "SIGTERM");
  }
  let released = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    // Observe this same live lease sequentially; concurrent polling cannot prove release order.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(100);
    if (Bun.spawnSync(["flock", "--nonblock", f.config.lockPath, "true"]).exitCode === 0) {
      released = true;
      break;
    }
  }
  expect(released).toBe(true);
  expect(readdirSync(f.transient)).toEqual([]);
}, 30000);

test("process references distinguish retired targets from live sibling prefixes", () => {
  const path = "/srv/aphrody-build/cache/cargo/aphrody";
  for (const value of [
    path,
    path + "/debug",
    "CARGO_TARGET_DIR=" + path,
    "--target-dir=" + path + "/debug",
    "cargo --target-dir '" + path + "'",
  ])
    expect(factoryPathReferenced(value, path)).toBe(true);
  for (const value of [
    path + "-wsl",
    "CARGO_TARGET_DIR=" + path + "-wsl",
    path + "-wsl/debug",
    "CARGO_TARGET_DIR=" + path + "_old",
    "/other" + path,
  ])
    expect(factoryPathReferenced(value, path)).toBe(false);
});

test("direct startup refuses a symlink and releases the untouched lease", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  const retained = join(f.root, "retained");
  mkdirSync(retained);
  writeFileSync(join(retained, "keep"), "protected");
  symlinkSync(retained, f.transient);
  const config = {
    ...f.config,
    cleanup: {
      transientRoot: f.transient,
      retiredOutputs: [],
      privilegeBinary: "/usr/bin/sudo" as const,
    },
  };
  let invoked = false;
  await expect(
    withFactoryResource(
      config,
      async () => {
        invoked = true;
      },
      f.docker,
    ),
  ).rejects.toThrow("isolation");
  expect(invoked).toBe(false);
  expect(readdirSync(retained)).toEqual(["keep"]);
  expect(Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"]).exitCode).toBe(0);
});

test("surviving child cleanup retains the direct command's original exit code", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  const config = {
    ...f.config,
    cleanup: {
      transientRoot: f.transient,
      retiredOutputs: [],
      privilegeBinary: "/usr/bin/sudo" as const,
    },
  };
  const code = await withFactoryResource(
    config,
    async () => {
      writeFileSync(join(f.transient, "temporary"), "generated");
      const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(500)"], {
        cwd: f.transient,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(child.pid).toBeGreaterThan(0);
      return 17;
    },
    f.docker,
  );
  expect(code).toBe(17);
  expect(readdirSync(f.transient)).toEqual([]);
  expect(Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"]).exitCode).toBe(0);
}, 30000);

test("a proved waiter on the same heavy lock cannot block terminal scratch cleanup", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"));
  const config = {
    ...f.config,
    cleanup: {
      transientRoot: f.transient,
      retiredOutputs: [],
      privilegeBinary: "/usr/bin/sudo" as const,
    },
  };
  let queued: ReturnType<typeof Bun.spawn> | undefined;
  await withFactoryResource(
    config,
    async () => {
      writeFileSync(join(f.transient, "temporary"), "generated");
      queued = Bun.spawn(
        ["flock", config.lockPath, "bash", "-c", "true", "queued-build", f.transient],
        { env: { ...process.env }, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      );
      await Bun.sleep(100);
      const waiting = (await Bun.file("/proc/locks").text())
        .split("\n")
        .some((line) => line.includes("->") && line.includes(` ${queued!.pid} `));
      expect(waiting).toBe(true);
      expect(readdirSync(f.transient)).toEqual(["temporary"]);
    },
    f.docker,
  );
  expect(await queued!.exited).toBe(0);
  expect(readdirSync(f.transient)).toEqual([]);
}, 30000);

test("shared compiler daemon startup loses job metadata while compiler clients retain their scratch", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"), { recursive: true });
  f.config.cleanup = {
    transientRoot: f.transient,
    privilegeBinary: "/usr/bin/sudo",
    retiredOutputs: [],
  };
  const binary = join(f.root, "sccache-fixture");
  const receipt = join(f.root, "daemon-start.json");
  writeFileSync(
    binary,
    `#!/usr/bin/env bun
await Bun.write(${JSON.stringify(receipt)}, JSON.stringify({tmp:process.env.TMPDIR, cache:process.env.SCCACHE_DIR, idle:process.env.SCCACHE_IDLE_TIMEOUT, resource:process.env.APHRODY_FACTORY_RESOURCE, lock:process.env.APHRODY_FACTORY_LOCK_PATH, target:process.env.CARGO_TARGET_DIR, notify:process.env.SCCACHE_STARTUP_NOTIFY}));
`,
  );
  chmodSync(binary, 0o700);
  const prior = {
    target: process.env.CARGO_TARGET_DIR,
    notify: process.env.SCCACHE_STARTUP_NOTIFY,
    idle: process.env.SCCACHE_IDLE_TIMEOUT,
  };
  try {
    await withFactoryResource(
      f.config,
      async () => {
        process.env.CARGO_TARGET_DIR = join(f.root, "cache/cargo/job");
        process.env.SCCACHE_STARTUP_NOTIFY = join(f.transient, "startup.sock");
        process.env.SCCACHE_IDLE_TIMEOUT = "1";
        await prewarmFactorySccache(f.config, binary);
        expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
          tmp: join(f.root, "cache/sccache/control-plane-tmp"),
          cache: join(f.root, "cache/sccache"),
          idle: "0",
        });
        expect(process.env.TMPDIR).toBe(f.transient);
        expect(process.env.CARGO_TARGET_DIR).toBe(join(f.root, "cache/cargo/job"));
        expect(process.env.SCCACHE_IDLE_TIMEOUT).toBe("1");
        const compiler = Bun.spawn(
          [
            process.execPath,
            "-e",
            'await Bun.write(process.env.TMPDIR + "/compiler-output", "job");',
          ],
          { env: { ...process.env }, stdout: "ignore", stderr: "pipe" },
        );
        expect(await compiler.exited).toBe(0);
        expect(readFileSync(join(f.transient, "compiler-output"), "utf8")).toBe("job");
      },
      f.docker,
    );
    expect(readdirSync(f.transient)).toEqual([]);
    expect(readFileSync(receipt, "utf8")).toContain("control-plane-tmp");
    await expect(prewarmFactorySccache(f.config, binary)).rejects.toThrow(
      "actual factory heavy lease",
    );
  } finally {
    if (prior.target === undefined) delete process.env.CARGO_TARGET_DIR;
    else process.env.CARGO_TARGET_DIR = prior.target;
    if (prior.notify === undefined) delete process.env.SCCACHE_STARTUP_NOTIFY;
    else process.env.SCCACHE_STARTUP_NOTIFY = prior.notify;
    if (prior.idle === undefined) delete process.env.SCCACHE_IDLE_TIMEOUT;
    else process.env.SCCACHE_IDLE_TIMEOUT = prior.idle;
  }
});

test("direct resource CLI passes the acquired job environment to its compiler command", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "locks"), { recursive: true });
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "docker"), 0o700);
  const config = {
    ...f.config,
    cleanup: { transientRoot: f.transient, privilegeBinary: "/usr/bin/sudo", retiredOutputs: [] },
  };
  const configPath = join(f.root, "factory.json");
  writeFileSync(configPath, JSON.stringify(config));
  const receipt = join(f.root, "compiler-environment.json");
  const code = `await Bun.write(${JSON.stringify(receipt)}, JSON.stringify({tmp:process.env.TMPDIR, resource:process.env.APHRODY_FACTORY_RESOURCE})); await Bun.write(process.env.TMPDIR + "/compiler-output", "job");`;
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../src/build-factory-cleanup.ts"),
      configPath,
      process.execPath,
      "-e",
      code,
    ],
    {
      env: { ...process.env, PATH: bin + ":" + process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10000,
    },
  );
  const [exit, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).toBe("");
  expect(exit).toBe(0);
  expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
    tmp: f.transient,
    resource: f.transient,
  });
  expect(readdirSync(f.transient)).toEqual([]);
});
