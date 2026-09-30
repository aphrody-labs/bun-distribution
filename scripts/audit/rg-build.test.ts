// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

async function build(mode: "complete" | "partial" | "failure" | "stale") {
  await mkdir(join(root, ".cache"), { recursive: true });
  const fixture = await mkdtemp(join(root, ".cache/rg-build-"));
  const app = join(fixture, "apps/rg/website");
  const server = join(app, ".next/standalone", relative(root, app), "server.js");
  try {
    await mkdir(dirname(server), { recursive: true });
    await Bun.write(join(app, ".next/BUILD_ID"), "old-build");
    await Bun.write(server, "old-server");
    await utimes(join(app, ".next/BUILD_ID"), 1, 1);
    await utimes(server, 1, 1);
    const runner = join(fixture, "node-fixture");
    await Bun.write(
      runner,
      `#!/usr/bin/env bash
if [ "$BUILD_MODE" != stale ]; then
  printf new-build > .next/BUILD_ID
fi
if [ "$BUILD_MODE" = complete ] || [ "$BUILD_MODE" = failure ]; then
  printf new-server > "$BUILD_SERVER"
fi
if [ "$BUILD_MODE" = failure ]; then exit 42; fi
`,
    );
    await chmod(runner, 0o755);
    const child = Bun.spawn(["bash", join(root, "scripts/rg/next-build.sh")], {
      cwd: app,
      env: {
        ...Bun.env,
        NODE_BIN: runner,
        BUILD_TMP: join(fixture, "tmp"),
        BUILD_MODE: mode,
        BUILD_SERVER: server,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { exitCode, stderr };
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

test("RG build accepts fresh standalone output at the migrated application path", async () => {
  expect((await build("complete")).exitCode).toBe(0);
});

test("RG build preserves the Next failure even when partial artifacts exist", async () => {
  expect((await build("failure")).exitCode).toBe(42);
});

test("RG build rejects a stale build ID", async () => {
  const result = await build("stale");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("BUILD_ID");
});

test("RG build rejects a stale standalone server after a partial build", async () => {
  const result = await build("partial");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("standalone");
});
