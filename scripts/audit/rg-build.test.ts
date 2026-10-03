// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const buildRoot = root;

async function build(mode: "complete" | "partial" | "failure" | "stale") {
  await mkdir(join(root, ".cache"), { recursive: true });
  const fixture = await mkdtemp(join(root, ".cache/rg-build-"));
  const app = join(fixture, "apps/rg/website");
  const server = join(app, ".next/standalone", relative(buildRoot, app), "server.js");
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

test("RG release provenance captures the exact service catalogue bytes", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const fixture = await mkdtemp(join(tmpdir(), "rg-catalog-release-"));
  try {
    const artifact = join(fixture, "artifact");
    const infra = join(fixture, "infra");
    await mkdir(join(artifact, ".cache/iecode-packages"), { recursive: true });
    await mkdir(join(artifact, "systemd"));
    await mkdir(join(infra, "systemd"), { recursive: true });
    await writeFile(join(artifact, ".cache/iecode-packages/manifest.json"), "{}");
    await writeFile(
      join(infra, "systemd/rg-fixture.service"),
      "WorkingDirectory=/srv/rg/current\nEnvironmentFile=/etc/rg-fixture.env\n",
    );
    const catalog = join(fixture, "catalog.json");
    const bytes =
      JSON.stringify({ services: [{ id: "rg-fixture", unit: "rg-fixture.service" }] }) + "\n";
    await writeFile(catalog, bytes);
    const script = await readFile(join(root, "scripts/rg/assemble-vps-release.sh"), "utf8");
    const marker =
      'python3 - "$stage" "$catalog" "$commit" "$infra_root" "$infra_commit" <<\'PY\'\n';
    const python = script.split(marker)[1]?.split("\nPY\n")[0];
    expect(python).toBeDefined();
    const child = Bun.spawn(
      ["python3", "-I", "-c", python!, artifact, catalog, "a".repeat(40), infra, "b".repeat(40)],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(error).toBe("");
    expect(code).toBe(0);
    const manifest = await Bun.file(join(artifact, "release.json")).json();
    const { createHash } = await import("node:crypto");
    expect(manifest.catalog).toEqual({
      path: "service-catalog.json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await readFile(join(artifact, "service-catalog.json"), "utf8")).toBe(bytes);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
