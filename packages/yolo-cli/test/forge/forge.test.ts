// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ABSORBED,
  artifactLayout,
  BINARY,
  buildCommand,
  compileCommand,
  buildEnv,
  commitQueue,
  compareVersions,
  DEFAULT_CONFIG,
  ForgeError,
  llvmAccepted,
  paths,
  parseArgs,
  parseSize,
  recordBuild,
  remoteHead,
  rustChannel,
  SMOKE_SCRIPT,
  scratchPlan,
  type State,
  systemdUnit,
  toolUrl,
  versionIn,
} from "../../src/cli/forge/plan.ts";
import { runForge } from "../../src/cli/forge/main.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

describe("arguments", () => {
  test("defaults come from tools/config/bun-forge.json and the cache home", () => {
    const o = parseArgs(["build"], { HOME: "/home/x" });
    expect(o.command).toBe("build");
    expect(o.config.repository).toBe(DEFAULT_CONFIG.repository);
    expect(o.config.branch).toBe("main");
    expect(o.home).toBe("/home/x/.cache/bun-forge");
    expect(o.artifacts).toBe("/home/x/.cache/bun-forge/artifacts");
  });

  test("flags and environment override, both flag forms work", () => {
    const o = parseArgs(
      [
        "watch",
        "--branch=yolo",
        "--lto",
        "off",
        "--scratch",
        "tmpfs",
        "--scratch-size=32G",
        "--jobs",
        "8",
        "--latest",
        "--once",
      ],
      {
        HOME: "/h",
        BUN_FORGE_HOME: "/home/ubuntu/apps/forge",
        BUN_FORGE_REPOSITORY: "https://example.test/bun.git",
      },
    );
    expect(o.config).toMatchObject({
      branch: "yolo",
      lto: false,
      repository: "https://example.test/bun.git",
    });
    expect(o.config.scratch).toEqual({ mode: "tmpfs", size: "32G" });
    expect(o.config.watch.everyCommit).toBe(false);
    expect(o).toMatchObject({
      jobs: 8,
      once: true,
      home: "/home/ubuntu/apps/forge",
      artifacts: "/home/ubuntu/apps/forge/artifacts",
    });
    expect(DEFAULT_CONFIG.lto).toBe(true);
  });

  test("invalid input is refused", () => {
    expect(() => parseArgs(["deploy"], {})).toThrow(ForgeError);
    expect(() => parseArgs(["build", "--rev", "abc"], {})).toThrow(
      "full 40-character",
    );
    expect(() => parseArgs(["build", "--scratch", "ram"], {})).toThrow(
      "--scratch",
    );
    expect(() => parseArgs(["build", "--jobs", "0"], {})).toThrow("--jobs");
    expect(() => parseArgs(["build", "--nope"], {})).toThrow("unknown option");
    expect(() => parseArgs(["toString"], {})).toThrow("unknown command");
    expect(parseArgs([], {}).command).toBe("help");
    expect(parseArgs(["-h"], {}).command).toBe("help");
    expect(parseArgs(["--help"], {}).command).toBe("help");
    expect(parseArgs(["--version"], {}).command).toBe("version");
  });

  test("the yolo runner returns exit statuses instead of exiting", async () => {
    expect(await runForge(["version"])).toBe(0);
    expect(await runForge(["deploy"])).toBe(2);
    expect(await runForge(["build", "--jobs", "0"])).toBe(2);
  });
});

describe("versions and toolchain", () => {
  test("sizes and versions", () => {
    expect(parseSize("96G")).toBe(96 * 2 ** 30);
    expect(parseSize("512m")).toBe(512 * 2 ** 20);
    expect(() => parseSize("lots")).toThrow("invalid size");
    expect(compareVersions("3.30.5", "3.24.0")).toBeGreaterThan(0);
    expect(compareVersions("3.24", "3.24.0")).toBe(0);
    expect(versionIn("cmake version 3.28.3\n")).toBe("3.28.3");
    expect(versionIn("Ubuntu clang version 23.1.1 (++20260901)")).toBe(
      "23.1.1",
    );
  });

  test("LLVM range matches scripts/build/tools.ts", () => {
    expect(llvmAccepted("23.1.1", 23)).toBe(true);
    expect(llvmAccepted("23.1.0", 23)).toBe(true);
    expect(llvmAccepted("23.0.9", 23)).toBe(false);
    expect(llvmAccepted("24.1.0", 23)).toBe(false);
    expect(llvmAccepted(undefined, 23)).toBe(false);
  });

  test("download URLs per architecture", () => {
    const tc = DEFAULT_CONFIG.toolchain;
    expect(toolUrl(tc.llvm.url, "23.1.1", "llvm", "x64")).toBe(
      "https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/LLVM-23.1.1-Linux-X64.tar.xz",
    );
    expect(toolUrl(tc.cmake.url, "3.30.5", "cmake", "arm64")).toEndWith(
      "cmake-3.30.5-linux-aarch64.tar.gz",
    );
    expect(toolUrl(tc.rustup.url, "1.28.2", "rustup", "x64")).toBe(
      "https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init",
    );
  });

  test("rust channel comes from the checkout", () => {
    expect(
      rustChannel(
        '[toolchain]\nchannel = "nightly-2026-09-15"\ncomponents = ["rust-src"]\n',
      ),
    ).toBe("nightly-2026-09-15");
    expect(() => rustChannel("[toolchain]\n")).toThrow("channel");
  });
});

describe("scratch space", () => {
  const host = { root: true, freeBytes: 500 * 2 ** 30, uid: 1000, gid: 1000 };

  test("auto picks a loop partition when root and disk allow it, a directory otherwise", () => {
    expect(scratchPlan("auto", "96G", "/s", A, host).mode).toBe("loop");
    expect(
      scratchPlan("auto", "96G", "/s", A, { ...host, root: false }).mode,
    ).toBe("dir");
    expect(
      scratchPlan("auto", "96G", "/s", A, { ...host, freeBytes: 50 * 2 ** 30 })
        .mode,
    ).toBe("dir");
  });

  test("loop partition setup and teardown", () => {
    const plan = scratchPlan("loop", "1G", "/s", A, host);
    expect(plan.dir).toBe("/s/aaaaaaaaaaaa");
    expect(plan.image).toBe("/s/aaaaaaaaaaaa.img");
    expect(plan.setup.map((c) => c[0])).toEqual([
      "mkdir",
      "fallocate",
      "mkfs.ext4",
      "mount",
      "chown",
    ]);
    expect(plan.setup[1]).toEqual([
      "fallocate",
      "-l",
      String(2 ** 30),
      "/s/aaaaaaaaaaaa.img",
    ]);
    expect(plan.teardown).toEqual([
      ["umount", "/s/aaaaaaaaaaaa"],
      ["rm", "-f", "/s/aaaaaaaaaaaa.img"],
      ["rmdir", "/s/aaaaaaaaaaaa"],
    ]);
  });

  test("tmpfs is owned by the building user; privileged modes need root", () => {
    const plan = scratchPlan("tmpfs", "8G", "/s", A, host);
    expect(plan.setup[1]).toContain(
      `size=${8 * 2 ** 30},mode=0755,uid=1000,gid=1000`,
    );
    expect(() =>
      scratchPlan("loop", "8G", "/s", A, { ...host, root: false }),
    ).toThrow("needs root");
    expect(
      scratchPlan("dir", "8G", "/s", A, { ...host, root: false }).teardown,
    ).toEqual([["rm", "-rf", "/s/aaaaaaaaaaaa"]]);
  });
});

describe("commit queue", () => {
  test("ls-remote parsing", () => {
    expect(
      remoteHead(`${A}\trefs/heads/main\n${B}\trefs/heads/yolo\n`, "yolo"),
    ).toBe(B);
    expect(remoteHead(`${A}\trefs/heads/main-old\n`, "main")).toBeUndefined();
  });

  test("every commit after the last one, oldest first", () => {
    const history = [D, C, B, A];
    expect(commitQueue(history, B, true)).toEqual([C, D]);
    expect(commitQueue(history, B, false)).toEqual([D]);
    expect(commitQueue(history, D, true)).toEqual([]);
    expect(commitQueue(history, undefined, true)).toEqual([D]);
    expect(commitQueue(history, "f".repeat(40), true)).toEqual([D]);
    expect(commitQueue([], undefined, true)).toEqual([]);
  });

  test("state moves to the last attempted commit and keeps bounded history", () => {
    let state: State = { builds: [] };
    state = recordBuild(state, { revision: A, ok: true, finishedAt: "t1" }, 2);
    state = recordBuild(state, { revision: B, ok: false, finishedAt: "t2" }, 2);
    state = recordBuild(state, { revision: C, ok: true, finishedAt: "t3" }, 2);
    expect(state.last).toBe(C);
    expect(state.builds.map((b) => b.revision)).toEqual([B, C]);
  });
});

describe("build environment", () => {
  const p = paths({ home: "/f", config: DEFAULT_CONFIG });

  test("caches, rust and LLVM wiring", () => {
    const env = buildEnv({
      paths: p,
      baseEnv: { PATH: "/usr/bin", BUN_BE_BUN: "1", HOME: "/h" },
      rustChannel: "nightly-x",
      llvmDir: "/f/toolchains/llvm-23.1.1",
      cmakeDir: "/f/toolchains/cmake-3.30.5",
    });
    expect(env.PATH).toBe(
      "/f/bin:/f/toolchains/cargo/bin:/f/toolchains/llvm-23.1.1/bin:/f/toolchains/cmake-3.30.5/bin:/usr/bin",
    );
    expect(env).toMatchObject({
      HOME: "/h",
      RUSTUP_TOOLCHAIN: "nightly-x",
      BUN_TOOLCHAIN_LLVM: "/f/toolchains/llvm-23.1.1",
      BUN_BUILD_CACHE_DIR: "/f/build-cache",
      CCACHE_DIR: "/f/ccache",
      CARGO_HOME: "/f/toolchains/cargo",
    });
    expect(env.BUN_BE_BUN).toBeUndefined();
    expect(
      buildEnv({ paths: p, baseEnv: {}, rustChannel: "n" }).BUN_TOOLCHAIN_LLVM,
    ).toBeUndefined();
  });

  test("build command follows the profile and LTO switch", () => {
    expect(buildCommand(DEFAULT_CONFIG)).toEqual([
      "bun",
      "scripts/build.ts",
      "--profile=release",
    ]);
    expect(buildCommand({ ...DEFAULT_CONFIG, lto: false }, 12)).toEqual([
      "bun",
      "scripts/build.ts",
      "--profile=release",
      "--lto=off",
      "-j12",
    ]);
  });

  test("absorbed specifiers match tools/config/bun-absorb.json fork entries", async () => {
    const absorb = await Bun.file(
      new URL(
        "../../../../tools/aphrody/config/bun-absorb.json",
        import.meta.url,
      ),
    ).json();
    const fork = absorb.packages
      .filter((entry: { status: string }) => entry.status === "fork")
      .map((entry: { name: string }) => entry.name);
    expect(ABSORBED.filter((s) => s !== "dotenv/config").toSorted()).toEqual(
      fork.toSorted(),
    );
  });

  test("the fork build is one product: binary yolo, aliases bun and vu", () => {
    expect(BINARY).toEqual({ name: "yolo", aliases: ["bun", "vu"] });
    expect(artifactLayout("/home/ubuntu/apps/forge/artifacts/abc")).toEqual({
      binary: "/home/ubuntu/apps/forge/artifacts/abc/yolo",
      aliases: {
        bun: "/home/ubuntu/apps/forge/artifacts/abc/bun",
        vu: "/home/ubuntu/apps/forge/artifacts/abc/vu",
      },
    });
  });

  test("compile command puts the CLI on the engine that runs it", () => {
    expect(
      compileCommand(
        "/art/bun",
        "/art/yolo",
        "0.1.0",
        ["--bytecode"],
        "/lib/libaphrody_ffi.so",
      ),
    ).toEqual([
      "/art/bun",
      "build",
      "--compile",
      "--bytecode",
      "--asset",
      "/lib/libaphrody_ffi.so",
      "--define",
      'YOLO_VERSION="0.1.0"',
      "packages/engine/yolo/src/index.ts",
      "--outfile",
      "/art/yolo",
    ]);
    expect(compileCommand("/art/bun", "/art/yolo", "0.1.0", [])).not.toContain(
      "--asset",
    );
  });

  test("--yolo-root and --yolo-asset select the compiled artifact", () => {
    const options = parseArgs(
      ["build", "--yolo-root", "/repo", "--yolo-asset=/lib/x.so"],
      {},
    );
    expect(options.yoloRoot).toBe("/repo");
    expect(options.yoloAsset).toBe("/lib/x.so");
    expect(parseArgs(["build"], { BUN_FORGE_YOLO_ROOT: "/env" }).yoloRoot).toBe(
      "/env",
    );
    expect(parseArgs(["build"], {}).yoloRoot).toBeUndefined();
  });

  test("a runtime linked as yolo, bun and vu runs under each argv0 name", () => {
    const dir = mkdtempSync(join(tmpdir(), "yolo-argv0-"));
    try {
      symlinkSync(process.execPath, join(dir, BINARY.name));
      for (const alias of BINARY.aliases)
        symlinkSync(BINARY.name, join(dir, alias));
      for (const name of [BINARY.name, ...BINARY.aliases]) {
        const r = Bun.spawnSync(
          [
            join(dir, name),
            "-e",
            'console.log(process.argv0.split("/").pop(), Bun.version)',
          ],
          {
            windowsHide: true,
            // Probe engine aliases even when the host embeds the Yolo product dispatcher.
            // Product yolo/bun/vu dispatch is qualified separately on the shipped artifact.
            env: { ...process.env, BUN_BE_BUN: "1" },
          },
        );
        expect(r.exitCode).toBe(0);
        expect(r.stdout.toString().trim()).toBe(`${name} ${Bun.version}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("smoke script reports argv0 so the alias is checked", () => {
    expect(SMOKE_SCRIPT).toContain("argv0");
  });

  test("systemd unit runs watch with the forge home", () => {
    const unit = systemdUnit(
      "/usr/local/bin/yolo forge",
      "/home/ubuntu/apps/forge",
      "builder",
    );
    expect(unit).toContain("ExecStart=/usr/local/bin/yolo forge watch");
    expect(unit).toContain(
      "Environment=BUN_FORGE_HOME=/home/ubuntu/apps/forge",
    );
    expect(unit).toContain("User=builder");
  });
});
