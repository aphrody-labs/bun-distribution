// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

import {
  checkArtifact,
  fetchManifest,
  fetchSums,
  pickArtifact,
  toRelease,
  type Manifest,
} from "../../src/admin/lib/downloads.ts";

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

test("one-click selection stays on one immutable release while current changes", async () => {
  const { downloadsFor, verifiedScript } = await import("../../src/admin/lib/downloads.ts");
  const { testContext } = await import("./helpers.ts");
  const { createHash } = await import("node:crypto");
  const calls: string[] = [];
  let current = "r1";
  const script = "verified install script";
  const scriptHash = createHash("sha256").update(script).digest("hex");
  const { ctx } = testContext({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === `${BASE}/latest.json`)
        return Response.json({
          ...manifest,
          release: { id: current },
          assetChecksums: { "install.ps1": scriptHash },
        });
      if (url === `${BASE}/releases/r1/SHA256SUMS`)
        return new Response(`${SHA}  ${manifest.artifacts[1]!.file}\n`);
      if (url === `${BASE}/releases/r1/install.ps1`) return new Response(script);
      return new Response("mutable endpoint forbidden", { status: 404 });
    },
  });
  const first = await downloadsFor(ctx, BASE);
  current = "r2";
  const second = await downloadsFor(ctx, BASE);
  expect(second).toBe(first);
  expect(calls.filter((url) => url.endsWith("/latest.json"))).toHaveLength(1);
  expect(first.manifest.artifacts[1]!.url).toBe(
    `${BASE}/releases/r1/files/${manifest.artifacts[1]!.file}`,
  );
  expect(await verifiedScript(first, "install.ps1", ctx.fetchImpl)).toBe(script);
  expect(first.sums.has("install.ps1")).toBe(false);
  await expect(
    verifiedScript(first, "install.ps1", async () => new Response("tampered")),
  ).rejects.toThrow("SHA-256");
  await expect(verifiedScript(first, "../install.ps1", ctx.fetchImpl)).rejects.toThrow("refusé");
});

test("installer scripts require a valid assetChecksums entry before any download", async () => {
  const { verifiedScript } = await import("../../src/admin/lib/downloads.ts");
  const { createHash } = await import("node:crypto");
  const script = "published immutable installer";
  const sha = createHash("sha256").update(script).digest("hex");
  let requests = 0;
  const download = async () => {
    requests += 1;
    return new Response(script);
  };
  const missingHashes: Manifest["assetChecksums"][] = [
    undefined,
    {},
    { "install.ps1": "bad" },
    { "install.ps1": "a".repeat(63) },
  ];
  await Promise.all(
    missingHashes.map(async (assetChecksums) => {
      await expect(
        verifiedScript(
          {
            manifest: { ...manifest, assetChecksums },
            base: `${BASE}/releases/r1`,
            sums: new Map([["install.ps1", sha]]),
          },
          "install.ps1",
          download,
        ),
      ).rejects.toThrow("assetChecksums");
    }),
  );
  expect(requests).toBe(0);
  expect(
    await verifiedScript(
      {
        manifest: { ...manifest, assetChecksums: { "install.ps1": sha.toUpperCase() } },
        base: `${BASE}/releases/r1`,
        sums: new Map(),
      },
      "install.ps1",
      download,
    ),
  ).toBe(script);
  expect(requests).toBe(1);
});

test("unsafe release identifiers and artifact filenames never become download paths", async () => {
  const { downloadsFor } = await import("../../src/admin/lib/downloads.ts");
  const { testContext } = await import("./helpers.ts");
  await Promise.all(
    ["../escape", "r?x", "", "r/evil"].map(async (id) => {
      await expect(
        fetchManifest(BASE, async () => Response.json({ ...manifest, release: { id } })),
      ).rejects.toThrow("identifiant");
    }),
  );
  const { ctx } = testContext({
    fetchImpl: async () =>
      Response.json({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[1], file: "../evil.exe" }],
      }),
  });
  await expect(downloadsFor(ctx, BASE)).rejects.toThrow("refusé");
});
