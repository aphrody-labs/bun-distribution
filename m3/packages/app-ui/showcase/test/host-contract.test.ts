// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  APHRODY_ROOT,
  assertFactoryHost,
  DESKTOP_ROOT,
  runTauri,
  SHOWCASE_ROOT,
  showcaseHostPlan,
  sidecarCommand,
} from "../scripts/tauri";

const installed = (name: string) =>
  ["cargo", "rustc"].includes(name) ? "/installed/" + name : null;

describe("showcase host delivery contract", () => {
  test("the showcase is a window of the one desktop, not a separate shell", async () => {
    expect(DESKTOP_ROOT).toBe(resolve(APHRODY_ROOT, "crates/ui/app"));
    expect(await Bun.file(resolve(APHRODY_ROOT, "crates/ui/m3-showcase/Cargo.toml")).exists()).toBe(
      false,
    );
    const plan = showcaseHostPlan(["info"], "linux", installed);
    expect(plan.desktopOwner).toBe(DESKTOP_ROOT);
    expect(plan.apiOwner).toBe(SHOWCASE_ROOT);
    expect(plan.launch).toBe("aphrody-app --showcase");
    expect(plan.execution).toBe("local");
    const desktop = await Bun.file(resolve(DESKTOP_ROOT, "src/showcase.rs")).text();
    expect(desktop).toContain('const PROGRAM: &str = "m3-showcase"');
    expect(desktop).toContain('ready_path: "/healthz"');
  });
  test("sidecar compilation needs the Rust toolchain and keeps factory execution", () => {
    const plan = showcaseHostPlan(["sidecar"], "linux", installed);
    expect(plan.execution).toBe("workspace-build-factory");
    expect(plan.missing).toEqual([]);
    expect(showcaseHostPlan(["sidecar"], "linux", () => null).missing).toHaveLength(2);
  });
  test("desktop compilation keeps factory admission", () => {
    const local = {
      configured: true,
      enabled: true,
      target: "vps",
      host: null,
      localCargo: true,
      route: "local" as const,
      reason: "diagnostic",
    };
    expect(() => assertFactoryHost(local)).toThrow("Workspace build factory");
    expect(() => assertFactoryHost({ ...local, configured: false, host: "vps" })).toThrow(
      "Workspace build factory",
    );
    expect(() => assertFactoryHost({ ...local, host: "vps", route: "factory" })).toThrow(
      "Workspace build factory",
    );
    expect(() => assertFactoryHost({ ...local, host: "vps", localCargo: false })).not.toThrow();
  });
  test("only the explicit owner commands run", async () => {
    await expect(runTauri(["-v", "build"])).rejects.toThrow("explicit owner command");
    await expect(runTauri(["android", "build"])).rejects.toThrow("explicit owner command");
  });
  test("sidecar target names match the compiler and unsupported mobile hosts fail clearly", () => {
    const linux = sidecarCommand("x86_64-unknown-linux-gnu", "/consumer");
    expect(linux).toContain("linux-x64");
    expect(linux.at(-1)).toBe(resolve("/consumer/m3-showcase-x86_64-unknown-linux-gnu"));
    const windows = sidecarCommand("x86_64-pc-windows-msvc", "/consumer");
    expect(windows).toContain("windows-x64");
    expect(windows.at(-1)).toEndWith("m3-showcase-x86_64-pc-windows-msvc.exe");
    expect(() => sidecarCommand("aarch64-linux-android")).toThrow("canonical API host adapter");
  });
});
