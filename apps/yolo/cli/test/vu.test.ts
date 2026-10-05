import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPythonCommand, resolveTools } from "../src/python";
import {
  EXPECTED_CLI_MAJOR,
  hostTarget,
  pathWithVu,
  resolveVu,
  verifyVuArtifact,
  vuHome,
} from "../src/vu";

const target = hostTarget();
const supported = target !== null;
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** A synthetic runtime artifact: the three executables, a library, a symlink and a manifest that lists them. */
function artifact(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vu-artifact-"));
  directories.push(dir);
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "share/vu"), { recursive: true });
  const files: Record<string, { sha256: string; bytes: number; mode: number }> = {};
  const add = (path: string, text: string, mode: number): void => {
    writeFileSync(join(dir, path), text);
    chmodSync(join(dir, path), mode);
    files[path] = { sha256: sha256(text), bytes: Buffer.byteLength(text), mode };
  };
  add("bin/vu", "#!/bin/sh\necho vu\n", 0o755);
  add("bin/uv", "#!/bin/sh\necho uv 0.12.23\n", 0o755);
  add("bin/ruff", "#!/bin/sh\necho ruff 0.16.10\n", 0o755);
  add("lib/libpython3.12.so.1.0", "libpython", 0o755);
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
      links: { "lib/libpython3.12.so": "libpython3.12.so.1.0" },
      ...overrides,
    }),
  );
  return dir;
}

describe.skipIf(!supported)("vu runtime artifact", () => {
  it("verifies an intact artifact (quick and full)", async () => {
    const dir = artifact();
    const quick = await verifyVuArtifact(dir);
    expect(quick).toMatchObject({ state: "verified", full: false });
    const full = await verifyVuArtifact(dir, { full: true });
    expect(full).toMatchObject({ state: "verified", full: true });
  });

  it("refuses a changed executable, a wrong target and a wrong CLI major", async () => {
    const changed = artifact();
    writeFileSync(join(changed, "bin/uv"), "#!/bin/sh\necho evil 0.0.0\n");
    const bad = await verifyVuArtifact(changed);
    expect(bad.state).toBe("invalid");
    expect(bad.state === "invalid" && bad.problems).toContain("sha256: bin/uv");

    const wrongTarget = await verifyVuArtifact(artifact({ target: "aarch64-apple-darwin" }));
    expect(wrongTarget.state === "invalid" && wrongTarget.problems.join(" ")).toContain(
      "artifact targets aarch64-apple-darwin",
    );

    const wrongMajor = await verifyVuArtifact(
      artifact({ compatibility: { cliMajor: EXPECTED_CLI_MAJOR + 1 } }),
    );
    expect(wrongMajor.state === "invalid" && wrongMajor.problems.join(" ")).toContain("CLI major");

    const noCapability = await verifyVuArtifact(artifact({ capabilities: ["uv"] }));
    expect(noCapability.state === "invalid" && noCapability.problems).toContain(
      "the manifest lacks the capability ruff",
    );
  });

  it("checks every file only on request", async () => {
    const dir = artifact();
    writeFileSync(join(dir, "lib/libpython3.12.so.1.0"), "tampered");
    writeFileSync(join(dir, "stray.txt"), "x");
    expect((await verifyVuArtifact(dir)).state).toBe("verified");
    const full = await verifyVuArtifact(dir, { full: true });
    expect(full.state === "invalid" && full.problems).toEqual(
      expect.arrayContaining(["size: lib/libpython3.12.so.1.0", "unlisted: stray.txt"]),
    );
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
    symlinkSync(dir, join(home, "runtime", target as string, "current"));
    const env = { VU_HOME: home };
    expect(vuHome(env)).toBe(home);
    expect(await resolveVu({ env })).toMatchObject({ state: "verified" });
    expect(await resolveVu({ env: { VU_HOME: join(home, "nowhere") } })).toMatchObject({
      state: "absent",
    });
    expect(await resolveVu({ env: {}, artifact: dir })).toMatchObject({ state: "verified" });
  });

  it("puts the artifact's bin first in PATH", () => {
    expect(pathWithVu("/opt/vu", "/usr/bin")).toBe("/opt/vu/bin:/usr/bin");
    expect(pathWithVu("/opt/vu", undefined)).toBe("/opt/vu/bin");
  });
});

describe.skipIf(!supported)("yolo py with the vu runtime", () => {
  it("uses the verified artifact's uv and ruff and its bin first in PATH", async () => {
    const dir = artifact();
    const tools = await resolveTools(["--vu", dir], { env: { PATH: "/usr/bin" } });
    expect(tools).toMatchObject({
      source: "vu",
      uv: join(dir, "bin/uv"),
      ruff: join(dir, "bin/ruff"),
    });
    expect(tools.env["PATH"]).toBe(`${join(dir, "bin")}:/usr/bin`);
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
    writeFileSync(join(dir, "bin/ruff"), "#!/bin/sh\n");
    const damaged = await resolveTools(["--vu", dir], { env: { PATH: "/usr/bin" } });
    expect(damaged.refusal).toContain("failed verification");
    expect(damaged.refusal).toContain("--no-vu");
    const missing = await resolveTools(["--vu", join(dir, "nope")], { env: { PATH: "/usr/bin" } });
    expect(missing.refusal).toContain("no usable vu runtime");
  });

  it("runs the py/ commands with the artifact's tools and refuses with exit status 3 when it is damaged", async () => {
    const dir = artifact();
    const calls: { command: string[]; path: string | undefined }[] = [];
    const run = async (
      command: string[],
      options: { cwd: string; env: Readonly<Record<string, string | undefined>> },
    ): Promise<number> => {
      calls.push({ command, path: options.env["PATH"] });
      return 0;
    };
    const deps = { env: { PATH: "/usr/bin" }, run, out: () => {} };
    expect(await runPythonCommand(["test", "--vu", dir], "/repo", deps)).toBe(0);
    expect(await runPythonCommand(["lint", "--vu", dir], "/repo", deps)).toBe(0);
    expect(await runPythonCommand(["fmt", "--engine", "--vu", dir], "/repo", deps)).toBe(0);
    expect(await runPythonCommand(["build", "--vu", dir], "/repo", deps)).toBe(0);
    expect(calls.map((call) => call.command.slice(0, 2))).toEqual([
      [join(dir, "bin/uv"), "run"],
      [join(dir, "bin/ruff"), "check"],
      [join(dir, "bin/ruff"), "format"],
      [join(dir, "bin/uv"), "build"],
    ]);
    expect(calls.every((call) => call.path === `${join(dir, "bin")}:/usr/bin`)).toBe(true);
    expect(calls[2]?.command.at(-1)).toBe("packages/engine/python");
    expect(calls[0]?.command).toContain("py");

    writeFileSync(join(dir, "bin/uv"), "#!/bin/sh\n");
    const before = calls.length;
    expect(await runPythonCommand(["test", "--vu", dir], "/repo", deps)).toBe(3);
    expect(calls.length).toBe(before);
  });

  it("reports the runtime state in the JSON status", async () => {
    const dir = artifact();
    const lines: string[] = [];
    const code = await runPythonCommand(["status", "--json", "--vu", dir], "/repo", {
      env: { PATH: "/usr/bin" },
      out: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    const report = JSON.parse(lines.join("\n"));
    expect(report.toolSource).toBe("vu");
    expect(report.vu).toMatchObject({
      state: "verified",
      version: "0.1.0",
      checked: "quick",
      artifact: dir,
    });
    expect(report.uvVersion).toBe("uv 0.12.23");
    expect(report.ruffVersion).toBe("ruff 0.16.10");
  });
});
