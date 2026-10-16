// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve(
  import.meta.dir,
  "../../../../tools/aphrody/config/container/entrypoint.sh",
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(executables: Record<string, string>, checkout = false) {
  const root = await mkdtemp(join(tmpdir(), "aphrody-entrypoint-"));
  temporary.push(root);
  const bin = join(root, "bin");
  const app = join(root, "app");
  await Promise.all([mkdir(bin), mkdir(app)]);
  await Promise.all(
    Object.entries(executables).map(async ([name, body]) => {
      const path = join(bin, name);
      await Bun.write(path, `#!/bin/sh\nset -eu\n${body}\n`);
      await chmod(path, 0o755);
    }),
  );
  if (checkout) await Bun.write(join(app, "bun.lock"), "fixture");
  return async (args: string[], extra: Record<string, string> = {}) => {
    const result = Bun.spawn(["/bin/sh", entrypoint, ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        APHRODY_ROOT: app,
        APHRODY_HOME: join(root, "home"),
        YOLO_API_TOKEN: "",
        YOLO_API_TOKEN_FILE: "",
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
}

const printArguments = 'printf "%s\\n" "$0" "$@"';

test("MCP dispatches directly to the canonical multicall executable", async () => {
  const run = await fixture({
    "aphrody-mcp": printArguments,
    aphrody: "exit 99",
  });
  const result = await run(["mcp", "--stdio"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.split("\n").slice(1)).toEqual(["--stdio", ""]);
  expect(result.stderr).toBe("");
});

test("MCP uses the supported canonical subcommand when the link is absent", async () => {
  const run = await fixture({ aphrody: printArguments });
  const result = await run(["mcp", "--stdio"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.split("\n").slice(1)).toEqual([
    "mcp-server",
    "--stdio",
    "",
  ]);
});

test("API rejects an absent token before launching the server", async () => {
  const run = await fixture({ yolo: 'printf "server launched"' });
  const result = await run(["api"]);
  expect(result.exitCode).toBe(64);
  expect(result.stderr).toContain("YOLO_API_TOKEN is required");
  expect(result.stdout).toBe("");
});

test("API receives the explicit container host, port and extra arguments", async () => {
  const run = await fixture({ yolo: printArguments });
  const result = await run(["api", "--json"], {
    YOLO_API_TOKEN: "fixture-token",
    PORT: "9876",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.split("\n").slice(1)).toEqual([
    "api",
    "--host",
    "0.0.0.0",
    "--port",
    "9876",
    "--json",
    "",
  ]);
});

test("API reads the mounted secret and replaces a stale environment token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-api-secret-"));
  temporary.push(dir);
  const path = join(dir, "api.token");
  await Bun.write(path, "file-fixture-token\n", { mode: 0o400 });
  const run = await fixture({
    yolo: '[ "$YOLO_API_TOKEN" = "file-fixture-token" ]',
  });
  const result = await run(["api"], {
    YOLO_API_TOKEN: "stale-fixture-token",
    YOLO_API_TOKEN_FILE: path,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("API rejects a missing mounted secret even when an environment token exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-api-secret-"));
  temporary.push(dir);
  const run = await fixture({ yolo: 'printf "server launched"' });
  const result = await run(["api"], {
    YOLO_API_TOKEN: "stale-fixture-token",
    YOLO_API_TOKEN_FILE: join(dir, "missing"),
  });
  expect(result.exitCode).toBe(64);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("secret file is not readable");
});

test("API rejects an empty mounted secret before launching the server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-api-secret-"));
  temporary.push(dir);
  const path = join(dir, "api.token");
  await Bun.write(path, "", { mode: 0o400 });
  const run = await fixture({ yolo: 'printf "server launched"' });
  const result = await run(["api"], { YOLO_API_TOKEN_FILE: path });
  expect(result.exitCode).toBe(64);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("YOLO_API_TOKEN is required");
});

test("checkout bootstrap stays on stderr and reuses installed dependencies", async () => {
  const run = await fixture(
    {
      bun: 'printf "bootstrap %s\\n" "$*"; mkdir "$APHRODY_ROOT/node_modules"',
      "aphrody-mcp": 'printf "mcp protocol"',
    },
    true,
  );
  const first = await run(["mcp"]);
  expect(first.exitCode).toBe(0);
  expect(first.stdout).toBe("mcp protocol");
  expect(first.stderr).toContain("bootstrap install --frozen-lockfile");
  const second = await run(["mcp"]);
  expect(second.exitCode).toBe(0);
  expect(second.stderr).toBe("");
});

test("runtime refuses a source checkout without the Bun development toolchain", async () => {
  const run = await fixture({ "aphrody-mcp": 'printf "mcp protocol"' }, true);
  const result = await run(["mcp"]);
  expect(result.exitCode).toBe(127);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("dev or release-builder");
});

test("entrypoint forwards arbitrary executable arguments and exit status", async () => {
  const run = await fixture({ probe: 'printf "%s\\n" "$@"; exit 17' });
  const result = await run(["probe", "two words", "--flag"]);
  expect(result.exitCode).toBe(17);
  expect(result.stdout).toBe("two words\n--flag\n");
});
