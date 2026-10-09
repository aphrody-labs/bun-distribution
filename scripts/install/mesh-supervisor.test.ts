// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  composeArgs,
  adapterDue,
  windowsCapabilities,
  environment,
  probes,
  validateConfig,
  type MeshConfig,
} from "./mesh-supervisor.ts";

const home = join(tmpdir(), "mesh-protected-home");
const config = (): MeshConfig => ({
  version: 1,
  member: "omar",
  root: tmpdir(),
  home,
  compose: [{ file: join(tmpdir(), "compose.yaml"), services: ["pc"], profiles: ["pc"] }],
  adapters: [],
  health: [],
});

test.skipIf(process.platform !== "win32")(
  "exports the installed complete Windows surface without executing its operations",
  async () => {
    const result = await windowsCapabilities();
    expect(result.supported).toBe(true);
    for (const key of [
      "Job",
      "registry",
      "services",
      "processes",
      "clipboard",
      "eventLog",
      "storage",
      "memory",
      "win32",
      "toolchain",
      "wsl",
    ])
      expect(result.exports).toContain(key);
  },
);

test("periodic maintenance never duplicates a running child or loops after success", () => {
  const adapter = { id: "update", argv: ["aphrody", "self", "update"], intervalSeconds: 3600 };
  expect(adapterDue(adapter, false, 4_000_000)).toBe(false);
  expect(adapterDue(adapter, true, 5000)).toBe(false);
  expect(adapterDue(adapter, true, 3_600_000)).toBe(true);
  expect(() =>
    validateConfig({ ...config(), adapters: [{ ...adapter, intervalSeconds: 0 }] }),
  ).toThrow();
});

test("reject credentials in command arguments, URLs and env outside the protected host store", () => {
  expect(() =>
    validateConfig({
      ...config(),
      adapters: [{ id: "remote", argv: ["aphrody", "--token=secret"] }],
    }),
  ).toThrow();
  expect(() =>
    validateConfig({
      ...config(),
      health: [{ id: "screen", url: "http://localhost/#token=secret" }],
    }),
  ).toThrow();
  expect(() =>
    validateConfig({
      ...config(),
      compose: [{ ...config().compose[0], envFile: join(home, "private-other", "token.env") }],
    }),
  ).toThrow();
  expect(
    validateConfig({
      ...config(),
      adapters: [
        { id: "mcp", argv: ["aphrody-mcp"], envFile: join(home, "private", "mcp-http.env") },
      ],
    }).member,
  ).toBe("omar");
});

test("startup selects declared existing services and waits for their real health, without building", () => {
  const argv = composeArgs(config().compose[0]!, "up");
  expect(argv.slice(-7)).toEqual([
    "up",
    "-d",
    "--no-build",
    "--wait",
    "--wait-timeout",
    "120",
    "pc",
  ]);
  expect(argv).not.toContain("--remove-orphans");
  expect(argv).not.toContain("--build");
  expect(() =>
    validateConfig({
      ...config(),
      compose: [{ file: join(tmpdir(), "compose.yaml"), services: ["--remove-orphans"] }],
    }),
  ).toThrow();
});

test("protected env values preserve equals signs and are never interpolated", () => {
  expect(environment('# comment\nTOKEN="a=b=$HOME"\nOTHER=ok')).toEqual({
    TOKEN: "a=b=$HOME",
    OTHER: "ok",
  });
  expect(() => environment("export TOKEN=foo")).toThrow();
});

test("health fails on errors, redirects and authentication failure instead of accepting a listener", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      return new Response(null, { status: new URL(req.url).pathname === "/healthy" ? 200 : 401 });
    },
  });
  try {
    const c = config();
    c.health = [
      { id: "good", url: `${server.url}healthy` },
      { id: "auth", url: `${server.url}private` },
    ];
    expect(await probes(c)).toEqual([
      { id: "good", healthy: true, status: 200 },
      { id: "auth", healthy: false, status: 401 },
    ]);
  } finally {
    await server.stop(true);
  }
});

test.skipIf(process.platform !== "win32")(
  "fork Windows Job closes its owned long-running child",
  async () => {
    const { Job } = await import("bun:windows");
    const job = new Job({ killOnClose: true });
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(120000)"], {
      windowsHide: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      job.assign(child);
      expect(job.info().pids).toContain(child.pid);
      job.close();
      expect(
        await Promise.race([child.exited.then(() => true), Bun.sleep(1000).then(() => false)]),
      ).toBe(true);
      expect(job.closed).toBe(true);
    } finally {
      if (!job.closed) job.close();
      child.kill();
    }
  },
);
