import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { runPythonCommand, resolveTools } from "../src/python";
import {
  EXPECTED_CLI_MAJOR,
  hostTarget,
  isDerivedPath,
  isVuArgv0,
  pathWithVu,
  resolveVu,
  runVu,
  verifyVuArtifact,
  vuExecutable,
  vuHome,
} from "../src/vu";

const target = hostTarget();
const supported = target !== null;
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A synthetic runtime artifact: the three executables, a library, a symlink and a manifest that lists them. */
function artifact(
  overrides: Record<string, unknown> = {},
  nativeBinaries = false,
): string {
  const artifactTarget = (overrides.target ?? target) as string;
  const windows = artifactTarget.endsWith("-windows-msvc");
  const withLink = !windows && process.platform !== "win32";
  const dir = mkdtempSync(join(tmpdir(), "vu-artifact-"));
  directories.push(dir);
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "share/vu"), { recursive: true });
  const files: Record<string, { sha256: string; bytes: number; mode: number }> =
    {};
  const add = (path: string, text: string, mode: number): void => {
    const destination = join(dir, path);
    if (windows && nativeBinaries && path.endsWith(".exe"))
      copyFileSync(process.execPath, destination);
    else writeFileSync(destination, text);
    chmodSync(join(dir, path), mode);
    const bytes = readFileSync(destination);
    files[path] = {
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      mode,
    };
  };
  add(vuExecutable("vu", artifactTarget), "#!/bin/sh\necho vu\n", 0o755);
  add(
    vuExecutable("uv", artifactTarget),
    "#!/bin/sh\necho uv 0.12.23\n",
    0o755,
  );
  add(
    vuExecutable("ruff", artifactTarget),
    "#!/bin/sh\necho ruff 0.16.10\n",
    0o755,
  );
  add(
    windows ? "bin/python312.dll" : "lib/libpython3.12.so.1.0",
    "libpython",
    0o755,
  );
  if (withLink)
    symlinkSync("libpython3.12.so.1.0", join(dir, "lib/libpython3.12.so"));
  writeFileSync(
    join(dir, "share/vu/manifest.json"),
    JSON.stringify({
      schema: 1,
      name: "vu-runtime",
      version: "0.1.0",
      target,
      toolchain: "rustc 1.98.1",
      revision: "a".repeat(40),
      pins: {},
      compatibility: { cliMajor: EXPECTED_CLI_MAJOR },
      capabilities: ["uv", "ruff", "python"],
      files,
      links: withLink ? { "lib/libpython3.12.so": "libpython3.12.so.1.0" } : {},
      ...overrides,
    }),
  );
  return dir;
}

describe.skipIf(!supported)("vu runtime artifact", () => {
  it("uses the SDK's native targets and platform executable names", () => {
    expect(hostTarget("x64", "win32")).toBe("x86_64-pc-windows-msvc");
    expect(hostTarget("arm64", "darwin")).toBe("aarch64-apple-darwin");
    expect(hostTarget("x64", "darwin")).toBe("x86_64-apple-darwin");
    expect(hostTarget("x64", "linux")).toBe("x86_64-unknown-linux-gnu");
    expect(hostTarget("arm64", "linux")).toBe("aarch64-unknown-linux-gnu");
    expect(hostTarget("unknown", "win32")).toBeNull();
    expect(vuExecutable("vu", "x86_64-pc-windows-msvc")).toBe("bin/vu.exe");
    expect(vuExecutable("uv", "x86_64-pc-windows-msvc")).toBe("bin/uv.exe");
    expect(vuExecutable("ruff", "x86_64-pc-windows-msvc")).toBe("bin/ruff.exe");
    expect(vuExecutable("python", "x86_64-pc-windows-msvc")).toBe(
      "bin/python.exe",
    );
    expect(vuExecutable("python", "x86_64-unknown-linux-gnu")).toBe(
      "bin/python3",
    );
  });

  it("verifies an intact artifact (quick and full)", async () => {
    const dir = artifact();
    const quick = await verifyVuArtifact(dir);
    expect(quick).toMatchObject({ state: "verified", full: false });
    const full = await verifyVuArtifact(dir, { full: true });
    expect(full).toMatchObject({ state: "verified", full: true });
  });

  it("refuses a changed executable, a wrong target and a wrong CLI major", async () => {
    const changed = artifact();
    writeFileSync(
      join(changed, vuExecutable("uv")),
      "#!/bin/sh\necho evil 0.0.0\n",
    );
    const bad = await verifyVuArtifact(changed);
    expect(bad.state).toBe("invalid");
    expect(bad.state === "invalid" && bad.problems).toContain(
      `sha256: ${vuExecutable("uv")}`,
    );

    const otherTarget =
      target === "aarch64-apple-darwin"
        ? "x86_64-unknown-linux-gnu"
        : "aarch64-apple-darwin";
    const wrongTarget = await verifyVuArtifact(
      artifact({ target: otherTarget }),
    );
    expect(
      wrongTarget.state === "invalid" && wrongTarget.problems.join(" "),
    ).toContain(`artifact targets ${otherTarget}`);

    const wrongMajor = await verifyVuArtifact(
      artifact({ compatibility: { cliMajor: EXPECTED_CLI_MAJOR + 1 } }),
    );
    expect(
      wrongMajor.state === "invalid" && wrongMajor.problems.join(" "),
    ).toContain("CLI major");

    const noCapability = await verifyVuArtifact(
      artifact({ capabilities: ["uv"] }),
    );
    expect(noCapability.state === "invalid" && noCapability.problems).toContain(
      "the manifest lacks the capability ruff",
    );
  });

  it("checks every file only on request", async () => {
    const dir = artifact();
    const library =
      process.platform === "win32"
        ? "bin/python312.dll"
        : "lib/libpython3.12.so.1.0";
    writeFileSync(join(dir, library), "tampered");
    writeFileSync(join(dir, "stray.txt"), "x");
    expect((await verifyVuArtifact(dir)).state).toBe("verified");
    const full = await verifyVuArtifact(dir, { full: true });
    expect(full.state === "invalid" && full.problems).toEqual(
      expect.arrayContaining([`size: ${library}`, "unlisted: stray.txt"]),
    );
  });

  it("ignores bytecode caches, which CPython writes into the runtime while it is used", async () => {
    expect(isDerivedPath("lib/python3.12/__pycache__/os.cpython-312.pyc")).toBe(
      true,
    );
    expect(isDerivedPath("lib/python3.12/os.py")).toBe(false);
    const dir = artifact();
    mkdirSync(join(dir, "lib/__pycache__"), { recursive: true });
    writeFileSync(join(dir, "lib/__pycache__/x.cpython-312.pyc"), "cache");
    expect(await verifyVuArtifact(dir, { full: true })).toMatchObject({
      state: "verified",
    });
  });

  it("reports a directory without a manifest as absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vu-empty-"));
    directories.push(dir);
    expect(await verifyVuArtifact(dir)).toMatchObject({ state: "absent" });
  });

  it("resolves the active artifact through $VU_HOME/runtime/<target>/current", async () => {
    const dir = artifact();
    const home = mkdtempSync(join(tmpdir(), "vu-home-"));
    directories.push(home);
    mkdirSync(join(home, "runtime", target as string), { recursive: true });
    symlinkSync(
      dir,
      join(home, "runtime", target as string, "current"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const env = { VU_HOME: home };
    expect(vuHome(env)).toBe(home);
    expect(await resolveVu({ env })).toMatchObject({ state: "verified" });
    expect(
      await resolveVu({ env: { VU_HOME: join(home, "nowhere") } }),
    ).toMatchObject({
      state: "absent",
    });
    expect(await resolveVu({ env: {}, artifact: dir })).toMatchObject({
      state: "verified",
    });
  });

  it("puts the artifact's bin first in PATH", () => {
    expect(pathWithVu("/opt/vu", "/usr/bin")).toBe(
      `${join("/opt/vu", "bin")}${delimiter}/usr/bin`,
    );
    expect(pathWithVu("/opt/vu", undefined)).toBe(join("/opt/vu", "bin"));
  });

  it("verifies Windows .exe entries and POSIX manifest keys in both modes", async () => {
    const windowsTarget = "x86_64-pc-windows-msvc";
    const dir = artifact({ target: windowsTarget });
    expect(
      await verifyVuArtifact(dir, { target: windowsTarget }),
    ).toMatchObject({
      state: "verified",
    });
    expect(
      await verifyVuArtifact(dir, { target: windowsTarget, full: true }),
    ).toMatchObject({
      state: "verified",
    });
    rmSync(join(dir, "bin/uv.exe"));
    expect(
      await verifyVuArtifact(dir, { target: windowsTarget }),
    ).toMatchObject({
      state: "invalid",
      problems: expect.arrayContaining(["missing: bin/uv.exe"]),
    });
  });

  it.each(
    [
      null,
      [],
      { capabilities: "uv ruff python" },
      { compatibility: { cliMajor: "0" } },
      { files: [] },
      { links: [] },
      { pins: null },
      { revision: 7 },
      { revision: "main" },
      { state: "verified", capabilities: null },
      { files: { "bin/uv": { sha256: "invalid", bytes: 1 } } },
      { files: { "bin/uv": { sha256: "a".repeat(64), bytes: -1 } } },
      { files: { "../outside": { sha256: "a".repeat(64), bytes: 0 } } },
      { files: { "/outside": { sha256: "a".repeat(64), bytes: 0 } } },
      { files: { "C:/outside": { sha256: "a".repeat(64), bytes: 0 } } },
      { files: { "bin\\uv": { sha256: "a".repeat(64), bytes: 0 } } },
      { links: { "bin/uv": null } },
      { links: { "bin/uv": "../../outside" } },
    ].map((invalid) => ({ invalid })),
  )(
    "rejects malformed manifest data without throwing: %j",
    async ({ invalid }) => {
      const dir = artifact();
      const path = join(dir, "share/vu/manifest.json");
      const original = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(
        path,
        JSON.stringify(
          invalid === null || Array.isArray(invalid)
            ? invalid
            : { ...original, ...invalid },
        ),
      );
      expect(await verifyVuArtifact(dir, { full: true })).toMatchObject({
        state: "invalid",
      });
    },
  );

  it("rejects unreadable manifests and non-file binaries without throwing", async () => {
    const dir = artifact();
    const path = join(dir, "share/vu/manifest.json");
    const original = readFileSync(path, "utf8");
    writeFileSync(path, "{");
    expect(await verifyVuArtifact(dir)).toMatchObject({ state: "invalid" });
    rmSync(path);
    mkdirSync(path);
    expect(await verifyVuArtifact(dir)).toMatchObject({ state: "invalid" });
    rmSync(path, { recursive: true });
    writeFileSync(path, original);
    const binary = join(dir, vuExecutable("vu"));
    rmSync(binary);
    mkdirSync(binary);
    expect(await verifyVuArtifact(dir)).toMatchObject({
      state: "invalid",
      problems: expect.arrayContaining([
        `not a regular file: ${vuExecutable("vu")}`,
      ]),
    });
  });

  it("requires sidecar entries during a full verification", async () => {
    expect(
      await verifyVuArtifact(artifact({ files: {} }), { full: true }),
    ).toMatchObject({
      state: "invalid",
      problems: expect.arrayContaining([`not listed: ${vuExecutable("uv")}`]),
    });
  });

  it("verifies a full artifact through a directory alias", async () => {
    const dir = artifact();
    const home = mkdtempSync(join(tmpdir(), "vu-alias-"));
    directories.push(home);
    const alias = join(home, "current");
    symlinkSync(dir, alias, process.platform === "win32" ? "junction" : "dir");
    expect(await verifyVuArtifact(alias, { full: true })).toMatchObject({
      state: "verified",
    });
  });

  it("refuses an unlisted directory link without traversing it", async () => {
    const dir = artifact();
    const outside = mkdtempSync(join(tmpdir(), "vu-outside-"));
    directories.push(outside);
    writeFileSync(join(outside, "outside.txt"), "outside");
    symlinkSync(
      outside,
      join(dir, "lib/outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await verifyVuArtifact(dir, { full: true });
    expect(result).toMatchObject({
      state: "invalid",
      problems: ["unlisted: lib/outside"],
    });
  });
});

describe.skipIf(!supported)("yolo py with the vu runtime", () => {
  it("delegates a Python verb through the manifested native executable", async () => {
    const dir = artifact();
    const calls: { command: string[]; path: string | undefined }[] = [];
    const code = await runPythonCommand(
      ["run", "--vu", dir, "script.py"],
      process.cwd(),
      {
        env: { PATH: process.env.PATH },
        run: async (command, options) => {
          calls.push({ command, path: options.env.PATH });
          return 13;
        },
      },
    );
    expect(calls).toEqual([
      {
        command: [join(dir, vuExecutable("vu")), "run", "script.py"],
        path: pathWithVu(dir, process.env.PATH),
      },
    ]);
    expect(code).toBe(13);
  });
  it("uses the verified artifact's uv and ruff and its bin first in PATH", async () => {
    const dir = artifact();
    const tools = await resolveTools(["--vu", dir], {
      env: { PATH: "/usr/bin" },
    });
    expect(tools).toMatchObject({
      source: "vu",
      uv: join(dir, vuExecutable("uv")),
      ruff: join(dir, vuExecutable("ruff")),
      python: join(dir, vuExecutable("python")),
    });
    expect(tools.env["PATH"]).toBe(`${join(dir, "bin")}${delimiter}/usr/bin`);
    expect(tools.env["VU_RUNTIME"]).toBe(dir);
    expect(tools.refusal).toBeNull();
  });

  it("falls back to the PATH tools when no artifact is installed, and with --no-vu", async () => {
    const home = mkdtempSync(join(tmpdir(), "vu-none-"));
    directories.push(home);
    const env = { VU_HOME: home, PATH: process.env["PATH"] };
    const absent = await resolveTools([], { env });
    expect(absent).toMatchObject({ source: "path", refusal: null });
    expect(absent.vu.state).toBe("absent");
    const dir = artifact();
    const forced = await resolveTools(["--no-vu", "--vu", dir], { env });
    expect(forced.source).toBe("path");
  });

  it("refuses a damaged artifact and an explicit --vu that is unusable", async () => {
    const dir = artifact();
    writeFileSync(join(dir, vuExecutable("ruff")), "#!/bin/sh\n");
    const damaged = await resolveTools(["--vu", dir], {
      env: { PATH: "/usr/bin" },
    });
    expect(damaged.refusal).toContain("failed verification");
    expect(damaged.refusal).toContain("--no-vu");
    const missing = await resolveTools(["--vu", join(dir, "nope")], {
      env: { PATH: "/usr/bin" },
    });
    expect(missing.refusal).toContain("no usable vu runtime");
  });

  it("runs the py/ commands with the artifact's tools and refuses with exit status 3 when it is damaged", async () => {
    const dir = artifact();
    const calls: { command: string[]; path: string | undefined }[] = [];
    const run = async (
      command: string[],
      options: {
        cwd: string;
        env: Readonly<Record<string, string | undefined>>;
      },
    ): Promise<number> => {
      calls.push({ command, path: options.env["PATH"] });
      return 0;
    };
    const deps = { env: { PATH: "/usr/bin" }, run, out: () => {} };
    expect(await runPythonCommand(["test", "--vu", dir], "/repo", deps)).toBe(
      0,
    );
    expect(await runPythonCommand(["lint", "--vu", dir], "/repo", deps)).toBe(
      0,
    );
    expect(
      await runPythonCommand(["fmt", "--engine", "--vu", dir], "/repo", deps),
    ).toBe(0);
    expect(await runPythonCommand(["build", "--vu", dir], "/repo", deps)).toBe(
      0,
    );
    expect(calls.map((call) => call.command.slice(0, 2))).toEqual([
      [join(dir, vuExecutable("uv")), "run"],
      [join(dir, vuExecutable("ruff")), "check"],
      [join(dir, vuExecutable("ruff")), "format"],
      [join(dir, vuExecutable("uv")), "build"],
    ]);
    expect(
      calls.every(
        (call) => call.path === `${join(dir, "bin")}${delimiter}/usr/bin`,
      ),
    ).toBe(true);
    expect(calls[2]?.command.at(-1)).toBe("packages/engine/python");
    expect(calls[0]?.command).toContain("py");

    writeFileSync(join(dir, vuExecutable("uv")), "#!/bin/sh\n");
    const before = calls.length;
    expect(await runPythonCommand(["test", "--vu", dir], "/repo", deps)).toBe(
      3,
    );
    expect(calls.length).toBe(before);
  });

  it("reports the runtime state in the JSON status", async () => {
    const dir = artifact({}, true);
    const lines: string[] = [];
    const code = await runPythonCommand(
      ["status", "--json", "--vu", dir],
      "/repo",
      {
        env: { PATH: "/usr/bin" },
        out: (line) => lines.push(line),
      },
    );
    expect(code).toBe(0);
    const report = JSON.parse(lines.join("\n"));
    expect(report.toolSource).toBe("vu");
    expect(report.vu).toMatchObject({
      state: "verified",
      version: "0.1.0",
      checked: "quick",
      artifact: dir,
    });
    // The fork dispatches uv.exe and ruff.exe by argv0; their version is not Bun's version.
    for (const [tool, reported] of [
      ["uv", report.uvVersion],
      ["ruff", report.ruffVersion],
    ] as const) {
      const executable = join(dir, vuExecutable(tool));
      const result = Bun.spawnSync([executable, "--version"], {
        windowsHide: true,
        env: { PATH: "/usr/bin" },
      });
      expect(result.exitCode).toBe(0);
      expect(reported).toBe(result.stdout.toString().trim().split("\n")[0]);
    }
  });
});

describe("vu alias of the single yolo executable", () => {
  it("recognises the argv0 names", () => {
    expect(isVuArgv0("vu")).toBe(true);
    expect(isVuArgv0("/home/u/.local/bin/vu")).toBe(true);
    expect(isVuArgv0("C:\\tools\\vu.exe")).toBe(true);
    expect(isVuArgv0("yolo")).toBe(false);
    expect(isVuArgv0("bun")).toBe(false);
    expect(isVuArgv0("vux")).toBe(false);
  });

  it.skipIf(!supported)(
    "delegates to the verified artifact and returns its exit code",
    async () => {
      const dir = artifact();
      writeFileSync(join(dir, vuExecutable("vu")), "#!/bin/sh\nexit 7\n");
      // The synthetic manifest lists the original script, so verify with an artifact whose manifest matches.
      const ok = artifact({}, true);
      expect(
        await runVu(["--version"], {
          artifact: ok,
          env: { ...process.env, BUN_BE_BUN: "1" },
        }),
      ).toBe(0);
      expect(
        await runVu([], { artifact: dir, env: { PATH: process.env["PATH"] } }),
      ).toBe(1);
    },
  );

  it.skipIf(!supported)("exits 127 without an installed runtime", async () => {
    const home = mkdtempSync(join(tmpdir(), "vu-none-"));
    directories.push(home);
    expect(
      await runVu(["--version"], {
        env: { VU_HOME: home, PATH: process.env["PATH"] },
      }),
    ).toBe(127);
  });

  it.skipIf(process.platform !== "win32")(
    "runs a verified native .exe and preserves its exit code",
    async () => {
      const dir = artifact();
      const binary = join(dir, "bin/vu.exe");
      copyFileSync(process.execPath, binary);
      const bytes = readFileSync(binary);
      const path = join(dir, "share/vu/manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.files["bin/vu.exe"] = {
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
      writeFileSync(path, JSON.stringify(manifest));
      expect(
        await runVu(["-e", "process.exit(7)"], {
          artifact: dir,
          env: { ...process.env, BUN_BE_BUN: "1" },
        }),
      ).toBe(7);
    },
  );
});
