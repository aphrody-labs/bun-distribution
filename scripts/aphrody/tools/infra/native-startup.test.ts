// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  activate,
  bootEntry,
  bootTasks,
  type Config,
  health,
  plan,
  probeHost,
  type Resolved,
  resolveServices,
  schemaErrors,
  serviceArgv,
} from "./native-startup.ts";
import {
  fileTimeIso,
  normalizeAddress,
  parseIPv4Table,
  parseIPv6Table,
  processStartedAt,
  tcpListeners,
} from "./win32-net.ts";

const repo = resolve(import.meta.dir, "../../../../docs/aphrody");
const schema = JSON.parse(readFileSync(join(repo, "infra/config/host/windows/aphrody-startup.schema.json"), "utf8"));
const windows = process.platform === "win32";
const scratch = mkdtempSync(join(tmpdir(), "native-startup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const base = (): Config => ({
  version: 1,
  home: "C:\\Users\\owner\\.aphrody",
  root: "C:\\aphrody",
  principal: {
    userId: "HOST\\owner",
    logonType: "Interactive",
    runLevel: "Limited",
  },
  trigger: { kind: "logon" },
  services: [
    {
      id: "site",
      kind: "site",
      executable: "C:\\bin\\aphrody-site.exe",
      enabled: true,
      bind: "127.0.0.1",
      port: 36515,
      desiredPort: 80,
      home: "C:\\ProgramData\\Aphrody\\site",
      principal: {
        userId: "SYSTEM",
        logonType: "ServiceAccount",
        runLevel: "Limited",
      },
      trigger: { kind: "boot" },
      arguments: [],
      healthPath: "/health",
    },
    {
      id: "mcp",
      kind: "mcp",
      executable: "C:\\bin\\aphrody-mcp.exe",
      enabled: true,
      bind: "127.0.0.1",
      port: 8793,
      existingTask: { path: "\\Aphrody\\", name: "Aphrody MCP HTTP" },
      arguments: [],
      healthPath: "/healthz",
    },
  ],
});
const anyDir = () => true;

describe("configuration", () => {
  test("the schema accepts the documented shape and rejects drift", () => {
    expect(schemaErrors(base(), schema)).toEqual([]);
    const bad = { ...base(), extra: 1, version: 2 } as unknown;
    const errors = schemaErrors(bad, schema).join("\n");
    expect(errors).toContain("propriété extra non déclarée");
    expect(errors).toContain("$.version");
    const service = {
      ...base().services[0],
      id: "Site!",
      port: 70_000,
      principal: { userId: "x" },
    };
    const nested = schemaErrors({ ...base(), services: [service] }, schema).join("\n");
    expect(nested).toContain("$.services[0].id");
    expect(nested).toContain("$.services[0].port");
    expect(nested).toContain("$.services[0].principal : logonType requis");
  });

  test.skipIf(!windows)("semantic rules of the declaration", () => {
    const resolved = resolveServices(base(), anyDir);
    expect(resolved[0]!.principal.userId).toBe("SYSTEM");
    expect(resolved[0]!.home).toBe("C:\\ProgramData\\Aphrody\\site");
    expect(resolved[1]!.home).toBe("C:\\Users\\owner\\.aphrody");
    const broken = (edit: (c: Config) => void) => {
      const c = base();
      edit(c);
      return () => resolveServices(c, anyDir);
    };
    expect(broken(c => (c.services[1]!.bind = "0.0.0.0"))).toThrow("loopback");
    expect(broken(c => (c.services[0]!.arguments = ["--bind=0.0.0.0:80"]))).toThrow("bind/port");
    expect(broken(c => (c.services[1]!.port = 36515))).toThrow("deux fois");
    expect(broken(c => delete c.services[0]!.home)).toThrow("propre home");
    expect(broken(c => (c.services[0]!.executable = "bin\\site.exe"))).toThrow("absolu");
    expect(broken(c => (c.services[1]!.trigger = { kind: "boot" }))).toThrow("Interactive");
    expect(broken(c => (c.root = "\\aphrody"))).toThrow("répertoires absolus");
  });
});

describe("plan and boot entry", () => {
  const entries = [
    {
      host: "local",
      kind: "scheduledTask",
      name: "site",
      path: "\\Aphrody\\Native\\",
      triggers: ["atStartup"],
      arguments: "--no-env-file scripts/tools/infra/native-startup.ts run site --config C:\\c.json",
      principal: "system",
    },
  ];

  test.skipIf(!windows)("readiness, occupied ports and the boot entry", () => {
    const resolved = resolveServices(base(), anyDir);
    const rows = plan(resolved, entries, {
      exists: () => true,
      listeners: () => [{ address: "0.0.0.0", port: 80, pid: 7156 }],
      taskExists: path => path === "\\Aphrody\\Aphrody MCP HTTP",
    });
    expect(rows[0]).toMatchObject({
      id: "site",
      reason: "ready",
      enabled: true,
      desiredPortBlocked: true,
    });
    expect(rows[0]!.boot).toEqual({ entry: "local:site", drift: [] });
    expect(rows[1]!.boot).toBeNull();
    const busy = plan(resolved, entries, {
      exists: () => true,
      listeners: () => [{ address: "127.0.0.1", port: 36515, pid: 42 }],
      taskExists: () => true,
    });
    expect(busy[0]).toMatchObject({
      reason: "occupied-port",
      enabled: false,
      listenerPids: [42],
    });
    expect(() =>
      plan(resolved, entries, {
        exists: () => true,
        listeners: () => [],
        taskExists: () => false,
      }),
    ).toThrow("absente");
  });

  test.skipIf(!windows)("drift between the declaration and the boot entry", () => {
    const [site] = resolveServices(base(), anyDir);
    const drift = bootEntry(site!, [{ ...entries[0]!, principal: "user", triggers: ["atLogon"] }]).drift;
    expect(drift.join(" | ")).toContain("principal user");
    expect(drift.join(" | ")).toContain("atStartup");
    expect(bootEntry(site!, []).entry).toBeNull();
  });

  test("the repository boot catalog registers the site runner as declared", () => {
    const site = bootTasks().find(e => e.name === "site" && e.path === "\\Aphrody\\Native\\");
    expect(site).toBeDefined();
    const resolved = {
      service: base().services[0]!,
      principal: base().services[0]!.principal!,
      trigger: { kind: "boot" },
      home: "C:\\x",
    } as Resolved;
    expect(bootEntry(resolved, bootTasks()).drift).toEqual([]);
    expect(site!.arguments).toStartWith("--no-env-file ");
  });

  test("owner command line and probe address", () => {
    const [site, mcp] = base().services;
    expect(serviceArgv(site!, "C:\\aphrody", "C:\\h")).toEqual([
      "C:\\bin\\aphrody-site.exe",
      "--root",
      "C:\\aphrody",
      "--bind",
      "127.0.0.1:36515",
    ]);
    expect(serviceArgv({ ...mcp!, bind: "::1", arguments: ["--home={{home}}"] }, "R", "H")).toEqual([
      "C:\\bin\\aphrody-mcp.exe",
      "http",
      "--bind",
      "[::1]:8793",
      "--home=H",
    ]);
    expect(probeHost("0.0.0.0")).toBe("127.0.0.1");
    expect(probeHost("::")).toBe("[::1]");
    expect(probeHost("fe80::1")).toBe("[fe80::1]");
  });
});

describe("win32", () => {
  test("TCP tables are decoded in network byte order", () => {
    const v4 = new Uint8Array(4 + 24);
    const d4 = new DataView(v4.buffer);
    d4.setUint32(0, 1, true);
    v4.set([127, 0, 0, 1], 8);
    d4.setUint16(12, 36515, false);
    d4.setUint32(24, 9504, true);
    expect(parseIPv4Table(v4)).toEqual([{ address: "127.0.0.1", port: 36515, pid: 9504 }]);
    const v6 = new Uint8Array(4 + 56);
    const d6 = new DataView(v6.buffer);
    d6.setUint32(0, 1, true);
    d6.setUint16(4 + 14, 1, false);
    d6.setUint16(4 + 20, 8793, false);
    d6.setUint32(4 + 52, 77, true);
    expect(parseIPv6Table(v6)).toEqual([{ address: "::1", port: 8793, pid: 77 }]);
    expect(normalizeAddress("0:0:0:0:0:0:0:1")).toBe("::1");
  });

  test("FILETIME keeps the 100 ns precision of .NET round-trip dates", () => {
    const seconds = BigInt(Date.parse("2026-10-09T12:50:44Z")) * 10_000n;
    expect(fileTimeIso(116_444_736_000_000_000n + seconds + 5_896_509n)).toBe("2026-10-09T12:50:44.5896509Z");
  });

  test.skipIf(!windows)("live listeners and process start time", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      expect(tcpListeners()).toContainEqual({
        address: "127.0.0.1",
        port: server.port,
        pid: process.pid,
      });
    } finally {
      server.stop(true);
    }
    const started = Date.parse(processStartedAt(process.pid)!);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
    expect(Date.now() - started).toBeLessThan(3_600_000);
    expect(processStartedAt(0x7ffffff0)).toBeNull();
  });

  test.skipIf(!windows)("activation finds the child-owned listener, records it and health reads it back", async () => {
    const service = {
      ...base().services[0]!,
      executable: process.execPath,
      port: 0,
      healthPath: "/health",
    };
    const resolved: Resolved = {
      service,
      principal: service.principal!,
      trigger: { kind: "boot" },
      home: scratch,
    };
    const script = 'Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 204 }) });';
    const { child, record } = await activate(
      resolved,
      scratch,
      [process.execPath, "--no-env-file", "-e", script],
      15_000,
    );
    try {
      expect(record).toMatchObject({
        id: "site",
        kind: "site",
        pid: child.pid,
        healthStatus: 204,
        healthy: true,
      });
      expect(record.processStartedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
      const saved = JSON.parse(readFileSync(join(scratch, "run/native-services/site.json"), "utf8"));
      expect(saved).toEqual(record);
      expect(await health([resolved])).toEqual([{ id: "site", status: 204, healthy: true }]);
    } finally {
      child.kill();
      await child.exited;
    }
    expect(await health([resolved])).toEqual([{ id: "site", status: null, healthy: false }]);
  });

  test.skipIf(!windows)("a supervised child dies with its terminated supervisor", async () => {
    const module = JSON.stringify(join(import.meta.dir, "win32-net.ts"));
    const supervisor = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `const { killWithThisProcess } = await import(${module});
         const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
         killWithThisProcess(child.pid);
         console.log(child.pid);
         setInterval(() => {}, 1000);`,
      ],
      { stdout: "pipe", stderr: "inherit" },
    );
    const reader = supervisor.stdout.getReader();
    const pid = Number(new TextDecoder().decode((await reader.read()).value).trim());
    expect(processStartedAt(pid)).not.toBeNull();
    supervisor.kill();
    await supervisor.exited;
    const deadline = Date.now() + 5000;
    // oxlint-disable-next-line no-await-in-loop -- bounded wait for the job object to kill the child
    while (processStartedAt(pid) !== null && Date.now() < deadline) await Bun.sleep(100);
    expect(processStartedAt(pid)).toBeNull();
  });

  test.skipIf(!windows)("a child that never listens is stopped and reported", async () => {
    const service = {
      ...base().services[0]!,
      executable: process.execPath,
      port: 0,
    };
    const resolved: Resolved = {
      service,
      principal: service.principal!,
      trigger: { kind: "boot" },
      home: scratch,
    };
    await expect(activate(resolved, scratch, [process.execPath, "-e", "process.exit(3)"], 5_000)).rejects.toThrow(
      "s'est arrêté",
    );
  });
});
