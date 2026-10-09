// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { allowed } from "../../apps/web/src/os/wasm/server-routes";
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

describe("network relay allowlist", () => {
  test("defaults to loopback", () => {
    expect(allowed("localhost", 8080)).toBe(true);
    expect(allowed("127.0.0.1", 22)).toBe(true);
    expect(allowed("example.com", 443)).toBe(false);
  });
});
