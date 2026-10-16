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
import { posix } from "node:path";
import {
  factoryCleanupScript,
  factoryPathReferenced,
  factoryTransientShell,
  validateFactoryCleanup,
  withFactoryResource,
  prewarmFactorySccache,
  factoryLeaseHeld,
  inheritedFactoryResourceHeld,
} from "../../src/automation/build-factory-cleanup.ts";
import type { BuildFactoryConfig } from "../../src/automation/build-factory.ts";
// The transient shell, leases and cleanup run on the Linux factory host: procfs, flock(1), sudo and /proc/locks.
const linuxTest = test.skipIf(process.platform !== "linux");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  // Factory paths are POSIX paths of the Linux host; forward slashes keep them valid on Windows too.
  const root = mkdtempSync(posix.join(tmpdir(), "aphrody-factory-cleanup-")).replaceAll("\\", "/");
  roots.push(root);
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    cacheRoot: posix.join(root, "cache"),
    artifactRoot: posix.join(root, "artifacts"),
    lockPath: posix.join(root, "locks/heavy.lock"),
    repositories: { aphrody: posix.join(root, "workspaces/aphrody") },
    rust: { maxJobs: 1 },
  };
  const docker = posix.join(root, "docker-fixture");
  writeFileSync(docker, "#!/bin/sh\nexit 0\n");
  chmodSync(docker, 0o755);
  return { docker, root, config, transient: posix.join(root, "transient") };
}
test("retired-output allowlist refuses compiler cache, source, traversal and multiple scratch roots", () => {
  const f = fixture();
  const policy = {
    transientRoot: f.transient,
    retiredOutputs: [
      {
        path: posix.join(f.root, "cache/cargo/retired"),
        terminalReceipt: posix.join(f.root, "artifacts/job.exit"),
        reason: "completed generated output",
      },
    ],
  };
  expect(() => validateFactoryCleanup(f.config, policy)).not.toThrow();
  for (const path of [
    f.config.cacheRoot,
    posix.join(f.root, "cache/sccache"),
    f.config.repositories.aphrody!,
    posix.join(f.root, "cache/cargo/../sccache"),
    posix.join(f.root, "cache/cargo/a/b"),
  ]) {
    expect(() =>
      validateFactoryCleanup(f.config, {
        ...policy,
        retiredOutputs: [{ ...policy.retiredOutputs[0]!, path }],
      }),
    ).toThrow();
  }
  expect(() =>
    validateFactoryCleanup(f.config, {
      ...policy,
      transientRoot: posix.join(f.root, "other"),
    }),
  ).toThrow();
  const script = factoryCleanupScript(f.config, policy, false);
  expect(script).toContain("processUse");
  expect(script).toContain("Docker");
  expect(script).toContain('"apply":false');
});
for (const exitCode of [0, 17])
  linuxTest(`singleton scratch empties after joined command and preserves exit ${exitCode}`, () => {
    const f = fixture();
    const script = [
      "set -euo pipefail",
      ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo"),
      'mkdir -p "$TMPDIR/nested"; printf payload > "$TMPDIR/nested/output"',
      `exit ${exitCode}`,
    ].join("\n");
    const result = Bun.spawnSync(["bash", "-c", script], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr.toString()).not.toContain("not qualified");
    expect(readdirSync(f.transient)).toEqual([]);
  });
linuxTest("scratch symlink is preserved without entering or deleting its target", () => {
  const f = fixture();
  const retained = posix.join(f.root, "retained");
  mkdirSync(retained);
  writeFileSync(posix.join(retained, "data"), "keep");
  symlinkSync(retained, f.transient);
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      ["set -euo pipefail", ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo")].join("\n"),
    ],
    { windowsHide: true, stderr: "pipe" },
  );
  expect(result.exitCode).toBe(2);
  expect(readdirSync(retained)).toEqual(["data"]);
});
linuxTest("live background child keeps scratch until its handle terminates", async () => {
  const f = fixture();
  mkdirSync(f.transient);
  const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60000)"], {
    windowsHide: true,
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
      { windowsHide: true, stderr: "pipe" },
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
      ["set -euo pipefail", ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo")].join("\n"),
    ],
    { windowsHide: true, stderr: "pipe" },
  );
  expect(result.exitCode).toBe(0);
  expect(readdirSync(f.transient)).toEqual([]);
});

linuxTest("Docker bind source preserves scratch without a host process handle", () => {
  const f = fixture();
  mkdirSync(f.transient);
  writeFileSync(posix.join(f.transient, "keep"), "payload");
  writeFileSync(
    f.docker,
    `#!/bin/sh\nif [ "$1" = ps ]; then echo container; else printf '%s' '${JSON.stringify([{ Mounts: [{ Source: f.transient }] }])}'; fi\n`,
  );
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      ["set -euo pipefail", ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo")].join("\n"),
    ],
    { windowsHide: true, stderr: "pipe" },
  );
  expect(result.exitCode).toBe(3);
  expect(readdirSync(f.transient)).toEqual(["keep"]);
});

for (const reference of ["environment", "queued argument"])
  linuxTest(`live ${reference} preserves scratch before opening an output`, async () => {
    const f = fixture();
    mkdirSync(f.transient);
    writeFileSync(posix.join(f.transient, "keep"), "payload");
    const child = Bun.spawn(
      [process.execPath, "-e", "await Bun.sleep(60000)", ...(reference === "queued argument" ? [f.transient] : [])],
      {
        windowsHide: true,
        cwd: f.root,
        env: {
          ...process.env,
          ...(reference === "environment" ? { TMPDIR: f.transient } : {}),
        },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    try {
      const result = Bun.spawnSync(
        [
          "bash",
          "-c",
          ["set -euo pipefail", ...factoryTransientShell(f.transient, f.docker, undefined, "/usr/bin/sudo")].join("\n"),
        ],
        { windowsHide: true, stderr: "pipe" },
      );
      expect(result.exitCode).toBe(3);
      expect(readdirSync(f.transient)).toEqual(["keep"]);
    } finally {
      child.kill();
      await child.exited;
    }
  });

linuxTest("SIGTERM empties joined scratch and preserves signal exit status", () => {
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
    { windowsHide: true, stderr: "pipe" },
  );
  expect(result.exitCode).toBe(143);
  expect(readdirSync(f.transient)).toEqual([]);
});

linuxTest("resource markers cannot impersonate an inherited heavy lock", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"));
  writeFileSync(f.config.lockPath, "");
  const owner = posix.join(import.meta.dir, "../../src/automation/build-factory-cleanup.ts");
  const env = {
    ...process.env,
    APHRODY_FACTORY_RESOURCE: f.transient,
    APHRODY_FACTORY_LOCK_PATH: f.config.lockPath,
  };
  const forged = Bun.spawnSync([process.execPath, owner, "--held"], {
    windowsHide: true,
    env,
  });
  expect(forged.exitCode).toBe(1);
  const unrelated = Bun.spawn(["flock", "--close", f.config.lockPath, "bash", "-c", "printf READY; cat >/dev/null"], {
    windowsHide: true,
    stdin: "pipe",
    stdout: "pipe",
  });
  const reader = unrelated.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  try {
    const forgedWhileBusy = Bun.spawnSync([process.execPath, owner, "--held"], {
      windowsHide: true,
      env,
    });
    expect(forgedWhileBusy.exitCode).toBe(1);
  } finally {
    unrelated.stdin.end();
    await unrelated.exited;
  }
  const inherited = Bun.spawnSync(["flock", "--close", f.config.lockPath, process.execPath, owner, "--held"], {
    windowsHide: true,
    env,
  });
  expect(inherited.exitCode).toBe(0);
});

linuxTest("pooled transient storage reuses only its declared stable kernel lease", async () => {
  const f = fixture();
  const pool = posix.join(f.root, "storage");
  const transient = posix.join(pool, "transient");
  mkdirSync(pool);
  mkdirSync(posix.join(f.root, "locks"));
  const config: BuildFactoryConfig = {
    ...f.config,
    cacheRoot: posix.join(pool, "cache"),
    artifactRoot: posix.join(pool, "artifacts"),
    cleanup: {
      transientRoot: transient,
      retiredOutputs: [],
      privilegeBinary: "/usr/bin/sudo",
    },
  };
  await withFactoryResource(
    config,
    async () => {
      expect(inheritedFactoryResourceHeld(config)).toBe(true);
      expect(inheritedFactoryResourceHeld()).toBe(false);
      expect(
        inheritedFactoryResourceHeld({
          ...config,
          lockPath: posix.join(f.root, "other.lock"),
        }),
      ).toBe(false);
      await withFactoryResource(
        config,
        async () => {
          expect(inheritedFactoryResourceHeld(config)).toBe(true);
        },
        f.docker,
      );
    },
    f.docker,
  );
  expect(Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"]).exitCode).toBe(0);
});

linuxTest("direct route holds the kernel lease through nested work and cleans on failure", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"));
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
        writeFileSync(posix.join(f.transient, "generated"), "temporary");
        const competitor = Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"], {
          windowsHide: true,
        });
        expect(competitor.exitCode).toBe(1);
        expect(factoryLeaseHeld(config.lockPath)).toBe(true);
        // A compiler wrapper is a sibling of the guardian, not its descendant.
        const owner = posix.join(import.meta.dir, "../../src/automation/build-factory-cleanup.ts");
        const nested = Bun.spawnSync([process.execPath, owner, "--held"], {
          windowsHide: true,
          env: process.env,
        });
        expect(nested.exitCode).toBe(0);
        const otherRoot = posix.join(f.root, "other");
        mkdirSync(posix.join(otherRoot, "locks"), { recursive: true });
        writeFileSync(posix.join(otherRoot, "locks/heavy.lock"), "");
        const differentInode = Bun.spawnSync([process.execPath, owner, "--held"], {
          windowsHide: true,
          env: {
            ...process.env,
            APHRODY_FACTORY_RESOURCE: posix.join(otherRoot, "transient"),
            APHRODY_FACTORY_LOCK_PATH: posix.join(otherRoot, "locks/heavy.lock"),
          },
        });
        expect(differentInode.exitCode).toBe(1);
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
  const released = Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"], {
    windowsHide: true,
  });
  expect(released.exitCode).toBe(0);
});

linuxTest(
  "a terminated direct owner keeps its lease until the surviving build child exits",
  async () => {
    const f = fixture();
    mkdirSync(posix.join(f.root, "locks"));
    const ownerModule = posix.join(import.meta.dir, "../../src/automation/build-factory-cleanup.ts");
    const runner = posix.join(f.root, "owner.ts");
    const pidFile = posix.join(f.root, "build-child.pid");
    const config = {
      ...f.config,
      cleanup: {
        transientRoot: f.transient,
        retiredOutputs: [],
        privilegeBinary: "/usr/bin/sudo",
      },
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
    const direct = Bun.spawn([process.execPath, runner], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "ignore",
    });
    const reader = direct.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(ready.value)).toBe("READY");
    const childPid = Number(await Bun.file(pidFile).text());
    try {
      direct.kill("SIGKILL");
      await direct.exited;
      await Bun.sleep(100);
      expect(
        Bun.spawnSync(["flock", "--nonblock", f.config.lockPath, "true"], {
          windowsHide: true,
        }).exitCode,
      ).toBe(1);
      expect(readdirSync(f.transient)).toEqual(["temporary"]);
    } finally {
      process.kill(childPid, "SIGTERM");
    }
    let released = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      // Observe this same live lease sequentially; concurrent polling cannot prove release order.
      // eslint-disable-next-line no-await-in-loop
      await Bun.sleep(100);
      if (
        Bun.spawnSync(["flock", "--nonblock", f.config.lockPath, "true"], {
          windowsHide: true,
        }).exitCode === 0
      ) {
        released = true;
        break;
      }
    }
    expect(released).toBe(true);
    expect(readdirSync(f.transient)).toEqual([]);
  },
  30000,
);

test("process references distinguish retired targets from live sibling prefixes", () => {
  const path = "/home/ubuntu/build/cache/cargo/aphrody";
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

linuxTest("direct startup refuses a symlink and releases the untouched lease", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"));
  const retained = posix.join(f.root, "retained");
  mkdirSync(retained);
  writeFileSync(posix.join(retained, "keep"), "protected");
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
  expect(
    Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"], {
      windowsHide: true,
    }).exitCode,
  ).toBe(0);
});

linuxTest(
  "surviving child cleanup retains the direct command's original exit code",
  async () => {
    const f = fixture();
    mkdirSync(posix.join(f.root, "locks"));
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
        writeFileSync(posix.join(f.transient, "temporary"), "generated");
        const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(500)"], {
          windowsHide: true,
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
    expect(
      Bun.spawnSync(["flock", "--nonblock", config.lockPath, "true"], {
        windowsHide: true,
      }).exitCode,
    ).toBe(0);
  },
  30000,
);

linuxTest(
  "a proved waiter on the same heavy lock cannot block terminal scratch cleanup",
  async () => {
    const f = fixture();
    mkdirSync(posix.join(f.root, "locks"));
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
        writeFileSync(posix.join(f.transient, "temporary"), "generated");
        queued = Bun.spawn(["flock", config.lockPath, "bash", "-c", "true", "queued-build", f.transient], {
          windowsHide: true,
          env: { ...process.env },
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        await Bun.sleep(100);
        const waiting = (await Bun.file("/proc/locks").text())
          .split("\n")
          .some(line => line.includes("->") && line.includes(` ${queued!.pid} `));
        expect(waiting).toBe(true);
        expect(readdirSync(f.transient)).toEqual(["temporary"]);
      },
      f.docker,
    );
    expect(await queued!.exited).toBe(0);
    expect(readdirSync(f.transient)).toEqual([]);
  },
  30000,
);

linuxTest("shared compiler daemon startup loses job metadata while compiler clients retain their scratch", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"), { recursive: true });
  f.config.cleanup = {
    transientRoot: f.transient,
    privilegeBinary: "/usr/bin/sudo",
    retiredOutputs: [],
  };
  const binary = posix.join(f.root, "sccache-fixture");
  const receipt = posix.join(f.root, "daemon-start.json");
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
        process.env.CARGO_TARGET_DIR = posix.join(f.root, "cache/cargo/job");
        process.env.SCCACHE_STARTUP_NOTIFY = posix.join(f.transient, "startup.sock");
        process.env.SCCACHE_IDLE_TIMEOUT = "1";
        await prewarmFactorySccache(f.config, binary);
        expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
          tmp: posix.join(f.root, "cache/sccache/control-plane-tmp"),
          cache: posix.join(f.root, "cache/sccache"),
          idle: "0",
        });
        expect(process.env.TMPDIR).toBe(f.transient);
        expect(process.env.CARGO_TARGET_DIR).toBe(posix.join(f.root, "cache/cargo/job"));
        expect(process.env.SCCACHE_IDLE_TIMEOUT).toBe("1");
        const compiler = Bun.spawn(
          [process.execPath, "-e", 'await Bun.write(process.env.TMPDIR + "/compiler-output", "job");'],
          {
            windowsHide: true,
            env: { ...process.env },
            stdout: "ignore",
            stderr: "pipe",
          },
        );
        expect(await compiler.exited).toBe(0);
        expect(readFileSync(posix.join(f.transient, "compiler-output"), "utf8")).toBe("job");
      },
      f.docker,
    );
    expect(readdirSync(f.transient)).toEqual([]);
    expect(readFileSync(receipt, "utf8")).toContain("control-plane-tmp");
    await expect(prewarmFactorySccache(f.config, binary)).rejects.toThrow("actual factory heavy lease");
  } finally {
    if (prior.target === undefined) delete process.env.CARGO_TARGET_DIR;
    else process.env.CARGO_TARGET_DIR = prior.target;
    if (prior.notify === undefined) delete process.env.SCCACHE_STARTUP_NOTIFY;
    else process.env.SCCACHE_STARTUP_NOTIFY = prior.notify;
    if (prior.idle === undefined) delete process.env.SCCACHE_IDLE_TIMEOUT;
    else process.env.SCCACHE_IDLE_TIMEOUT = prior.idle;
  }
});

linuxTest("shared compiler daemon left on a retired cache root is replaced", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"), { recursive: true });
  f.config.cleanup = {
    transientRoot: f.transient,
    privilegeBinary: "/usr/bin/sudo",
    retiredOutputs: [],
  };
  const binary = posix.join(f.root, "sccache-fixture");
  const calls = posix.join(f.root, "calls.log");
  const state = posix.join(f.root, "server-cache");
  writeFileSync(state, "/srv/aphrody-build/cache/sccache");
  writeFileSync(
    binary,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const arg = process.argv[2];
appendFileSync(${JSON.stringify(calls)}, arg + "\\n");
const state = ${JSON.stringify(state)};
if (arg === "--start-server") {
  if (existsSync(state)) process.exit(2);
  writeFileSync(state, process.env.SCCACHE_DIR);
} else if (arg === "--show-stats") {
  console.log('Cache location                  Local disk: ' + JSON.stringify(readFileSync(state, "utf8")));
} else if (arg === "--stop-server") rmSync(state);
`,
  );
  chmodSync(binary, 0o700);
  await withFactoryResource(f.config, () => prewarmFactorySccache(f.config, binary), f.docker);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
    "--start-server",
    "--show-stats",
    "--stop-server",
    "--start-server",
  ]);
  expect(readFileSync(state, "utf8")).toBe(posix.join(f.root, "cache/sccache"));
  writeFileSync(calls, "");
  await withFactoryResource(f.config, () => prewarmFactorySccache(f.config, binary), f.docker);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["--start-server", "--show-stats"]);
});

linuxTest("direct resource CLI passes the acquired job environment to its compiler command", async () => {
  const f = fixture();
  mkdirSync(posix.join(f.root, "locks"), { recursive: true });
  const bin = posix.join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(posix.join(bin, "docker"), "#!/bin/sh\nexit 0\n");
  chmodSync(posix.join(bin, "docker"), 0o700);
  const config = {
    ...f.config,
    cleanup: {
      transientRoot: f.transient,
      privilegeBinary: "/usr/bin/sudo",
      retiredOutputs: [],
    },
  };
  const configPath = posix.join(f.root, "factory.json");
  writeFileSync(configPath, JSON.stringify(config));
  const receipt = posix.join(f.root, "compiler-environment.json");
  const code = `await Bun.write(${JSON.stringify(receipt)}, JSON.stringify({tmp:process.env.TMPDIR, resource:process.env.APHRODY_FACTORY_RESOURCE})); await Bun.write(process.env.TMPDIR + "/compiler-output", "job");`;
  const child = Bun.spawn(
    [
      process.execPath,
      posix.join(import.meta.dir, "../../src/automation/build-factory-cleanup.ts"),
      configPath,
      process.execPath,
      "-e",
      code,
    ],
    {
      windowsHide: true,
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
