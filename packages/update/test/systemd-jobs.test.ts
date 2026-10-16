// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ctx } from "../src/context.ts";
import {
  activateLocalJobs,
  assertLocalJobsListener,
  assertLocalJobsReceipt,
} from "../src/systemd.ts";
import type { SpawnSyncResult } from "../src/process.ts";

const temporary: string[] = [];
const savedRoot = process.env.APHRODY_YOLO_ROOT;
const savedUnits = process.env.APHRODY_SYSTEMD_USER_DIR;
afterEach(() => {
  if (savedRoot === undefined) delete process.env.APHRODY_YOLO_ROOT;
  else process.env.APHRODY_YOLO_ROOT = savedRoot;
  if (savedUnits === undefined) delete process.env.APHRODY_SYSTEMD_USER_DIR;
  else process.env.APHRODY_SYSTEMD_USER_DIR = savedUnits;
  for (const root of temporary.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(apply: boolean) {
  const home = mkdtempSync(join(tmpdir(), "local-native-jobs-"));
  temporary.push(home);
  const units = join(home, "installed");
  const renderer = join(home, "yolo/packages/engine/core/src/units");
  const privateRoot = join(home, ".aphrody/private");
  for (const path of [
    units,
    renderer,
    join(privateRoot, "mcp-environment"),
    join(home, ".local/bin"),
  ])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(privateRoot, "mcp-environment/aphrody.json"),
    JSON.stringify({ APHRODY_AGENT_DOMAIN: "aphrody" }),
    { mode: 0o600 },
  );
  const bytes = "qualified-native-fixture";
  for (const name of ["aphrody", "aphrody-mcp"])
    writeFileSync(join(home, ".local/bin", name), bytes);
  const pin = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const names = [
    "aphrody-local-mcp.service",
    "aphrody-jobs-worker-wsl.service",
  ];
  writeFileSync(
    join(renderer, "index.ts"),
    `export const renderAll = () => ${JSON.stringify(names.map((file) => ({ file, text: "[Service]\nExecStart=qualified\n" })))};`,
  );
  process.env.APHRODY_YOLO_ROOT = join(home, "yolo");
  process.env.APHRODY_SYSTEMD_USER_DIR = units;
  const calls: string[][] = [];
  const active = new Set<string>();
  const enabled = new Set<string>();
  const run = (command: string, args: string[]): SpawnSyncResult => {
    calls.push([command, ...args]);
    let status = 0;
    let stdout = "";
    if (args.includes("--help")) stdout = "--host HOST --concurrency N";
    if (command === "systemctl") {
      const unit = args.at(-1)!;
      if (args.includes("is-active")) status = active.has(unit) ? 0 : 3;
      if (args.includes("is-enabled")) status = enabled.has(unit) ? 0 : 1;
      if (args.includes("restart")) active.add(unit);
      if (args.includes("enable")) enabled.add(unit);
      if (args.includes("stop")) active.delete(unit);
      if (args.includes("disable")) enabled.delete(unit);
      if (args.includes("show")) stdout = "100";
    }
    if (args.includes("call"))
      stdout = JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: 0,
                jobs: [],
                queue: { queued: 0, running: 0 },
              }),
            },
          ],
        },
      });
    return { status, stdout, stderr: "", signal: null };
  };
  const context = new Ctx(home, apply, false);
  context.run = run;
  const request = (async (url, init) =>
    new Response("", {
      status: String(url).endsWith("/healthz")
        ? 200
        : init?.headers
          ? 401
          : 500,
    })) as typeof fetch;
  return {
    home,
    units,
    privateRoot,
    pin,
    context,
    calls,
    active,
    enabled,
    run,
    request,
    names,
  };
}

test("only the selected unit's exact loopback PID can reuse the endpoint", () => {
  assertLocalJobsListener(
    'LISTEN 0 128 127.0.0.1:8791 0.0.0.0:* users:(("native",pid=100,fd=8))',
    "100",
    true,
  );
  for (const [rows, pid, active] of [
    ["LISTEN 127.0.0.1:8791 users:(pid=1000)", "100", true],
    ["LISTEN 0.0.0.0:8791 users:(pid=100)", "100", true],
    ["LISTEN 127.0.0.1:8791", "100", true],
    ["LISTEN 127.0.0.1:8791 users:(pid=100)", "100", false],
  ] as const)
    expect(() => assertLocalJobsListener(rows, pid, active)).toThrow("foreign");
});

test("jobs qualification refuses malformed, unavailable or ambiguous queue receipts", () => {
  const valid = { count: 0, jobs: [], queue: { queued: 0, running: 0 } };
  assertLocalJobsReceipt(
    JSON.stringify({
      result: { content: [{ type: "text", text: JSON.stringify(valid) }] },
    }),
  );
  assertLocalJobsReceipt(
    JSON.stringify({ result: { structuredContent: valid } }),
  );
  for (const receipt of [
    {},
    { ...valid, count: 1 },
    { ...valid, queue: { error: "store unavailable" } },
    { ...valid, queue: { queued: -1, running: 0 } },
    { ...valid, queue: { queued: 0, running: 0.5 } },
    { ...valid, error: "JOB_STORE_ERROR" },
  ]) {
    expect(() =>
      assertLocalJobsReceipt(
        JSON.stringify({
          result: {
            content: [{ type: "text", text: JSON.stringify(receipt) }],
          },
        }),
      ),
    ).toThrow();
  }
  expect(() =>
    assertLocalJobsReceipt(
      JSON.stringify({ result: { isError: true, structuredContent: valid } }),
    ),
  ).toThrow();
  expect(() =>
    assertLocalJobsReceipt(
      JSON.stringify({
        result: {
          content: [
            { type: "text", text: JSON.stringify(valid) },
            { type: "text", text: JSON.stringify(valid) },
          ],
        },
      }),
    ),
  ).toThrow();
});

test("dry run writes no bearer, config or units and rejects an unqualified binary", async () => {
  const f = fixture(false);
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await activateLocalJobs(f.context, f.pin, {
      home: f.home,
      platform: "linux" as const,
      availableMemoryBytes: 6 * 1024 ** 3,
      run: f.run,
    });
    expect(existsSync(join(f.privateRoot, "jobs"))).toBe(false);
    expect(existsSync(join(f.units, f.names[0]!))).toBe(false);
    writeFileSync(join(f.home, ".local/bin/aphrody"), "foreign-native");
    await expect(
      activateLocalJobs(f.context, f.pin, {
        home: f.home,
        platform: "linux",
        run: f.run,
      }),
    ).rejects.toThrow("qualified pin");
  } finally {
    log.mockRestore();
  }
});

test("authentication failure restores selected prior units and leaves the PC service untouched", async () => {
  const f = fixture(true);
  writeFileSync(join(f.units, f.names[0]!), "previous native MCP\n");
  writeFileSync(
    join(f.units, "aphrody-pc-agent.service"),
    "protected PC owner\n",
  );
  f.active.add(f.names[0]!);
  f.enabled.add(f.names[0]!);
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const failure = (async () =>
      new Response("", { status: 200 })) as typeof fetch;
    await expect(
      activateLocalJobs(f.context, f.pin, {
        home: f.home,
        platform: "linux" as const,
        availableMemoryBytes: 6 * 1024 ** 3,
        run: f.run,
        fetch: failure,
      }),
    ).rejects.toThrow("prior selected user units restored");
    expect(readFileSync(join(f.units, f.names[0]!), "utf8")).toBe(
      "previous native MCP\n",
    );
    expect(existsSync(join(f.units, f.names[1]!))).toBe(false);
    expect(f.active.has(f.names[0]!)).toBe(true);
    expect(f.active.has(f.names[1]!)).toBe(false);
    expect(f.enabled.has(f.names[0]!)).toBe(true);
    expect(
      readFileSync(join(f.units, "aphrody-pc-agent.service"), "utf8"),
    ).toBe("protected PC owner\n");
    expect(
      f.calls.some((call) => call.includes("aphrody-pc-agent.service")),
    ).toBe(false);
  } finally {
    log.mockRestore();
  }
});

test("successful activation retains its purpose-bound bearer and keeps client config private", async () => {
  const f = fixture(true);
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const options = {
      home: f.home,
      platform: "linux" as const,
      availableMemoryBytes: 6 * 1024 ** 3,
      run: f.run,
      fetch: f.request,
    };
    await activateLocalJobs(f.context, f.pin, options);
    const bearer = join(f.privateRoot, "jobs/wsl-mcp.env");
    const before = readFileSync(bearer, "utf8");
    await activateLocalJobs(f.context, f.pin, options);
    expect(readFileSync(bearer, "utf8")).toBe(before);
    for (const path of [bearer, join(f.privateRoot, "jobs/wsl.toml")])
      if (process.platform !== "win32")
        expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      readFileSync(join(f.privateRoot, "jobs/wsl.toml"), "utf8"),
    ).toContain("127.0.0.1:8791/mcp");
    expect(
      readFileSync(join(f.privateRoot, "jobs/wsl.toml"), "utf8"),
    ).toContain("[mcp_servers.aphrody.http_headers]");
    expect(f.names.every((unit) => f.active.has(unit))).toBe(true);
    expect(
      log.mock.calls.some((call) =>
        String(call[0]).includes("workerReady remains false"),
      ),
    ).toBe(true);
  } finally {
    log.mockRestore();
  }
});
