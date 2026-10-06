// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

import {
  checkArtifact,
  fetchManifest,
  fetchSums,
  pickArtifact,
  toRelease,
  type Manifest,
} from "../src/lib/downloads.ts";

const BASE = "https://downloads.aphrody.com";
const SHA = "a".repeat(64);
const manifest: Manifest = {
  schemaVersion: 1,
  release: { id: "20261006T120000Z-abc" },
  baseUrl: BASE,
  artifacts: [
    {
      name: "aphrody",
      version: "1.0.0",
      platform: "linux-x86_64",
      url: `${BASE}/files/aphrody-1.0.0-linux.tar.gz`,
      sha256: SHA,
      size: 10,
    },
    {
      name: "aphrody",
      version: "1.0.0",
      platform: "windows-x86_64",
      url: `${BASE}/files/aphrody-1.0.0-x-x86_64-pc-windows-msvc.zip`,
      sha256: SHA,
      size: 20,
      file: "aphrody-1.0.0-x-x86_64-pc-windows-msvc.zip",
    },
    {
      name: "omar-kit",
      version: "0.2.0",
      platform: "windows-x86_64",
      url: `${BASE}/files/omar-kit-0.2.0.tar.gz`,
      sha256: SHA,
      size: 30,
      file: "omar-kit-0.2.0.tar.gz",
    },
    {
      name: "omar-kit",
      version: "0.2.0",
      platform: "windows-x86_64",
      url: `${BASE}/files/omar-kit-0.2.0.zip`,
      sha256: "b".repeat(64),
      size: 40,
      file: "omar-kit-0.2.0.zip",
    },
  ],
};

test("fetchManifest and fetchSums read the published files and refuse odd shapes", async () => {
  const ok = async (input: string) =>
    input.endsWith("latest.json")
      ? Response.json(manifest)
      : new Response(
          `${SHA}  aphrody-1.0.0-linux.tar.gz\n${SHA.toUpperCase()}  files/other.zip\nnot a line\n`,
        );
  expect((await fetchManifest(BASE, ok)).artifacts).toHaveLength(4);
  const sums = await fetchSums(BASE, ok);
  expect([...sums.keys()]).toEqual(["aphrody-1.0.0-linux.tar.gz", "other.zip"]);
  expect(sums.get("other.zip")).toBe(SHA);
  await expect(fetchManifest(BASE, async () => new Response("x", { status: 503 }))).rejects.toThrow(
    "503",
  );
  await expect(
    fetchManifest(BASE, async () => Response.json({ schemaVersion: 2 })),
  ).rejects.toThrow("format");
  await expect(fetchSums(BASE, async () => new Response("", { status: 404 }))).rejects.toThrow(
    "404",
  );
});

test("pickArtifact matches name, platform and extension", () => {
  expect(pickArtifact(manifest, "aphrody", "windows-x86_64", ".zip")?.version).toBe("1.0.0");
  expect(pickArtifact(manifest, "aphrody", "windows-x86_64", ".tar.gz")).toBeUndefined();
  expect(pickArtifact(manifest, "yolo")).toBeUndefined();
  expect(pickArtifact(manifest, "omar-kit", "windows-x86_64", ".tar.gz")?.file).toBe(
    "omar-kit-0.2.0.tar.gz",
  );
});

test("an artifact is trusted only on the site and when SHA256SUMS agrees with the catalogue", () => {
  const artifact = manifest.artifacts[1]!;
  const sums = new Map([[artifact.file!, SHA]]);
  expect(() => checkArtifact(BASE, artifact, sums)).not.toThrow();
  expect(() =>
    checkArtifact(BASE, { ...artifact, url: "https://evil.example/files/a.zip" }, sums),
  ).toThrow("hors du site");
  expect(() =>
    checkArtifact(BASE, { ...artifact, url: `${BASE}.evil.example/files/a.zip` }, sums),
  ).toThrow("hors du site");
  expect(() => checkArtifact(BASE, artifact, new Map())).toThrow("pas dans SHA256SUMS");
  expect(() => checkArtifact(BASE, artifact, new Map([[artifact.file!, "c".repeat(64)]]))).toThrow(
    "pas la même empreinte",
  );
});

test("toRelease exposes only the update archive in the shape creator-kit's engine installs", () => {
  const release = toRelease(manifest, "omar-kit", "windows-x64")!;
  expect(release).toMatchObject({ schemaVersion: 1, name: "omar-kit", version: "0.2.0" });
  expect(release.artifacts).toHaveLength(1);
  expect(release.artifacts[0]).toMatchObject({
    kind: "update",
    format: "tar.gz",
    platform: "windows-x64",
    file: "omar-kit-0.2.0.tar.gz",
    sha256: SHA,
    size: 30,
  });
  expect(toRelease(manifest, "nothing", "windows-x64")).toBeUndefined();
});
