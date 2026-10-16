import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTarget, runtimeHome } from "@aphrody/runtime-sdk/artifact";
import { COMPILE_FLAGS } from "../../../../scripts/release/compile-flags";
import { toolingAsset } from "../../../scripts/aphrody/release/tooling-asset.ts";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const work = mkdtempSync(join(tmpdir(), "yolo-installer-"));
const binary = join(work, process.platform === "win32" ? "yolo.exe" : "yolo");
const embeddedBinary = `${binary}-embedded`;
const artifact =
  process.env["YOLO_INSTALLER_TEST_ARTIFACT"] ??
  (existsSync(join(root, "dist/runtime", hostTarget(), "manifest.json"))
    ? join(root, "dist/runtime", hostTarget())
    : join(runtimeHome(), hostTarget(), "current"));
const nativeAvailable = existsSync(join(artifact, "manifest.json"));
let sequence = 0;

function checked(command: string[], cwd: string) {
  const result = Bun.spawnSync(command, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

beforeAll(async () => {
  const tooling = await toolingAsset(root);
  for (const [output, assets] of [
    [binary, []],
    [embeddedBinary, tooling.flags],
  ] as const) {
    checked(
      [
        process.execPath,
        "build",
        "--compile",
        ...COMPILE_FLAGS,
        ...assets,
        "--define",
        'YOLO_VERSION="2.0.0"',
        "packages/engine/yolo/src/index.ts",
        "--outfile",
        output,
      ],
      root,
    );
  }
}, 95_000);

afterAll(() => rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

type Installer = { script: string; shell: string; target: string; executable: string };
const installers: Installer[] = [];
if (process.platform !== "win32" && Bun.which("sh"))
  installers.push({ script: "install.sh", shell: "sh", target: hostTarget(), executable: "yolo" });
const powershell = Bun.which(process.platform === "win32" ? "pwsh.exe" : "pwsh");
if (powershell && process.arch === "x64")
  installers.push({
    script: "install.ps1",
    shell: powershell,
    target: "x86_64-pc-windows-msvc",
    executable: "yolo.exe",
  });

function fixture(installer: Installer, externalRuntime = false) {
  const dir = join(work, `case-${sequence++}`);
  const home = join(dir, "installation with spaces");
  const release = join(dir, "release");
  const main = join(dir, "main");
  const temp = join(dir, "temp");
  const runtime = externalRuntime ? join(dir, "external-runtime") : join(home, "runtime");
  for (const path of [
    home,
    release,
    temp,
    join(main, "bin"),
    join(main, "packages/engine/runtime"),
  ])
    mkdirSync(path, { recursive: true });
  cpSync(binary, join(main, "bin", installer.executable));
  writeFileSync(join(main, "VERSION"), "2.0.0\n");
  writeFileSync(
    join(main, "packages/engine/runtime/package.json"),
    '{"name":"@aphrody/runtime-sdk"}\n',
  );
  writeFileSync(join(home, "VERSION"), "1.0.0\n");
  for (const part of ["bin", "packages", "templates", "crates", "sdk", "stack"])
    mkdirSync(join(home, part));
  writeFileSync(join(home, "bin", installer.executable), "old executable\n");
  writeFileSync(join(home, "packages/old-sdk"), "old SDK\n");
  writeFileSync(join(home, "crates/old-crate"), "old crate\n");
  mkdirSync(join(runtime, hostTarget(), "old-artifact"), { recursive: true });
  if (nativeAvailable)
    cpSync(artifact, join(runtime, hostTarget(), "old-artifact"), {
      recursive: true,
      dereference: true,
    });
  writeFileSync(join(runtime, hostTarget(), "old-artifact/sentinel"), "old runtime\n");
  symlinkSync("old-artifact", join(runtime, hostTarget(), "current"), "dir");
  symlinkSync("old-artifact", join(runtime, hostTarget(), "previous"), "dir");
  if (nativeAvailable)
    cpSync(artifact, join(main, "artifact"), { recursive: true, dereference: true });
  else {
    mkdirSync(join(main, "artifact"));
    writeFileSync(join(main, "artifact/manifest.json"), "{}\n");
  }
  return { dir, home, release, main, temp, runtime };
}

type Fixture = ReturnType<typeof fixture>;
const hash = (data: string | Buffer) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

function pack(
  entry: Fixture,
  installer: Installer,
  crates: "invalid" | "missing" | "valid" | undefined = undefined,
) {
  const name = `yolo-2.0.0-${installer.target}.tar.gz`;
  checked(["tar", "-czf", join(entry.release, name), "-C", entry.main, "."], root);
  let sums = `${hash(readFileSync(join(entry.release, name)))}  ${name}\n`;
  if (crates) {
    const cratesName = "yolo-2.0.0-crates.tar.gz";
    const archive = join(entry.release, cratesName);
    if (crates === "invalid") writeFileSync(archive, "not a tar archive\n");
    else {
      const source = join(entry.dir, "crates-source");
      mkdirSync(source);
      if (crates === "valid") {
        mkdirSync(join(source, "crates"));
        writeFileSync(join(source, "crates/new-crate"), "new crate\n");
      } else writeFileSync(join(source, "unexpected"), "missing crates directory\n");
      checked(["tar", "-czf", archive, "-C", source, "."], root);
    }
    sums += `${hash(readFileSync(archive))}  ${cratesName}\n`;
  }
  writeFileSync(join(entry.release, "SHA256SUMS"), sums);
}

function run(entry: Fixture, installer: Installer) {
  const args = installer.script.endsWith(".ps1")
    ? [
        installer.shell,
        "-NoProfile",
        "-NonInteractive",
        "-File",
        join(root, "packages/engine/yolo", installer.script),
      ]
    : [installer.shell, join(root, "packages/engine/yolo", installer.script)];
  return Bun.spawnSync(args, {
    windowsHide: true,
    cwd: entry.dir,
    env: {
      PATH: process.platform === "win32" ? process.env["PATH"] : "/usr/bin:/bin",
      ...(process.platform === "win32" ? { SystemRoot: process.env["SystemRoot"] } : {}),
      HOME: entry.dir,
      USERPROFILE: entry.dir,
      TMPDIR: entry.temp,
      TMP: entry.temp,
      TEMP: entry.temp,
      YOLO_HOME: entry.home,
      YOLO_RUNTIME_HOME: entry.runtime,
      YOLO_RELEASE_DIR: entry.release,
      YOLO_NO_MODIFY_PATH: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
}

function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return { link: readlinkSync(path) };
  if (stat.isDirectory())
    return Object.fromEntries(
      readdirSync(path)
        .toSorted()
        .map((name) => [name, snapshot(join(path, name))]),
    );
  return hash(readFileSync(path));
}

function rejects(installer: Installer, entry: Fixture) {
  const before = { home: snapshot(entry.home), runtime: snapshot(entry.runtime) };
  const result = run(entry, installer);
  expect(result.exitCode).not.toBe(0);
  expect({ home: snapshot(entry.home), runtime: snapshot(entry.runtime) }).toEqual(before);
  const tempFiles = readdirSync(entry.temp).filter(
    (name) => !name.startsWith("clr-debug-pipe-") && !name.startsWith("dotnet-diagnostic-"),
  );
  expect(tempFiles).toEqual([]);
  return result;
}

function checkTempEmpty(tempDir: string) {
  const tempFiles = readdirSync(tempDir).filter(
    (name) => !name.startsWith("clr-debug-pipe-") && !name.startsWith("dotnet-diagnostic-"),
  );
  expect(tempFiles).toEqual([]);
}

for (const installer of installers) {
  describe(`${installer.script} validates before replacement`, () => {
    it("preserves an existing installation when the optional crate archive cannot be extracted", () => {
      const entry = fixture(installer);
      pack(entry, installer, "invalid");
      rejects(installer, entry);
    }, 20_000);

    it("rejects a crate archive without its required directory before replacing code", () => {
      const entry = fixture(installer);
      pack(entry, installer, "missing");
      expect(rejects(installer, entry).stderr.toString()).toContain("missing crates directory");
    }, 20_000);

    it("rejects a missing or unexecutable candidate without replacing code", () => {
      for (const missing of [true, false]) {
        const entry = fixture(installer);
        const executable = join(entry.main, "bin", installer.executable);
        if (missing) rmSync(executable);
        else {
          writeFileSync(executable, "cannot execute this binary\n");
          chmodSync(executable, 0o755);
        }
        pack(entry, installer);
        rejects(installer, entry);
      }
    }, 20_000);

    it("rejects an invalid native manifest without touching an external runtime store", () => {
      const entry = fixture(installer, true);
      writeFileSync(join(entry.main, "artifact/manifest.json"), "{}\n");
      pack(entry, installer);
      rejects(installer, entry);
    }, 20_000);

    it.skipIf(!nativeAvailable)(
      "rejects native load failure even when both archive and library hashes match",
      () => {
        const entry = fixture(installer);
        cpSync(embeddedBinary, join(entry.main, "bin", installer.executable));
        const manifestPath = join(entry.main, "artifact/manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const library = Object.keys(manifest.files).find((name) => /\.(so|dylib|dll)$/.test(name))!;
        const invalid = "this file is not a native library\n";
        writeFileSync(join(entry.main, "artifact", library), invalid);
        manifest.files[library] = { bytes: Buffer.byteLength(invalid), sha256: hash(invalid) };
        writeFileSync(manifestPath, JSON.stringify(manifest));
        pack(entry, installer);
        const result = rejects(installer, entry);
        expect(result.stdout.toString()).toContain("Installed");
      },
      20_000,
    );

    it.skipIf(!nativeAvailable)(
      "installs a loadable runtime and crates while keeping prior artifact history",
      () => {
        const entry = fixture(installer, true);
        pack(entry, installer, "valid");
        const result = run(entry, installer);
        expect(result.stderr.toString()).toBe("");
        expect(result.exitCode).toBe(0);
        expect(readFileSync(join(entry.home, "VERSION"), "utf8")).toBe("2.0.0\n");
        expect(readFileSync(join(entry.home, "crates/new-crate"), "utf8")).toBe("new crate\n");
        expect(
          readFileSync(join(entry.runtime, hostTarget(), "old-artifact/sentinel"), "utf8"),
        ).toBe("old runtime\n");
        expect(readlinkSync(join(entry.runtime, hostTarget(), "previous"))).toBe("old-artifact");
        expect(readlinkSync(join(entry.runtime, hostTarget(), "current"))).not.toBe("old-artifact");
        expect(existsSync(join(entry.home, "runtime"))).toBe(false);
        expect(existsSync(join(entry.home, "sdk"))).toBe(false);
        expect(existsSync(join(entry.home, "stack"))).toBe(false);
        checkTempEmpty(entry.temp);
        const installed = join(entry.home, "bin", installer.executable);
        const env = { ...process.env, YOLO_HOME: entry.home, YOLO_RUNTIME_HOME: entry.runtime };
        const rollback = Bun.spawnSync([installed, "runtime", "rollback"], {
          windowsHide: true,
          env,
        });
        expect(rollback.exitCode).toBe(0);
        expect(readlinkSync(join(entry.runtime, hostTarget(), "current"))).toBe("old-artifact");
        expect(
          Bun.spawnSync([installed, "runtime", "info", "--installed"], { windowsHide: true, env })
            .exitCode,
        ).toBe(0);
      },
      20_000,
    );

    it.skipIf(!nativeAvailable)(
      "qualifies the payload before creating a fresh installation",
      () => {
        const entry = fixture(installer);
        rmSync(entry.home, { recursive: true });
        pack(entry, installer);
        const result = run(entry, installer);
        expect(result.stderr.toString()).toBe("");
        expect(result.exitCode).toBe(0);
        expect(readFileSync(join(entry.home, "VERSION"), "utf8")).toBe("2.0.0\n");
        expect(existsSync(join(entry.runtime, hostTarget(), "current"))).toBe(true);
        expect(existsSync(join(entry.runtime, hostTarget(), "previous"))).toBe(false);
        checkTempEmpty(entry.temp);
      },
      20_000,
    );
  });
}
