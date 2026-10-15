// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  admitCargoJobs,
  cargoSubcommand,
  planCargo,
  routeSccacheWrapper,
  UsageError,
} from "./cargo-serial.ts";

const windowsTest = test.skipIf(process.platform !== "win32");
const fixtures: string[] = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("the subcommand skips toolchain selectors and valued global options", () => {
  expect(cargoSubcommand(["+nightly", "check", "-p", "x"])).toBe("check");
  expect(cargoSubcommand(["--config", 'env.CFLAGS.value="-W0"', "build", "--locked"])).toBe(
    "build",
  );
  expect(cargoSubcommand(["-Zunstable-options", "--locked", "fetch"])).toBe("fetch");
  expect(cargoSubcommand(["--version"])).toBeUndefined();
});

test("the Windows router replaces only sccache and preserves custom or empty wrappers", () => {
  const router = "C:/Users/test/.cargo/bin/aphrody-rustc-router.exe";
  expect(routeSccacheWrapper("sccache", router)).toBe(router);
  expect(routeSccacheWrapper("C:\\tools\\sccache.exe", router)).toBe(router);
  expect(routeSccacheWrapper("C:\\tools\\custom-rustc-wrapper.exe", router)).toBe(
    "C:\\tools\\custom-rustc-wrapper.exe",
  );
  expect(routeSccacheWrapper("", router)).toBe("");
  expect(routeSccacheWrapper(undefined, router)).toBeUndefined();
});

windowsTest(
  "the plan routes both Cargo wrapper variables and preserves the effective sccache path",
  () => {
    const root = mkdtempSync(join(tmpdir(), "aphrody-rustc-router-plan-"));
    fixtures.push(root);
    const router = join(root, "aphrody-rustc-router.exe");
    const cargoSccache = join(root, "cargo", "sccache.exe");
    const rustcSccache = join(root, "rustc", "sccache.exe");
    mkdirSync(join(root, "cargo"));
    mkdirSync(join(root, "rustc"));
    writeFileSync(router, "router fixture");
    writeFileSync(cargoSccache, "cargo sccache fixture");
    writeFileSync(rustcSccache, "rustc sccache fixture");
    const plan = planCargo(["check", "-p", "x"], true, {
      PATH: process.env.PATH ?? "",
      USERPROFILE: root,
      APHRODY_RUSTC_WRAPPER_ROUTER: router,
      CARGO_BUILD_RUSTC_WRAPPER: cargoSccache,
      RUSTC_WRAPPER: rustcSccache,
      LOCALAPPDATA: join(root, "local"),
      APHRODY_CARGO_JOBS: "2",
    });
    expect(plan.env.CARGO_BUILD_RUSTC_WRAPPER).toBe(router);
    expect(plan.env.RUSTC_WRAPPER).toBe(router);
    expect(plan.env.APHRODY_SCCACHE_EXE).toBe(rustcSccache);
  },
);

windowsTest("the plan preserves a custom effective wrapper and empty wrapper opt-outs", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-rustc-router-custom-"));
  fixtures.push(root);
  const router = join(root, "aphrody-rustc-router.exe");
  const sccache = join(root, "sccache.exe");
  const custom = join(root, "custom-wrapper.exe");
  writeFileSync(router, "router fixture");
  writeFileSync(sccache, "sccache fixture");
  writeFileSync(custom, "custom wrapper fixture");

  const customPlan = planCargo(["check", "-p", "x"], true, {
    PATH: process.env.PATH ?? "",
    USERPROFILE: root,
    APHRODY_RUSTC_WRAPPER_ROUTER: router,
    CARGO_BUILD_RUSTC_WRAPPER: sccache,
    RUSTC_WRAPPER: custom,
    LOCALAPPDATA: join(root, "local"),
    APHRODY_CARGO_JOBS: "2",
  });
  expect(customPlan.env.CARGO_BUILD_RUSTC_WRAPPER).toBe(router);
  expect(customPlan.env.RUSTC_WRAPPER).toBe(custom);
  expect(customPlan.env.APHRODY_SCCACHE_EXE).toBeUndefined();

  const rustcPlan = planCargo(["check", "-p", "x"], true, {
    PATH: process.env.PATH ?? "",
    USERPROFILE: root,
    APHRODY_RUSTC_WRAPPER_ROUTER: router,
    CARGO_BUILD_RUSTC_WRAPPER: custom,
    RUSTC_WRAPPER: sccache,
    LOCALAPPDATA: join(root, "local"),
    APHRODY_CARGO_JOBS: "2",
  });
  expect(rustcPlan.env.CARGO_BUILD_RUSTC_WRAPPER).toBe(custom);
  expect(rustcPlan.env.RUSTC_WRAPPER).toBe(router);
  expect(rustcPlan.env.APHRODY_SCCACHE_EXE).toBe(sccache);

  const emptyPlan = planCargo(["check", "-p", "x"], true, {
    PATH: process.env.PATH ?? "",
    USERPROFILE: root,
    APHRODY_RUSTC_WRAPPER_ROUTER: router,
    CARGO_BUILD_RUSTC_WRAPPER: "",
    RUSTC_WRAPPER: "",
    LOCALAPPDATA: join(root, "local"),
    APHRODY_CARGO_JOBS: "2",
  });
  expect(emptyPlan.env.CARGO_BUILD_RUSTC_WRAPPER).toBe("");
  expect(emptyPlan.env.RUSTC_WRAPPER).toBe("");
  expect(emptyPlan.env.APHRODY_SCCACHE_EXE).toBeUndefined();
});

test("the plan bounds jobs, refuses overrides and isolates the target directory", () => {
  const base = { PATH: "", RUSTC_WRAPPER: "" };
  expect(() => planCargo(["check", "-j8"], false, base)).toThrow(UsageError);
  expect(() => planCargo(["check", "--jobs=2"], false, base)).toThrow("APHRODY_CARGO_JOBS");
  expect(() => planCargo(["check"], false, { ...base, APHRODY_CARGO_JOBS: "1025" })).toThrow(
    "1 through 1024",
  );
  expect(() =>
    planCargo(["check", "--target-dir", "x"], false, {
      ...base,
      APHRODY_CARGO_TARGET_DIR: join(tmpdir(), "t"),
    }),
  ).toThrow("Do not mix");
  const heavy = planCargo(["check", "-p", "x"], false, { ...base, APHRODY_CARGO_JOBS: "2" });
  expect(heavy.heavy).toBe(true);
  expect(heavy.env.CARGO_BUILD_JOBS).toBe("2");
  expect(heavy.env.APHRODY_CARGO_JOBS).toBe("2");
  expect(heavy.env.CARGO_INCREMENTAL).toBe("0");
  // An explicit empty wrapper is a deliberate opt-out and survives.
  expect(heavy.env.RUSTC_WRAPPER).toBe("");
  const incremental = planCargo(["check"], false, {
    ...base,
    CARGO_INCREMENTAL: "0",
    APHRODY_CARGO_INCREMENTAL: "1",
  });
  expect("CARGO_INCREMENTAL" in incremental.env).toBe(false);
  const light = planCargo(["fetch", "--locked"], false, base);
  expect(light.heavy).toBe(false);
  expect(light.env.CARGO_BUILD_JOBS).toBeUndefined();
});

test("fresh Cargo admission respects each execution host's affinity", () => {
  for (const jobs of [12, 16, 24]) {
    const plan = planCargo(["check"], true, {
      PATH: "",
      RUSTC_WRAPPER: "",
      APHRODY_CARGO_JOBS: String(jobs),
    });
    expect(() => admitCargoJobs(plan, jobs)).not.toThrow();
    expect(() => admitCargoJobs(plan, 6)).toThrow("available CPUs");
    expect(() => admitCargoJobs(plan, NaN)).toThrow("available CPUs");
  }
});

test("the MSVC context appends the private Git alias to inherited process configuration", () => {
  const plan = planCargo(["build"], true, {
    PATH: "",
    RUSTC_WRAPPER: "",
    LOCALAPPDATA: join(tmpdir(), "local"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.autocrlf",
    GIT_CONFIG_VALUE_0: "false",
  });
  expect(plan.env.GIT_CONFIG_COUNT).toBe("2");
  expect(plan.env.GIT_CONFIG_KEY_0).toBe("core.autocrlf");
  expect(plan.env.GIT_CONFIG_KEY_1).toBe("url.https://github.com/.insteadOf");
  expect(plan.env.GIT_CONFIG_VALUE_1).toBe("ssh://git@github-dev/");
  expect(plan.env.CARGO_TARGET_DIR).toBe(join(tmpdir(), "local", "aphrody", "target"));
  expect(plan.env.SCCACHE_SERVER_PORT).toBe("4227");
  expect(plan.env.CARGO_BUILD_JOBS).toBe("4");
});

test("the MSVC context preserves an explicit empty Cargo wrapper opt-out", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-cargo-wrapper-opt-out-"));
  fixtures.push(root);
  const wrapper = join(root, "custom-rustc-wrapper.exe");
  writeFileSync(wrapper, "fixture");
  const plan = planCargo(["check", "-p", "x"], true, {
    PATH: process.env.PATH ?? "",
    RUSTC_WRAPPER: wrapper,
    CARGO_BUILD_RUSTC_WRAPPER: "",
    LOCALAPPDATA: join(tmpdir(), "local"),
    APHRODY_CARGO_JOBS: "2",
  });
  expect(plan.env.CARGO_BUILD_RUSTC_WRAPPER).toBe("");
  expect(plan.env.RUSTC_WRAPPER).toBe(wrapper);
});

windowsTest.each(["check", "package", "publish"])(
  "Cargo %s waits on the shared kernel mutex before verification",
  async (command) => {
    const root = mkdtempSync(join(tmpdir(), "aphrody-cargo-mutex-"));
    fixtures.push(root);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const log = join(root, "cargo.log");
    writeFileSync(join(bin, "cargo.cmd"), `@echo off\r\necho %*>>"${log}"\r\n`);
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"),
      ),
      PATH: `${bin};${process.env.PATH ?? ""}`,
      APHRODY_LOCAL_CARGO: "1",
      APHRODY_CARGO_JOBS: "1",
      APHRODY_CARGO_LOCK_TIMEOUT_SECS: "1",
      RUSTC_WRAPPER: "",
    };
    const run = () =>
      Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "cargo-serial.ts"), command, "-p", "fixture"],
        {
          env,
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
          timeout: 30_000,
        },
      );
    const { dlopen, FFIType, ptr } = await import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", {
      CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
      ReleaseMutex: { args: [FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    const name = Buffer.from("Local\\AphrodyCargoBuild\0", "utf16le");
    const handle = kernel32.symbols.CreateMutexW(null, 1, ptr(name));
    expect(handle).toBeTruthy();
    try {
      const blocked = run();
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr.toString()).toContain(
        "Timed out waiting for the shared Windows Cargo build lock",
      );
    } finally {
      kernel32.symbols.ReleaseMutex(handle);
      kernel32.symbols.CloseHandle(handle);
      kernel32.close();
    }
    const free = run();
    expect(free.stderr.toString()).toBe("");
    expect(free.exitCode).toBe(0);
    expect(readFileSync(log, "utf8").trim()).toBe(`${command} -p fixture`);
  },
);
