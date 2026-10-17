// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { webosOwnerModule } from "./fork";
import { MODULES, rootfsSeed } from "./rootfs-seed";
import { BLOCKERS, cfgMayMatchWasm } from "./wasm-inventory";

describe("rootfs seed", () => {
  const seed = rootfsSeed();

  test("is Aphrody Alpine 3.24 with the wasm32 apk repository", () => {
    expect(seed["/etc/alpine-release"]).toBe("3.24.0\n");
    expect(seed["/etc/apk/arch"]).toBe("wasm32\n");
    expect(seed["/etc/apk/repositories"]).toBe(
      "https://github.com/aphrody-labs/aports/releases/download/aphrody-3.24-wasm32\n",
    );
  });

  test("paths are absolute and the module registry is valid JSON", () => {
    for (const path of Object.keys(seed)) expect(path.startsWith("/")).toBe(true);
    expect(JSON.parse(seed["/usr/share/aphrody/modules.json"]!)).toEqual(MODULES);
  });
});

describe("wasm inventory", () => {
  test("cfg matching", () => {
    expect(cfgMayMatchWasm('cfg(target_arch = "wasm32")')).toBe(true);
    expect(cfgMayMatchWasm('cfg(not(target_arch = "wasm32"))')).toBe(false);
    expect(cfgMayMatchWasm("cfg(windows)")).toBe(false);
  });

  test("native-only crates are blocked", () => {
    expect(BLOCKERS["portable-pty"]?.verdict).toBe("blocked");
  });
});

describe("Bun fork host access boundary", () => {
  test("configured owner is required instead of a machine-specific checkout", () => {
    expect(() => webosOwnerModule("server.ts", "")).toThrow("APHRODY_BUN_CHECKOUT");
  });

  test("only explicit same-origin loopback host access is allowed", async () => {
    const { hostAccessProblem, isLoopbackHost } = await import(
      webosOwnerModule("src/server/guard.ts")
    );
    const server = { hostname: "127.0.0.1", port: 3001, requestIP: () => ({ address: "127.0.0.1" }) };
    const request = new Request("http://127.0.0.1:3001/api/shell");
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(hostAccessProblem(request, server, { enabled: false })).toContain("disabled");
    expect(hostAccessProblem(request, server, { enabled: true })).toBeNull();
    expect(
      hostAccessProblem(
        new Request(request, { headers: { origin: "https://example.com" } }),
        server,
        { enabled: true },
      ),
    ).toContain("origin");
    expect(
      hostAccessProblem(request, { ...server, hostname: "0.0.0.0" }, { enabled: true }),
    ).toContain("loopback listener");
  });
});
