// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  composeArgs,
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
