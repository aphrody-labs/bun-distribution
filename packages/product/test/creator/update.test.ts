import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { compareVersions, isCompiled, updateNow, type Release } from "../../src/shared/update.ts";

let server: ReturnType<typeof Bun.serve>;
let base = "";
let archive: Uint8Array;
let sha = "";

beforeAll(async () => {
  const src = await mkdtemp(join(tmpdir(), "pack-"));
  await writeFile(join(src, "creator-kit"), "NEW-BINARY");
  await mkdir(join(src, "web"));
  await writeFile(join(src, "web", "page.html"), "new-page");
  const tar = join(src, "..", `pack-${Date.now()}.tar.gz`);
  Bun.spawnSync(["tar", "-czf", basename(tar), "-C", basename(src), "creator-kit", "web"], {
    windowsHide: true,
    cwd: dirname(src),
  });
  archive = new Uint8Array(await Bun.file(tar).arrayBuffer());
  sha = createHash("sha256").update(archive).digest("hex");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/latest.json") {
        const release: Release = {
          schemaVersion: 1,
          name: "creator-kit",
          version: "0.3.0",
          releasedAt: "2026-10-06T00:00:00Z",
          artifacts: [
            {
              id: "u",
              kind: "update",
              format: "tar.gz",
              platform: "linux-x64",
              file: "u.tar.gz",
              url: `${base}/files/u.tar.gz`,
              sha256: sha,
              size: archive.byteLength,
            },
          ],
        };
        return Response.json(release);
      }
      if (url.pathname === "/files/u.tar.gz") return new Response(archive as unknown as BodyInit);
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

test("compareVersions orders numerically", () => {
  expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.2.0", "0.2.1")).toBeLessThan(0);
});

test("isCompiled is false for bun and true for a standalone binary", () => {
  expect(isCompiled("/usr/bin/bun")).toBe(false);
  expect(isCompiled("C:\\Tools\\bun.exe")).toBe(false);
  expect(isCompiled("C:\\Tools\\creator-kit.exe")).toBe(true);
});

test("updateNow swaps the binary, keeps the old one aside and replaces other entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "install-"));
  await writeFile(join(dir, "creator-kit"), "OLD-BINARY");
  await mkdir(join(dir, "web"));
  await writeFile(join(dir, "web", "old.html"), "old");
  const statePath = join(dir, "state", "update.json");
  const result = await updateNow({
    baseUrl: base,
    execPath: join(dir, "creator-kit"),
    platform: "linux-x64",
    version: "0.2.0",
    statePath,
  });
  expect(result).toEqual({ status: "updated", latest: "0.3.0" });
  expect(await readFile(join(dir, "creator-kit"), "utf8")).toBe("NEW-BINARY");
  expect(await readFile(join(dir, "creator-kit.old"), "utf8")).toBe("OLD-BINARY");
  expect(await readdir(join(dir, "web"))).toEqual(["page.html"]);
  expect((await readdir(dir)).filter(n => n.startsWith(".update"))).toEqual([]);
  expect(JSON.parse(await readFile(statePath, "utf8")).latest).toBe("0.3.0");
});

test("updateNow reports up-to-date, check-only and bad checksums without touching files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "install-"));
  await writeFile(join(dir, "creator-kit"), "OLD-BINARY");
  const statePath = join(dir, "state.json");
  expect(
    (
      await updateNow({
        baseUrl: base,
        execPath: join(dir, "creator-kit"),
        version: "0.3.0",
        statePath,
      })
    ).status,
  ).toBe("up-to-date");
  expect(
    (
      await updateNow({
        baseUrl: base,
        execPath: join(dir, "creator-kit"),
        version: "0.2.0",
        checkOnly: true,
        statePath,
      })
    ).status,
  ).toBe("available");
  expect(
    (
      await updateNow({
        baseUrl: base,
        execPath: "/usr/bin/bun",
        version: "0.2.0",
        platform: "linux-x64",
        statePath,
      })
    ).status,
  ).toBe("skipped");
  const tampered: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/latest.json") {
        return Response.json({
          schemaVersion: 1,
          name: "creator-kit",
          version: "0.3.0",
          releasedAt: "",
          artifacts: [
            {
              id: "u",
              kind: "update",
              format: "tar.gz",
              platform: "linux-x64",
              file: "u.tar.gz",
              url: `http://127.0.0.1:${tampered.port}/f`,
              sha256: "0".repeat(64),
              size: 3,
            },
          ],
        });
      }
      return new Response("abc");
    },
  });
  await expect(
    updateNow({
      baseUrl: `http://127.0.0.1:${tampered.port}`,
      execPath: join(dir, "creator-kit"),
      platform: "linux-x64",
      version: "0.2.0",
      statePath,
    }),
  ).rejects.toThrow("SHA-256");
  tampered.stop(true);
  expect(await readFile(join(dir, "creator-kit"), "utf8")).toBe("OLD-BINARY");
});

test("archive preflight rejects unsafe paths, links, corrupt headers and truncation before writing", async () => {
  const { extractTarGz } = await import("../../src/shared/update.ts");
  const { existsSync } = await import("node:fs");
  const raw = Bun.gunzipSync(new Uint8Array(archive));
  const cases: Uint8Array[] = [];
  for (const name of ["../escape", "C:/escape", "a\\escape", "NUL.exe", "file:stream"]) {
    const candidate = new Uint8Array(raw);
    candidate.fill(0, 0, 100);
    candidate.set(new TextEncoder().encode(name));
    candidate.fill(32, 148, 156);
    const sum = candidate.subarray(0, 512).reduce((a, b) => a + b, 0);
    candidate.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    cases.push(candidate);
  }
  const link = new Uint8Array(raw);
  link[156] = 50;
  link.fill(32, 148, 156);
  link.set(
    new TextEncoder().encode(
      `${link
        .subarray(0, 512)
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0")}\0 `,
    ),
    148,
  );
  cases.push(link, raw.subarray(0, 520));
  const dir = await mkdtemp(join(tmpdir(), "unsafe-pack-"));
  for (const [index, candidate] of cases.entries()) {
    const tar = join(dir, `${index}.tar.gz`);
    // oxlint-disable-next-line no-await-in-loop -- cases run one after another in a shared temp directory, each extraction asserted before the next
    await writeFile(tar, Bun.gzipSync(new Uint8Array(candidate)));
    const dest = join(dir, `dest-${index}`);
    // oxlint-disable-next-line no-await-in-loop -- cases run one after another in a shared temp directory, each extraction asserted before the next
    await expect(extractTarGz(tar, dest)).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
  }
});

test("failed activation restores all previous files after an earlier promotion", async () => {
  const { applyPack } = await import("../../src/shared/update.ts");
  const { rename } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "rollback-pack-"));
  await writeFile(join(dir, "creator-kit"), "OLD-BINARY");
  await mkdir(join(dir, "web"));
  await writeFile(join(dir, "web", "old.html"), "old-page");
  const tar = join(dir, "pack.tar.gz");
  await writeFile(tar, archive);
  await expect(
    applyPack(tar, dir, "creator-kit", {
      rename: async (from, to) => {
        if (String(from).includes(".update-") && String(to) === join(dir, "web"))
          throw new Error("injected activation failure");
        return rename(from, to);
      },
    }),
  ).rejects.toThrow("activation failure");
  expect(await readFile(join(dir, "creator-kit"), "utf8")).toBe("OLD-BINARY");
  expect(await readFile(join(dir, "web", "old.html"), "utf8")).toBe("old-page");
});

test("a pre-existing symlink destination cannot redirect archive extraction", async () => {
  const { extractTarGz } = await import("../../src/shared/update.ts");
  const { symlink } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "symlink-pack-"));
  const outside = join(dir, "outside");
  await mkdir(outside);
  await symlink(outside, join(dir, "dest"), "dir");
  const tar = join(dir, "pack.tar.gz");
  await writeFile(tar, archive);
  await expect(extractTarGz(tar, join(dir, "dest"))).rejects.toThrow("lien refusé");
  expect(await readdir(outside)).toEqual([]);
});
