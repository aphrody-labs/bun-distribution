// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  archiveName,
  buildManifest,
  buildSums,
  loadConfig,
  planAssetsSnapshot,
  publishAssetsSnapshot,
  run,
  releaseId,
  scanBytes,
  scanName,
  scanTree,
  sha256Bytes,
  stagedFiles,
} from "./publish-downloads";

const cfg = loadConfig();
const root = resolve(import.meta.dir, "../..");

describe("publish-downloads", () => {
  test("release id and archive names are stable and sortable", () => {
    const id = releaseId(
      "8f891f0d4f19e12ee77eb43d98cb68fa7229f385",
      new Date("2026-10-06T01:02:03.456Z"),
    );
    expect(id).toBe("20261006T010203Z-8f891f0d4f19");
    expect(
      archiveName("aphrody", "1.0.0", "8f891f0d4f19e12", "x86_64-unknown-linux-gnu", "tar.gz"),
    ).toBe("aphrody-1.0.0-8f891f0d4-x86_64-unknown-linux-gnu.tar.gz");
  });

  test("SHA256SUMS and latest.json carry name, version, platform, url, sha256 and size", () => {
    const files = [
      {
        component: "yolo",
        version: "0.1.0",
        platform: "linux-x86_64",
        target: "t",
        kind: "bun-compile",
        file: "yolo.tar.gz",
        sha256: sha256Bytes(new Uint8Array([1])),
        size: 1,
      },
      {
        component: "aphrody",
        version: "1.0.0",
        platform: "linux-x86_64",
        target: "t",
        kind: "factory-binary",
        file: "aphrody.tar.gz",
        sha256: "b".repeat(64),
        size: 2,
      },
    ];
    expect(buildSums(files)).toBe(
      `${"b".repeat(64)}  aphrody.tar.gz\n${files[0]!.sha256}  yolo.tar.gz\n`,
    );
    const manifest = buildManifest({
      baseUrl: "https://x.test",
      id: "r",
      commit: "c",
      files,
      notes: [],
      now: new Date(0),
    }) as {
      artifacts: Record<string, unknown>[];
    };
    expect(manifest.artifacts.map((a) => a.name)).toEqual(["aphrody", "yolo"]);
    expect(manifest.artifacts[0]).toMatchObject({
      version: "1.0.0",
      platform: "linux-x86_64",
      url: "https://x.test/files/aphrody.tar.gz",
      sha256: "b".repeat(64),
      size: 2,
    });
  });

  test("the secret scan rejects denied names and token shapes, and accepts plain files", () => {
    expect(scanName("config/.env.local", cfg.secrets.deniedNames)).toHaveLength(1);
    expect(scanName("keys/server.pem", cfg.secrets.deniedNames)).toHaveLength(1);
    expect(scanName("models/a.gguf", cfg.secrets.deniedNames)).toHaveLength(1);
    expect(scanName("skills/a/SKILL.md", cfg.secrets.deniedNames)).toHaveLength(0);
    const token = `ghp_${"a".repeat(36)}`;
    expect(
      scanBytes("f", new TextEncoder().encode(`x ${token} y`), cfg.secrets.contentPatterns),
    ).toHaveLength(1);
    expect(
      scanBytes(
        "f",
        new TextEncoder().encode(`-----BEGIN OPENSSH PRIVATE KEY-----\n${"A".repeat(70)}`),
        cfg.secrets.contentPatterns,
      ),
    ).toHaveLength(1);
    expect(
      scanBytes(
        "f",
        new TextEncoder().encode("ghp_example and sk-... placeholders"),
        cfg.secrets.contentPatterns,
      ),
    ).toHaveLength(0);
    const dir = mkdtempSync(join(tmpdir(), "scan-"));
    try {
      writeFileSync(join(dir, "README.md"), "hello");
      expect(scanTree(dir, cfg.secrets)).toHaveLength(0);
      writeFileSync(join(dir, "cookies.json"), "{}");
      expect(scanTree(dir, cfg.secrets)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the configuration is consistent with the catalog port and the declared assets", () => {
    expect(cfg.host.port).toBe(8797);
    expect(cfg.artifacts.map((a) => a.id)).toEqual([
      "aphrody",
      "yolo",
      "aphrody-setup",
      "omar-kit",
      "aphrody-app",
      "plugin-aphrody",
      "plugin-yolo",
      "plugin-shenron",
    ]);
    for (const release of cfg.github.releases)
      expect(release.repository.startsWith("aphrody-labs/")).toBe(true);
    expect(Object.keys(cfg.assets)).toEqual([
      "install.sh",
      "install.ps1",
      "install-yolo.sh",
      "pet.webp",
      "icon.svg",
      "install-yolo.ps1",
    ]);
    for (const source of Object.values(cfg.assets))
      expect(existsSync(join(root, source))).toBe(true);
    // The site's « Download Aphrody » button takes the first `desktop` artifact: the one-click installer.
    expect(cfg.artifacts.filter((a) => a.kind === "desktop").map((a) => a.id)).toEqual([
      "aphrody-setup",
    ]);
    for (const a of cfg.artifacts.filter((x) => x.stage)) {
      expect(existsSync(join(root, a.stage!.script))).toBe(true);
      expect(a.versionFrom?.packageJson).toBeDefined();
    }
  });

  test("staged entries must name their component and carry a file name and a hash", () => {
    const setup = cfg.artifacts.find((a) => a.id === "aphrody-setup")!;
    const windows = setup.platforms![0]!;
    const entry = {
      name: "aphrody-setup",
      version: "0.1.0",
      platform: "windows-x86_64",
      target: "x86_64-pc-windows-msvc",
      kind: "desktop",
      file: "aphrody-setup-0.1.0-abcdef123-x86_64-pc-windows-msvc.exe",
      size: 1,
      sha256: "a".repeat(64),
    };
    expect(stagedFiles(setup, windows, [entry, { ...entry, platform: "linux-x86_64" }])).toEqual([
      entry,
    ]);
    expect(() => stagedFiles(setup, windows, [{ ...entry, name: "omar-kit" }])).toThrow("expected");
    expect(() => stagedFiles(setup, windows, [{ ...entry, file: "../x.exe" }])).toThrow("invalid");
    expect(() => stagedFiles(setup, windows, [])).toThrow("nothing");
  });
});

function snapshotFixture() {
  const work = mkdtempSync(join(tmpdir(), "assets-snapshot-"));
  const host = join(work, "host");
  const old = join(host, "releases", "old");
  mkdirSync(join(old, "files"), { recursive: true });
  const payload = new TextEncoder().encode("original binary bytes");
  const artifact = {
    name: "aphrody",
    version: "1",
    platform: "linux-x86_64",
    target: "t",
    kind: "factory-binary",
    file: "aphrody.tar.gz",
    sha256: sha256Bytes(payload),
    size: payload.length,
    url: "https://example.test/files/aphrody.tar.gz",
    provides: ["aphrody", "aphrody-mcp"],
    provenance: { builder: "factory", revision: "original" },
  };
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    release: { id: "old", commit: "original-build", provenance: "retained" },
    baseUrl: "https://example.test",
    artifacts: [artifact],
    notes: ["original build note"],
  };
  writeFileSync(join(old, "files", artifact.file), payload);
  writeFileSync(join(old, "files", `${artifact.file}.sha256`), buildSums([artifact]));
  writeFileSync(join(old, "latest.json"), JSON.stringify(manifest));
  writeFileSync(join(old, "SHA256SUMS"), buildSums([artifact]));
  writeFileSync(join(old, "install.sh"), "old installer");
  symlinkSync("releases/old", join(host, "current"));
  writeFileSync(join(work, "installer.sh"), "new installer");
  mkdirSync(join(work, "dist/downloads"), { recursive: true });
  writeFileSync(join(work, "dist/downloads/last-release.json"), "existing GitHub stage pointer");
  const config = {
    ...cfg,
    host: { ...cfg.host, root: host, keepReleases: 5 },
    assets: { "install.sh": "installer.sh" },
  };
  const uploads: string[] = [];
  const io = {
    remote: async (_cfg: typeof cfg, command: string) =>
      (await run(["sh", "-c", command], { cwd: work })).stdout,
    put: async (_cfg: typeof cfg, local: string, dest: string) => {
      uploads.push(dest);
      copyFileSync(local, dest);
    },
  };
  return { work, host, old, artifact, manifest, config, uploads, io };
}

describe("immutable installer snapshots", () => {
  test("reuses artifact bytes without upload and keeps prior release metadata and installers unchanged", async () => {
    const f = snapshotFixture();
    try {
      const previous = readFileSync(join(f.old, "latest.json"), "utf8");
      const oldInstallerInode = statSync(join(f.old, "install.sh")).ino;
      const published = await publishAssetsSnapshot(f.config, {
        id: "new",
        assetCommit: "installer-source",
        sourceRoot: f.work,
        io: f.io,
      });
      const next = join(f.host, "releases", "new");
      expect(realpathSync(join(f.host, "current"))).toBe(next);
      expect(readFileSync(join(f.old, "latest.json"), "utf8")).toBe(previous);
      expect(readFileSync(join(f.old, "install.sh"), "utf8")).toBe("old installer");
      expect(statSync(join(next, "install.sh")).ino).not.toBe(oldInstallerInode);
      expect(readFileSync(join(next, "install.sh"), "utf8")).toBe("new installer");
      expect(statSync(join(next, "files", f.artifact.file)).ino).toBe(
        statSync(join(f.old, "files", f.artifact.file)).ino,
      );
      expect(f.uploads).not.toContain(join(next, "files", f.artifact.file));
      expect(published.release).toMatchObject({
        id: "new",
        commit: "original-build",
        provenance: "retained",
        assetsFrom: "old",
        assetsCommit: "installer-source",
      });
      expect(published.artifacts[0]).toMatchObject({
        ...f.artifact,
        url: "https://example.test/releases/new/files/aphrody.tar.gz",
      });
      expect(published.notes).toEqual(f.manifest.notes);
      expect(readFileSync(join(f.work, "dist/downloads/last-release.json"), "utf8")).toBe(
        "existing GitHub stage pointer",
      );
      expect(JSON.parse(readFileSync(join(next, "latest.json"), "utf8"))).toEqual(published);
      expect(readFileSync(join(next, "SHA256SUMS"), "utf8")).toBe(
        readFileSync(join(f.old, "SHA256SUMS"), "utf8"),
      );
    } finally {
      rmSync(f.work, { recursive: true, force: true });
    }
  });

  test("rejects mismatched source checksums, unsafe payloads and duplicate release selection", () => {
    const f = snapshotFixture();
    try {
      const sums = buildSums([f.artifact]);
      expect(() =>
        planAssetsSnapshot(
          { ...f.manifest, notes: [`ghp_${"a".repeat(36)}`] },
          sums,
          "new",
          "source",
          cfg.secrets,
        ),
      ).toThrow("secret scan");
      expect(() => planAssetsSnapshot(f.manifest, sums, "old", "source", cfg.secrets)).toThrow(
        "invalid",
      );
      expect(() =>
        planAssetsSnapshot(
          f.manifest,
          sums.replace(f.artifact.sha256, "a".repeat(64)),
          "new",
          "source",
          cfg.secrets,
        ),
      ).toThrow("unchecked");
      expect(() =>
        planAssetsSnapshot(
          { ...f.manifest, artifacts: [{ ...f.artifact, file: "../escape" }] },
          sums,
          "new",
          "source",
          cfg.secrets,
        ),
      ).toThrow("unchecked");
      expect(() =>
        planAssetsSnapshot(
          f.manifest,
          sums + `${"b".repeat(64)}  extra.tar.gz\n`,
          "new",
          "source",
          cfg.secrets,
        ),
      ).toThrow("unlisted");
      expect(() =>
        planAssetsSnapshot(f.manifest, sums + sums, "new", "source", cfg.secrets),
      ).toThrow("duplicate");
    } finally {
      rmSync(f.work, { recursive: true, force: true });
    }
  });

  test("failed upload leaves current and all previous release bytes unchanged", async () => {
    const f = snapshotFixture();
    try {
      const before = readFileSync(join(f.old, "latest.json"), "utf8");
      const io = {
        ...f.io,
        put: async (config: typeof cfg, local: string, dest: string) => {
          if (dest.endsWith("install.sh")) throw new Error("simulated upload failure");
          await f.io.put(config, local, dest);
        },
      };
      await expect(
        publishAssetsSnapshot(f.config, {
          id: "new",
          assetCommit: "source",
          sourceRoot: f.work,
          io,
        }),
      ).rejects.toThrow("simulated");
      expect(realpathSync(join(f.host, "current"))).toBe(f.old);
      expect(readFileSync(join(f.old, "latest.json"), "utf8")).toBe(before);
      expect(readFileSync(join(f.old, "install.sh"), "utf8")).toBe("old installer");
      expect(existsSync(join(f.host, "releases", "new"))).toBe(false);
    } finally {
      rmSync(f.work, { recursive: true, force: true });
    }
  });

  test("secret sources and corrupted inherited payloads never advance current", async () => {
    await Promise.all(
      ["secret", "payload"].map(async (failure) => {
        const f = snapshotFixture();
        try {
          if (failure === "secret")
            writeFileSync(join(f.work, "installer.sh"), `ghp_${"a".repeat(36)}`);
          else writeFileSync(join(f.old, "files", f.artifact.file), "corrupted payload");
          await expect(
            publishAssetsSnapshot(f.config, {
              id: "new",
              assetCommit: "source",
              sourceRoot: f.work,
              io: f.io,
            }),
          ).rejects.toThrow();
          expect(realpathSync(join(f.host, "current"))).toBe(f.old);
          expect(readFileSync(join(f.old, "install.sh"), "utf8")).toBe("old installer");
          expect(existsSync(join(f.host, "releases", "new"))).toBe(false);
        } finally {
          rmSync(f.work, { recursive: true, force: true });
        }
      }),
    );
  });

  test("an intervening publication prevents selecting a snapshot of stale artifacts", async () => {
    const f = snapshotFixture();
    try {
      const newer = join(f.host, "releases", "newer");
      mkdirSync(newer);
      const io = {
        ...f.io,
        put: async (config: typeof cfg, local: string, dest: string) => {
          await f.io.put(config, local, dest);
          if (dest.endsWith("install.sh")) {
            rmSync(join(f.host, "current"));
            symlinkSync("releases/newer", join(f.host, "current"));
          }
        },
      };
      await expect(
        publishAssetsSnapshot(f.config, {
          id: "new",
          assetCommit: "source",
          sourceRoot: f.work,
          io,
        }),
      ).rejects.toThrow();
      expect(realpathSync(join(f.host, "current"))).toBe(newer);
      expect(existsSync(join(f.host, "releases", "new"))).toBe(false);
      expect(readFileSync(join(f.old, "install.sh"), "utf8")).toBe("old installer");
    } finally {
      rmSync(f.work, { recursive: true, force: true });
    }
  });
});
