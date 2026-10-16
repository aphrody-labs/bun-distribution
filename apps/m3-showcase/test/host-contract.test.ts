// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateIcons,
  ICON_SOURCE,
  iconCommand,
  TAURI_ROOT,
  SHOWCASE_ROOT,
} from "../scripts/icons";
import {
  assertFactoryHost,
  CARGO_RUNNER,
  prepareShowcaseHost,
  serializedTauriCommand,
  runTauri,
  showcaseShellFiles,
  sidecarCommand,
  tauriHostPlan,
} from "../scripts/tauri";

const installed = (name: string) =>
  ["tauri", "cargo", "rustc", "java"].includes(name)
    ? "/installed/" + name
    : null;

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("showcase host delivery contract", () => {
  test("uses canonical artwork and the installed owner without downloading replacements", async () => {
    expect(await Bun.file(ICON_SOURCE).exists()).toBe(true);
    expect(iconCommand("/consumer", "/installed/tauri")).toEqual([
      "/installed/tauri",
      "icon",
      ICON_SOURCE,
      "--output",
      "/consumer/icons",
      "--ios-color",
      "#6750a4",
    ]);
    expect(() => iconCommand("/consumer", null)).toThrow("installed Tauri CLI");
  });
  test("the icon plan defaults to the canonical Rust owner's packaging directory", async () => {
    const which = spyOn(Bun, "which").mockReturnValue("/installed/tauri");
    const output = spyOn(console, "log").mockImplementation(() => {});
    try {
      await generateIcons(["--plan"]);
      expect(output).toHaveBeenCalledTimes(1);
      const plan = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(plan.source).toBe(ICON_SOURCE);
      expect(plan.output).toBe(resolve(TAURI_ROOT, "icons"));
      expect(plan.command).toEqual(iconCommand(TAURI_ROOT, "/installed/tauri"));
      const config = await Bun.file(
        resolve(TAURI_ROOT, "tauri.conf.json"),
      ).json();
      for (const icon of config.bundle.icon)
        expect(resolve(TAURI_ROOT, icon).startsWith(plan.output + "/")).toBe(
          true,
        );
    } finally {
      output.mockRestore();
      which.mockRestore();
    }
  });
  test("the host has a real mobile entry and no ambient privileged namespace", () => {
    const files = showcaseShellFiles();
    const config = JSON.parse(String(files["tauri.conf.json"]));
    expect(config.build.frontendDist).toBe("../../../m3/apps/m3-showcase/dist");
    expect(config.app.windows).toEqual([]);
    expect(config.bundle.externalBin).toEqual(["binaries/m3-showcase"]);
    const wrap = JSON.parse(String(files["wrap.json"]));
    expect(wrap.mode).toBe("sidecar");
    expect(wrap.sidecar).toEqual({
      program: "m3-showcase",
      args: [],
      port: 0,
      readyPath: "/healthz",
      readyTimeoutSecs: 30,
      env: {},
    });
    expect(files["Cargo.toml"]).toContain(
      "aphrody-tauri-wrap.workspace = true",
    );
    expect(files["Cargo.toml"]).toContain("tauri-runtime-wry.workspace = true");
    expect(files["Cargo.toml"]).not.toContain("[workspace]");
    expect(files["src/lib.rs"]).toContain(
      'aphrody_tauri_wrap::init(include_str!("../wrap.json"))',
    );
    expect(config.build.beforeBuildCommand).toContain(
      "scripts/tauri.ts sidecar",
    );
    expect(config.app.withGlobalTauri).toBeUndefined();
    expect(config.app.security.csp).toContain("object-src 'none'");
    expect(config.app.security.csp).toContain("script-src 'self'");
    expect(files["src/lib.rs"]).toContain("tauri::mobile_entry_point");
    expect(
      JSON.parse(String(files["capabilities/default.json"])).permissions,
    ).toEqual([]);
    expect(files[".gitignore"]).toContain("/icons/");
  });
  test("the concrete native owner inherits workspace identities and resolves the canonical frontend", async () => {
    const manifest = Bun.TOML.parse(
      await Bun.file(resolve(TAURI_ROOT, "Cargo.toml")).text(),
    ) as {
      dependencies: Record<string, { workspace?: boolean }>;
      "build-dependencies": Record<string, { workspace?: boolean }>;
    };
    for (const name of ["tauri", "tauri-runtime-wry", "aphrody-tauri-wrap"])
      expect(manifest.dependencies[name]?.workspace).toBe(true);
    expect(manifest["build-dependencies"]["tauri-build"]?.workspace).toBe(true);
    const config = await Bun.file(
      resolve(TAURI_ROOT, "tauri.conf.json"),
    ).json();
    expect(resolve(TAURI_ROOT, config.build.frontendDist)).toBe(
      resolve(SHOWCASE_ROOT, "dist"),
    );
    const plan = tauriHostPlan(["build"], {}, "linux", installed);
    expect(plan.hostOwner).toBe(TAURI_ROOT);
    expect(plan.apiOwner).toBe(SHOWCASE_ROOT);
    expect(() =>
      serializedTauriCommand(
        ["build", "--", "--manifest-path", "/other/Cargo.toml"],
        "/tauri",
      ),
    ).toThrow("manifest");
  });
  test("Android and iOS diagnostics require their actual platform toolchains", () => {
    expect(
      tauriHostPlan(["android", "build"], {}, "linux", installed).missing.join(
        "; ",
      ),
    ).toContain("Android SDK");
    expect(
      tauriHostPlan(["android", "build"], {}, "linux", installed).missing.join(
        "; ",
      ),
    ).toContain("Android NDK");
    expect(
      tauriHostPlan(["ios", "build"], {}, "linux", installed).missing.join(
        "; ",
      ),
    ).toContain("macOS/Xcode");
    expect(
      tauriHostPlan(["build"], {}, "linux", () => null).missing,
    ).toHaveLength(3);
  });
  test("desktop compilation keeps factory admission and the canonical Cargo lock", () => {
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
    expect(() =>
      assertFactoryHost({ ...local, configured: false, host: "vps" }),
    ).toThrow("Workspace build factory");
    expect(() =>
      assertFactoryHost({ ...local, host: "vps", route: "factory" }),
    ).toThrow("Workspace build factory");
    expect(() =>
      assertFactoryHost({ ...local, host: "vps", localCargo: false }),
    ).not.toThrow();
    expect(
      serializedTauriCommand(["build", "--", "--release"], "/installed/tauri"),
    ).toEqual([
      "/installed/tauri",
      "build",
      "--runner",
      CARGO_RUNNER,
      "--",
      "--release",
      "--manifest-path",
      resolve(TAURI_ROOT, "Cargo.toml"),
      "--package",
      "aphrody-m3-showcase",
    ]);
    expect(() =>
      serializedTauriCommand(["build", "--runner=unlocked-cargo"], "/tauri"),
    ).toThrow("Cargo runner");
    expect(
      tauriHostPlan(["build"], {}, "linux", () => "/installed").execution,
    ).toBe("workspace-build-factory");
    expect(() =>
      serializedTauriCommand(["android", "build"], "/tauri"),
    ).toThrow("API host adapter");
  });
  test("global options cannot turn a local inspection into an unguarded heavy command", async () => {
    await expect(runTauri(["-v", "build"])).rejects.toThrow(
      "global options cannot bypass",
    );
    expect(() =>
      serializedTauriCommand(["build", "-rcargo"], "/tauri"),
    ).toThrow("Cargo runner");
  });
  test("sidecar target names match Tauri packaging and unsupported mobile hosts fail clearly", () => {
    const linux = sidecarCommand("x86_64-unknown-linux-gnu", "/consumer");
    expect(linux).toContain("linux-x64");
    expect(linux.at(-1)).toBe(
      "/consumer/binaries/m3-showcase-x86_64-unknown-linux-gnu",
    );
    const windows = sidecarCommand("x86_64-pc-windows-msvc", "/consumer");
    expect(windows).toContain("windows-x64");
    expect(windows.at(-1)).toEndWith("m3-showcase-x86_64-pc-windows-msvc.exe");
    expect(() => sidecarCommand("aarch64-linux-android")).toThrow(
      "canonical API host adapter",
    );
  });
  test("preparation fills missing shell files and preserves existing host configuration", async () => {
    temporary = await mkdtemp(join(tmpdir(), "m3-showcase-host-"));
    const path = join(temporary, "tauri.conf.json");
    await writeFile(path, '{"owner":"preserved"}');
    await prepareShowcaseHost(temporary);
    expect(await Bun.file(path).text()).toBe('{"owner":"preserved"}');
    expect(await Bun.file(join(temporary, "src/lib.rs")).exists()).toBe(true);
  });
});
