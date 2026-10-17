// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { archiveDir, bunArchiveSupported, buildRootfs, packageApp, parseLdd } from "../src/package.ts";
import { sha256 } from "../src/util.ts";
import { cleanup, fixtureCopy, tmp } from "./helpers.ts";

afterAll(cleanup);

const archiveSupported = await bunArchiveSupported();
const archiver = async () => ((await bunArchiveSupported()) ? "bun-archive" : "m3-bun");

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
  test("tar.gz keeps the executable bit and lists every staged file", async () => {
    const staging = tmp();
    writeFileSync(join(staging, "app"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(staging, "README.txt"), "hi");
    mkdirSync(join(staging, "deploy"));
    writeFileSync(join(staging, "deploy", "x.conf"), "x");
    const archive = join(tmp(), "out", "a.tar.gz");
    expect(await archiveDir(staging, archive, "tar.gz")).toBe(await archiver());
    const listing = Bun.spawnSync(["tar", "-tvzf", basename(archive)], {
      windowsHide: true,
      cwd: dirname(archive),
      stdout: "pipe",
    })
      .stdout.toString()
      .replaceAll("\r\n", "\n");
    expect(listing).toMatch(/-rwxr-xr-x .* (\.\/)?app\n/);
    expect(listing).toMatch(/ (\.\/)?deploy\/x\.conf\n/);
    expect(listing).toMatch(/ (\.\/)?README\.txt\n/);
  });

  test("the tarball is byte-reproducible", async () => {
    const staging = tmp();
    writeFileSync(join(staging, "a"), "a");
    writeFileSync(join(staging, "b"), "b");
    const out = tmp();
    await archiveDir(staging, join(out, "1.tar.gz"), "tar.gz");
    utimesSync(join(staging, "a"), new Date(2001, 0, 1), new Date(2001, 0, 1));
    await archiveDir(staging, join(out, "2.tar.gz"), "tar.gz");
    expect(sha256(new Uint8Array(readFileSync(join(out, "1.tar.gz"))))).toBe(
      sha256(new Uint8Array(readFileSync(join(out, "2.tar.gz")))),
    );
  });

  test.skipIf(!Bun.which("unzip"))("zip archives", async () => {
    const staging = tmp();
    writeFileSync(join(staging, "app.exe"), "MZ");
    mkdirSync(join(staging, "deploy"));
    writeFileSync(join(staging, "deploy", "x.conf"), Buffer.alloc(4096, "x").toString());
    const archive = join(tmp(), "a.zip");
    expect(await archiveDir(staging, archive, "zip")).toBe(await archiver());
    const check = Bun.spawnSync(["unzip", "-t", basename(archive)], {
      windowsHide: true,
      cwd: dirname(archive),
      stdout: "pipe",
    });
    expect(check.stdout.toString()).toContain("app.exe");
    expect(check.stdout.toString()).toContain("deploy/x.conf");
    expect(check.exitCode).toBe(0);
  });
});

describe("bunArchiveSupported", () => {
  test.skipIf(!archiveSupported)(
    "archiveDir writes with Bun.Archive: files only, contents intact, both formats",
    async () => {
      const staging = tmp();
      writeFileSync(join(staging, "app"), "#!/bin/sh\n", { mode: 0o755 });
      mkdirSync(join(staging, "deploy"));
      writeFileSync(join(staging, "deploy", "x.conf"), "x");
      const archives = await Promise.all(
        (["tar.gz", "zip"] as const).map(async format => {
          const archive = join(tmp(), `a.${format}`);
          return {
            writer: await archiveDir(staging, archive, format),
            files: await new Bun.Archive(await Bun.file(archive).bytes()).files(),
          };
        }),
      );
      for (const { writer, files } of archives) {
        expect(writer).toBe("bun-archive");
        expect([...files.keys()].toSorted()).toEqual(["app", "deploy/x.conf"]);
        expect(files.get("app")!.size).toBe(10);
      }
    },
  );
});

describe("packageApp", () => {
  test("stages the executable with README, manifest and checksums, archives it and records the archive hash", async () => {
    const dir = fixtureCopy();
    // Build the UI once so the manifest exists, and reuse a stand-in executable: compiling is covered by compile.test.ts.
    const { buildApp } = await import("../src/build.ts");
    await buildApp({ dir });
    const stub = join(tmp(), "hello-m3");
    writeFileSync(stub, "#!/bin/sh\necho stub\n", { mode: 0o755 });
    const out = tmp();
    const report = await packageApp({
      dir,
      executable: stub,
      out,
      deploy: true,
    });
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
    expect(report.archiver).toBe(await archiver());
    expect(sha256(new Uint8Array(readFileSync(report.archive)))).toBe(report.sha256);
    expect(readFileSync(report.checksumFile, "utf8")).toBe(`${report.sha256}  ${basename(report.archive)}\n`);
    expect(statSync(report.archive).size).toBe(report.bytes);
    const extracted = tmp();
    Bun.spawnSync(["tar", "-xzf", relative(extracted, report.archive)], {
      windowsHide: true,
      cwd: extracted,
    });
    expect(readFileSync(join(extracted, "SHA256SUMS"), "utf8")).toBe(
      `${sha256(new Uint8Array(readFileSync(stub)))}  hello-m3\n`,
    );
    expect(readFileSync(join(extracted, "README.txt"), "utf8")).toContain("--healthcheck");
    if (process.platform !== "win32") expect(statSync(join(extracted, "hello-m3")).mode & 0o111).not.toBe(0);
    const listing = Bun.spawnSync(["tar", "-tvzf", basename(report.archive)], {
      windowsHide: true,
      cwd: dirname(report.archive),
      stdout: "pipe",
    }).stdout.toString();
    expect(listing).toMatch(/-rwxr-xr-x .* (\.\/)?hello-m3\n/);
    expect(existsSync(join(out, ".staging"))).toBe(false);
  }, 60_000);

  test("Windows targets default to zip and name the executable .exe", async () => {
    const dir = fixtureCopy();
    const { buildApp } = await import("../src/build.ts");
    await buildApp({ dir });
    const stub = join(tmp(), "x.exe");
    writeFileSync(stub, "MZ");
    const report = await packageApp({
      dir,
      executable: stub,
      out: tmp(),
      target: "windows-x64",
    });
    expect(report.archive.endsWith("hello-m3-1.2.3-windows-x64.zip")).toBe(true);
    expect(report.files).toContain("hello-m3.exe");
  }, 60_000);
});

describe("buildRootfs", () => {
  test.skipIf(process.platform !== "linux")(
    "copies the executable to /app/server and every ldd library to its own absolute path",
    async () => {
      const dir = join(tmp(), "rootfs");
      const report = await buildRootfs(Bun.which("true")!, dir);
      expect(report.libraries.length).toBeGreaterThanOrEqual(2);
      expect(statSync(join(dir, "app", "server")).mode & 0o111).not.toBe(0);
      for (const lib of report.libraries) expect(existsSync(join(dir, lib))).toBe(true);
      expect(report.libraries.some(l => /ld-linux|ld-musl/.test(l))).toBe(true);
    },
  );
  test.skipIf(process.platform !== "linux")("a file ldd cannot read is an error that says why", async () => {
    const script = join(tmp(), "script.sh");
    writeFileSync(script, "#!/bin/sh\n", { mode: 0o755 });
    await expect(buildRootfs(script, join(tmp(), "rootfs"))).rejects.toThrow(/ldd cannot read/);
  });
});
