// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveName,
  buildManifest,
  buildSums,
  loadConfig,
  releaseId,
  scanBytes,
  scanName,
  scanTree,
  sha256Bytes,
} from "./publish-downloads";

const cfg = loadConfig();

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
      "plugin-aphrody",
      "plugin-yolo",
      "plugin-shenron",
    ]);
    for (const release of cfg.github.releases)
      expect(release.repository.startsWith("aphrody-labs/")).toBe(true);
    expect(Object.keys(cfg.assets)).toEqual(["install.sh", "install.ps1", "install-yolo.sh"]);
  });
});
