// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "../../src/admin/lib/context.ts";
import { createLogger } from "../../src/admin/lib/log.ts";
import { kitPaths } from "../../src/admin/lib/paths.ts";
import { parseAccessPack, type AccessPack } from "../../src/admin/lib/profile.ts";
import { fakeSystem, type FakeSystem } from "../../src/admin/lib/system.ts";
import { memoryUi, type MemoryUi } from "../../src/admin/lib/ui.ts";
import { generateKeyPair } from "../../src/admin/lib/wireguard.ts";

export const hubKey = generateKeyPair().publicKey;

/** Documentation addresses only (RFC 5737): no real address of the infrastructure appears in tests. */
export function packJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "aphrody-omar-access",
    issuedAt: "2026-10-06T12:00:00Z",
    issuedFor: "omar",
    wireguard: {
      tunnelName: "aphrody",
      block: `Address = 198.51.100.10/32\n\n[Peer]\n# hub aphrody\nPublicKey = ${hubKey}\nEndpoint = 203.0.113.9:51821\nAllowedIPs = 198.51.100.0/24\nPersistentKeepalive = 25\n`,
    },
    hosts: {
      vps: {
        address: "198.51.100.1",
        port: 22,
        user: "omar",
        roles: ["admin"],
        repoDir: "~/aphrody",
      },
      gpu: {
        address: "198.51.100.2",
        port: 22,
        user: "omar",
        roles: ["train"],
        repoDir: "/home/ubuntu/apps/aphrody",
        aphrodyBin: "/usr/local/bin/aphrody",
      },
    },
    trainHost: "gpu",
    services: {
      mcpHttp: {
        url: "http://198.51.100.1:8789/mcp",
        health: "http://198.51.100.1:8789/healthz",
      },
      a2a: {
        url: "http://198.51.100.1:8788",
        health: "http://198.51.100.1:8788/ping",
      },
    },
    hostKeys: [],
    ...overrides,
  };
}

export const samplePack = (overrides: Record<string, unknown> = {}): AccessPack => parseAccessPack(packJson(overrides));

export interface TestContext {
  ctx: Context;
  sys: FakeSystem;
  ui: MemoryUi;
  root: string;
}

/** A Context whose every path lives in a fresh temp folder and whose system is scripted. */
export function testContext(
  options: {
    platform?: NodeJS.Platform;
    answers?: (string | null)[];
    interactive?: boolean;
    fetchImpl?: Context["fetchImpl"];
  } = {},
): TestContext {
  const root = mkdtempSync(join(tmpdir(), "omar-test-"));
  const env: Record<string, string> = {
    USERPROFILE: join(root, "user"),
    HOME: join(root, "user"),
    LOCALAPPDATA: join(root, "local"),
    APPDATA: join(root, "roaming"),
    ProgramData: join(root, "programdata"),
    ProgramFiles: join(root, "programfiles"),
    SystemRoot: join(root, "windows"),
    USERNAME: "omar",
    COMPUTERNAME: "PC-DE-OMAR",
  };
  const sys = fakeSystem({ platform: options.platform ?? "win32", env });
  const paths = kitPaths(env);
  const ui = memoryUi(options.answers ?? [], options.interactive ?? true);
  const ctx: Context = {
    sys,
    ui,
    paths,
    log: createLogger(paths.logFile, () => new Date("2026-10-06T12:00:00Z")),
    version: "0.1.0",
    exePath: join(root, "downloads", "Aphrody-Omar.exe"),
    exeDir: join(root, "downloads"),
    fetchImpl: options.fetchImpl ?? (async () => new Response("not found", { status: 404 })),
    mcpProbe: async () => ({ ok: true, tools: 3 }),
  };
  return { ctx, sys, ui, root };
}
