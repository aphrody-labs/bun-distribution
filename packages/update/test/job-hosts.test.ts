// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ctx } from "../src/context.ts";
import { runSystemd } from "../src/systemd.ts";
import { runUpdate } from "../src/cli.ts";
import { prepareNativeJobHostClients, qualifyNativeJobHostClients, type NativeJobTransport } from "../src/job-hosts.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(apply = true) {
  const home = mkdtempSync(join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "native-job-hosts-"));
  temporary.push(home);
  const pin = "a".repeat(64);
  const tokens = { vps: "b".repeat(64), dbfr: "c".repeat(64) };
  const context = new Ctx(home, apply, false);
  const calls: string[][] = [];
  const runtime = { active: true, pids: "100 200" };
  const run = (_command: string, args: string[]) => {
    calls.push(args);
    const id = args[args.indexOf("--host") + 1] as "vps" | "dbfr";
    const token = args.at(-1)?.includes("sed -n");
    return {
      status: token || runtime.active ? 0 : 1,
      signal: null,
      stdout: `${token ? tokens[id] : runtime.pids}\n`,
      stderr: "",
    };
  };
  return {
    home,
    context,
    pin,
    tokens,
    calls,
    run,
    runtime,
    manifest: join(home, ".aphrody/private/jobs/hosts.json"),
  };
}
const wrap = (value: unknown) => ({
  result: { content: [{ type: "text", text: JSON.stringify(value) }] },
});

test("producer prepares only declared private routes and marks them unready before qualification", () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps", "dbfr"], f.pin, f);
  expect(hosts.map(host => [host.id, host.slots, host.workerReady])).toEqual([
    ["vps", 4, false],
    ["dbfr", 2, false],
  ]);
  for (const host of hosts) {
    if (process.platform !== "win32") expect(statSync(host.config).mode & 0o777).toBe(0o600);
    const text = readFileSync(host.config, "utf8");
    const parsed = Bun.TOML.parse(text) as {
      mcp_servers: {
        aphrody: {
          url: string;
          http_headers: { Authorization: string; Host: string };
        };
      };
    };
    expect(parsed.mcp_servers.aphrody.url).toBe(`http://10.200.77.${host.id === "vps" ? 1 : 3}:8793/mcp`);
    expect(parsed.mcp_servers.aphrody.http_headers.Authorization).toBe(`Bearer ${f.tokens[host.id as "vps" | "dbfr"]}`);
    expect(parsed.mcp_servers.aphrody.http_headers.Host).toBe("127.0.0.1:8793");
    expect(text).toContain("[mcp_servers.aphrody.http_headers]");
    expect(text).toContain(f.tokens[host.id as "vps" | "dbfr"]);
  }
  expect(Object.keys(JSON.parse(readFileSync(f.manifest, "utf8"))[0]).toSorted()).toEqual([
    "config",
    "id",
    "server",
    "slots",
    "workerReady",
  ]);
  expect(f.calls.every(args => args.includes("--cmd") && args.at(-1)!.includes("sha256sum -c"))).toBe(true);
});

test("planning captures no credential and failed native pin or units never advertises readiness", () => {
  const f = fixture(false);
  expect(prepareNativeJobHostClients(f.context, ["vps"], f.pin, f)[0]?.workerReady).toBe(false);
  expect(f.calls).toHaveLength(0);
  expect(existsSync(f.manifest)).toBe(false);
  const apply = new Ctx(f.home, true, false);
  expect(() =>
    prepareNativeJobHostClients(apply, ["vps"], f.pin, {
      home: f.home,
      run: () => ({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "unavailable",
      }),
    }),
  ).toThrow("unavailable");
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});

test("a lost submit receipt retries the identical native key and qualifies only real lease and finish", async () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps"], f.pin, f);
  const requests: unknown[] = [];
  let lost = true;
  let key: unknown;
  const transport: NativeJobTransport = async request => {
    if (request.tool === "aphrody_job_submit") {
      requests.push(request.arguments);
      key = request.arguments.idempotency_key;
      if (lost) {
        lost = false;
        throw new Error("lost acknowledgement");
      }
      return wrap({ id: "durable-native-job" });
    }
    if (request.arguments.id)
      return wrap({
        job: {
          state: "succeeded",
          attempts: 1,
          idempotency_key: key,
          host_affinity: { mode: "hosts", hosts: ["vps"] },
        },
        logs: [{ message: "running native Web pipeline" }, { message: "succeeded" }],
      });
    return wrap({ count: 0, jobs: [], queue: { queued: 0, running: 0 } });
  };
  await expect(qualifyNativeJobHostClients(hosts, transport, f)).rejects.toThrow("lost acknowledgement");
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
  expect((await qualifyNativeJobHostClients(hosts, transport, f))[0]?.workerReady).toBe(true);
  expect(requests[0]).toEqual(requests[1]);
  const identityCommand = f.calls.map(args => args.at(-1)).find(command => command?.includes("/proc/"));
  expect(identityCommand).toContain("sudo -n sha256sum -c --quiet");
  expect(identityCommand).toContain("printf '%s %s\\n'");
  if (process.platform !== "win32") expect(statSync(f.manifest).mode & 0o777).toBe(0o600);
  f.runtime.active = false;
  await expect(qualifyNativeJobHostClients(hosts, transport, f)).rejects.toThrow("runtime");
  expect(requests).toHaveLength(2);
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
  f.runtime.active = true;
  await qualifyNativeJobHostClients(hosts, transport, f);
  expect(requests[2]).not.toEqual(requests[1]);
});

test("pending receipts expire and runtime changes invalidate the completion proof", async () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps"], f.pin, f);
  let time = 1000000;
  const keys: unknown[] = [];
  const lost: NativeJobTransport = async request => {
    if (request.tool === "aphrody_job_submit") {
      keys.push(request.arguments.idempotency_key);
      throw new Error("lost");
    }
    return wrap({ count: 0, jobs: [], queue: { queued: 0, running: 0 } });
  };
  await expect(qualifyNativeJobHostClients(hosts, lost, { ...f, now: () => time })).rejects.toThrow("lost");
  time += 300001;
  await expect(qualifyNativeJobHostClients(hosts, lost, { ...f, now: () => time })).rejects.toThrow("lost");
  expect(keys[0]).not.toBe(keys[1]);
  let key: unknown;
  const changed: NativeJobTransport = async request => {
    if (request.tool === "aphrody_job_submit") {
      key = request.arguments.idempotency_key;
      return wrap({ id: "job" });
    }
    if (request.arguments.id) {
      f.runtime.pids = "100 999";
      return wrap({
        job: {
          state: "succeeded",
          attempts: 1,
          idempotency_key: key,
          host_affinity: { mode: "hosts", hosts: ["vps"] },
        },
        logs: [{ message: "running native Web pipeline" }, { message: "succeeded" }],
      });
    }
    return wrap({ count: 0, jobs: [], queue: { queued: 0, running: 0 } });
  };
  await expect(qualifyNativeJobHostClients(hosts, changed, { ...f, now: () => time })).rejects.toThrow("changed");
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});

test("fresh probes revoke previous readiness when queue is unavailable or placement proof is foreign", async () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps"], f.pin, f).map(host =>
    Object.assign(host, { workerReady: true }),
  );
  writeFileSync(f.manifest, JSON.stringify(hosts), { mode: 0o600 });
  const unavailable: NativeJobTransport = async () =>
    wrap({
      count: 0,
      jobs: [],
      queue: { error: `store unavailable for ${f.home}` },
    });
  await expect(qualifyNativeJobHostClients(hosts, unavailable, f)).rejects.toThrow("queue is unavailable");
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
  const wrongHost: NativeJobTransport = async request =>
    request.tool === "aphrody_job_submit"
      ? wrap({ id: "job" })
      : request.arguments.id
        ? wrap({
            job: {
              state: "succeeded",
              attempts: 1,
              host_affinity: {
                mode: "hosts",
                hosts: [Object.keys(f.tokens)[1]],
              },
            },
            logs: [{ message: "running native Web pipeline" }, { message: "succeeded" }],
          })
        : wrap({ count: 0, jobs: [], queue: { queued: 0, running: 0 } });
  await expect(qualifyNativeJobHostClients(hosts, wrongHost, f)).rejects.toThrow("placement");
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});

test("producer preserves foreign symlinks and refuses unknown or duplicate placements", () => {
  const f = fixture();
  expect(() => prepareNativeJobHostClients(f.context, ["vps", "vps"], f.pin, f)).toThrow("unique");
  // Windows has no POSIX mode bits; the group/other-readable rejection is POSIX-only.
  if (process.platform === "win32") return;
  mkdirSync(join(f.home, ".aphrody/private/jobs"), {
    recursive: true,
    mode: 0o755,
  });
  expect(() => prepareNativeJobHostClients(f.context, ["vps"], f.pin, f)).toThrow("private directory");
});

test("WSL readiness refuses a stale running executable even when all installed aliases match", async () => {
  const f = fixture();
  const directory = join(f.home, ".aphrody/private/jobs");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, "wsl-mcp.env"), `APHRODY_MCP_HTTP_TOKEN=${"b".repeat(64)}\n`, {
    mode: 0o600,
  });
  writeFileSync(join(directory, "wsl.toml"), "old-client", { mode: 0o600 });
  const hosts = prepareNativeJobHostClients(f.context, ["wsl"], f.pin, f);
  let called = false;
  const run = (command: string, args: string[]) => ({
    status: 0,
    signal: null,
    stderr: "",
    stdout:
      command === "sha256sum"
        ? args.map(path => `${path.startsWith("/proc/") ? "d".repeat(64) : f.pin}  ${path}`).join("\n") + "\n"
        : args.includes("show")
          ? "100\n"
          : "",
  });
  await expect(
    qualifyNativeJobHostClients(
      hosts,
      async () => {
        called = true;
        return wrap({});
      },
      { ...f, run },
    ),
  ).rejects.toThrow("running executable");
  expect(called).toBe(false);
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});

test("CLI qualification requires mutation scope and the native transport before touching private clients", async () => {
  const f = fixture(false);
  const args = ["jobs-clients", "--host", "vps", "--binary-sha256", f.pin, "--qualify"];
  expect(() => runSystemd(f.context, args)).toThrow("--apply");
  await expect(runUpdate(["systemd", ...args, "--apply", "--root", f.home])).rejects.toThrow("native transport");
  expect(existsSync(f.manifest)).toBe(false);
  expect(f.calls).toHaveLength(0);
});

test("qualification rejects a foreign Host authority and revokes old readiness before native RPC", async () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps"], f.pin, f);
  hosts[0]!.workerReady = true;
  writeFileSync(f.manifest, JSON.stringify(hosts), { mode: 0o600 });
  const path = hosts[0]!.config;
  writeFileSync(path, readFileSync(path, "utf8").replace('Host = "127.0.0.1:8793"', 'Host = "10.200.77.1:8793"'), {
    mode: 0o600,
  });
  let called = false;
  await expect(
    qualifyNativeJobHostClients(
      hosts,
      async () => {
        called = true;
        return wrap({});
      },
      f,
    ),
  ).rejects.toThrow("loopback authority");
  expect(called).toBe(false);
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});

test("a global qualification deadline stops stalled RPC progress without advertising readiness", async () => {
  const f = fixture();
  const hosts = prepareNativeJobHostClients(f.context, ["vps"], f.pin, f);
  let time = 1000000;
  let calls = 0;
  await expect(
    qualifyNativeJobHostClients(
      hosts,
      async (_request, options) => {
        calls++;
        expect(options.timeoutMs).toBeLessThanOrEqual(15000);
        time += 15 * 60 * 1000 + 1;
        return wrap({ count: 0, jobs: [], queue: { queued: 0, running: 0 } });
      },
      { ...f, now: () => time },
    ),
  ).rejects.toThrow("global deadline");
  expect(calls).toBe(1);
  expect(JSON.parse(readFileSync(f.manifest, "utf8"))[0].workerReady).toBe(false);
});
