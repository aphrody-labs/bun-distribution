// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import os from "node:os";
import type { AbiProbe, FfiSources } from "../src/os/ffi-routes";
import { headerFunctions, symbolNames, symbolsBlock } from "../src/os/ffi-routes";
import { handleWebOsExtensions } from "../src/os/server-extensions";
import { parseOsRelease, parseSwaps, type SystemSnapshot } from "../src/os/system-metrics";

// The routes tested here never upgrade, so no live server is needed.
const server = {} as Server<unknown>;

async function get(path: string): Promise<Response | null> {
  const url = new URL(path, "http://localhost");
  return handleWebOsExtensions(new Request(url), url, server);
}

describe("GET /api/webos/system", () => {
  test("reports the host as node:os sees it", async () => {
    const res = await get("/api/webos/system");
    expect(res?.status).toBe(200);
    const snap = (await res!.json()) as SystemSnapshot;
    expect({
      platform: snap.host.platform,
      hostname: snap.host.hostname,
      release: snap.host.release,
      cpus: snap.cpu.count,
      total: snap.memory.totalBytes,
      bun: snap.runtime.bun,
      pid: snap.runtime.pid,
    }).toEqual({
      platform: process.platform,
      hostname: os.hostname(),
      release: os.release(),
      cpus: os.cpus().length,
      total: os.totalmem(),
      bun: Bun.version,
      pid: process.pid,
    });
    expect(snap.memory.usedBytes).toBe(snap.memory.totalBytes - snap.memory.freeBytes);
    if (snap.cpu.usagePercent !== null) {
      expect(snap.cpu.usagePercent).toBeGreaterThanOrEqual(0);
      expect(snap.cpu.usagePercent).toBeLessThanOrEqual(100);
    }
    if (process.platform === "linux") {
      expect(snap.linux).not.toBeNull();
      expect(Object.keys(snap.linux!.sysctl)).toContain("vm.swappiness");
    } else {
      expect(snap.linux).toBeNull();
      expect(snap.unavailable.some(reason => reason.includes("Linux only"))).toBe(true);
    }
    if (process.platform === "win32") expect(snap.cpu.loadAverage).toBeNull();
  });

  test("parses /proc/swaps and /etc/os-release", () => {
    expect(
      parseSwaps(
        "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n/dev/zram0                              partition\t8388604\t\t1024\t\t100\n",
      ),
    ).toEqual([{ name: "/dev/zram0", type: "partition", sizeKb: 8388604, usedKb: 1024, priority: 100 }]);
    expect(parseOsRelease('NAME="Alpine Linux"\nPRETTY_NAME="Alpine Linux v3.24"\n')).toBe("Alpine Linux v3.24");
    expect(parseOsRelease("NAME=x\n")).toBeNull();
  });
});

describe("/api/ffi", () => {
  test("sources are the repository files, and every SDK symbol is declared by aphrody.h", async () => {
    const res = await get("/api/ffi/sources");
    expect(res?.status).toBe(200);
    const sources = (await res!.json()) as FfiSources;
    expect(sources.header).toContain("uint32_t yolo_abi_version(void);");
    expect(sources.sdkSymbols).toStartWith("export const SYMBOLS = {");
    expect(sources.rustConsumer).not.toBeNull();
    expect(sources.drift?.missingFromHeader).toEqual([]);
    expect(sources.drift?.missingFromSdk).toEqual([]);
  });

  test("header and SYMBOLS parsers", () => {
    expect(headerFunctions("uint32_t yolo_abi_version(void);\nvoid yolo_buffer_free(YoloBuffer *buffer);\n")).toEqual([
      "yolo_abi_version",
      "yolo_buffer_free",
    ]);
    const block = symbolsBlock("x\nexport const SYMBOLS = {\n  yolo_a: {},\n  yolo_b: {},\n} as const;\ny");
    expect(block).toBe("export const SYMBOLS = {\n  yolo_a: {},\n  yolo_b: {},\n} as const;");
    expect(symbolNames(block!)).toEqual(["yolo_a", "yolo_b"]);
  });

  test("abi probe returns the decoded version or the reason it could not load", async () => {
    const res = await get("/api/ffi/abi");
    expect(res?.status).toBe(200);
    const probe = (await res!.json()) as AbiProbe;
    if (probe.available) {
      expect(probe.major).toBe(probe.version >>> 16);
      expect(probe.minor).toBe(probe.version & 0xffff);
      expect(probe.major).toBeGreaterThanOrEqual(1);
    } else {
      expect(probe.error.length).toBeGreaterThan(0);
    }
  });

  test("other paths are left to server.ts", async () => {
    expect(await get("/api/ffi/unknown")).toBeNull();
    expect(await get("/api/metrics")).toBeNull();
  });
});
