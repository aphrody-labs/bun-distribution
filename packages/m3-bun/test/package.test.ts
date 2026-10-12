// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { archiveDir, buildRootfs, packageApp, parseLdd } from "../src/package.ts";
import { sha256 } from "../src/util.ts";
import { cleanup, fixtureCopy, tmp } from "./helpers.ts";

afterAll(cleanup);

const LDD = `\tlinux-vdso.so.1 (0x00007e85dea9f000)
\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007e85de800000)
\t/lib64/ld-linux-x86-64.so.2 (0x00007e85deaa1000)
\tlibpthread.so.0 => /lib/x86_64-linux-gnu/libpthread.so.0 (0x00007e85dea74000)
\tlibmissing.so.1 => not found
`;

describe("parseLdd", () => {
  test("absolute library paths and the loader; the vdso and unresolved names are skipped; sorted and unique", () => {
    expect(parseLdd(LDD)).toEqual([
      "/lib/x86_64-linux-gnu/libc.so.6",
      "/lib/x86_64-linux-gnu/libpthread.so.0",
      "/lib64/ld-linux-x86-64.so.2",
    ]);
    expect(parseLdd(`${LDD}${LDD}`)).toHaveLength(3);
    expect(parseLdd("")).toEqual([]);
  });
});

describe("archiveDir", () => {
  test.skipIf(process.platform === "win32")("tar.gz keeps the executable bit and lists every staged file", async () => {
    const staging = tmp();
    writeFileSync(join(staging, "app"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(staging, "README.txt"), "hi");
    mkdirSync(join(staging, "deploy"));
    writeFileSync(join(staging, "deploy", "x.conf"), "x");
    const archive = join(tmp(), "out", "a.tar.gz");
    await archiveDir(staging, archive, "tar.gz");
    const listing = Bun.spawnSync(["tar", "-tvzf", archive], { stdout: "pipe" }).stdout.toString();
    expect(listing).toMatch(/-rwxr-xr-x .* \.\/app/);
    expect(listing).toContain("./deploy/x.conf");
    expect(listing).toContain("./README.txt");
  });

  test("the tarball is byte-reproducible with GNU tar", async () => {
    const gnu = Bun.spawnSync(["tar", "--version"], { stdout: "pipe" }).stdout.toString().includes("GNU");
    if (!gnu) return;
    const staging = tmp();
    writeFileSync(join(staging, "a"), "a");
    writeFileSync(join(staging, "b"), "b");
    const out = tmp();
    await archiveDir(staging, join(out, "1.tar.gz"), "tar.gz");
    await Bun.sleep(1100);
    writeFileSync(join(staging, "a"), "a");
    await archiveDir(staging, join(out, "2.tar.gz"), "tar.gz");
    expect(sha256(new Uint8Array(readFileSync(join(out, "1.tar.gz"))))).toBe(
      sha256(new Uint8Array(readFileSync(join(out, "2.tar.gz")))),
    );
  });

  test.skipIf((!Bun.which("zip") && !Bun.which("pwsh") && !Bun.which("powershell")) || !Bun.which("unzip"))(
    "zip archives",
    async () => {
      const staging = tmp();
      writeFileSync(join(staging, "app.exe"), "MZ");
      const archive = join(tmp(), "a.zip");
      await archiveDir(staging, archive, "zip");
      expect(Bun.spawnSync(["unzip", "-l", archive], { stdout: "pipe" }).stdout.toString()).toContain("app.exe");
    },
  );
});

describe("packageApp", () => {
  test.skipIf(process.platform === "win32")(
    "stages the executable with README, manifest and checksums, archives it and records the archive hash",
    async () => {
      const dir = fixtureCopy();
      // Build the UI once so the manifest exists, and reuse a stand-in executable: compiling is covered by compile.test.ts.
      const { buildApp } = await import("../src/build.ts");
      await buildApp({ dir });
      const stub = join(tmp(), "hello-m3");
      writeFileSync(stub, "#!/bin/sh\necho stub\n", { mode: 0o755 });
      const out = tmp();
      const report = await packageApp({ dir, executable: stub, out, deploy: true });
      expect(report.archive).toBe(join(out, `hello-m3-1.2.3-${process.platform}-${process.arch}.tar.gz`));
      expect(report.files).toEqual(
        expect.arrayContaining([
          "hello-m3",
          "README.txt",
          "SHA256SUMS",
          "m3-bun.manifest.json",
          "deploy/docker/Dockerfile",
          "deploy/systemd/hello-m3.service",
          "deploy/vscode/.vscode/tasks.json",
        ]),
      );
      expect(sha256(new Uint8Array(readFileSync(report.archive)))).toBe(report.sha256);
      expect(readFileSync(report.checksumFile, "utf8")).toBe(`${report.sha256}  ${report.archive.split("/").pop()}\n`);
      expect(statSync(report.archive).size).toBe(report.bytes);
      const extracted = tmp();
      Bun.spawnSync(["tar", "-xzf", report.archive, "-C", extracted]);
      expect(readFileSync(join(extracted, "SHA256SUMS"), "utf8")).toBe(
        `${sha256(new Uint8Array(readFileSync(stub)))}  hello-m3\n`,
      );
      expect(readFileSync(join(extracted, "README.txt"), "utf8")).toContain("--healthcheck");
      expect(statSync(join(extracted, "hello-m3")).mode & 0o111).not.toBe(0);
      expect(existsSync(join(out, ".staging"))).toBe(false);
    },
    60_000,
  );

  test("Windows targets default to zip and name the executable .exe", async () => {
    const dir = fixtureCopy();
    const { buildApp } = await import("../src/build.ts");
    await buildApp({ dir });
    const stub = join(tmp(), "x.exe");
    writeFileSync(stub, "MZ");
    const report = await packageApp({ dir, executable: stub, out: tmp(), target: "windows-x64" });
    expect(report.archive.endsWith("hello-m3-1.2.3-windows-x64.zip")).toBe(true);
    expect(report.files).toContain("hello-m3.exe");
    expect(readFileSync(report.checksumFile, "utf8")).toBe(`${report.sha256}  ${basename(report.archive)}\n`);
  }, 60_000);

  test("packageApp forwards a bytecode override to its compile report", async () => {
    const report = await packageApp({ dir: fixtureCopy(), out: tmp(), bytecode: false });
    expect(report.compile?.bytecode).toBe(false);
  }, 60_000);
});

describe("buildRootfs", () => {
  test("copies the executable to /app/server and every ldd library to its own absolute path", async () => {
    if (!Bun.which("ldd")) return;
    const dir = join(tmp(), "rootfs");
    const report = await buildRootfs(Bun.which("true")!, dir);
    expect(report.libraries.length).toBeGreaterThanOrEqual(2);
    expect(statSync(join(dir, "app", "server")).mode & 0o111).not.toBe(0);
    for (const lib of report.libraries) expect(existsSync(join(dir, lib))).toBe(true);
    expect(report.libraries.some(l => /ld-linux|ld-musl/.test(l))).toBe(true);
  });
  test("a file ldd cannot read is an error that says why", async () => {
    if (!Bun.which("ldd")) return;
    const script = join(tmp(), "script.sh");
    writeFileSync(script, "#!/bin/sh\n", { mode: 0o755 });
    await expect(buildRootfs(script, join(tmp(), "rootfs"))).rejects.toThrow(/ldd cannot read/);
  });
});
