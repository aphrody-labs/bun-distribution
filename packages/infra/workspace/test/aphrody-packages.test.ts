// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTar } from "../src/canonical-tar.ts";
import {
  aphrodyClosure,
  archiveName,
  exportTargets,
  portableArchive,
  staleArchives,
  type AphrodyPackagesManifest,
} from "../src/aphrody-packages.ts";

const root = join(import.meta.dir, "../../../..");

test("export targets cover every condition, main and module, but not patterns", () => {
  expect(
    exportTargets({
      version: "1.0.0",
      exports: {
        ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
        "./*": "./src/*.ts",
      },
      main: "./main.js",
    }).toSorted(),
  ).toEqual(["dist/index.d.mts", "dist/index.mjs", "main.js"]);
});

test("the RG closure includes transitive workspace packages and reports the Yolo SDK as external", async () => {
  const { members, external } = await aphrodyClosure(root, ["@aphrody/agent-browser"]);
  expect(members.map((member) => member.name)).toContain("@aphrody/agent-browser");
  expect(external).toContain("@aphrody/runtime-sdk");
});

test("archive names are content addressed and pins detect missing or changed archives", async () => {
  const bytes = new TextEncoder().encode("archive");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(archiveName("@aphrody/paths", sha256)).toBe(`aphrody-paths-${sha256.slice(0, 16)}.tgz`);
  const directory = await mkdtemp(join(tmpdir(), "aphrody-packages-test-"));
  try {
    const pin: AphrodyPackagesManifest = {
      schemaVersion: 1,
      producer: "aphrody",
      revision: "0".repeat(40),
      dirty: false,
      packages: [
        { name: "@aphrody/paths", version: "0.1.0", archive: "a.tgz", sha256 },
        { name: "@aphrody/x", version: "1.0.0", archive: "b.tgz", sha256 },
      ],
      external: [],
    };
    await writeFile(join(directory, "a.tgz"), bytes);
    await writeFile(join(directory, "b.tgz"), "changed");
    expect(await staleArchives(pin, directory)).toEqual(["@aphrody/x"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const read = (archive: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(readTar(Bun.gunzipSync(archive))[0]!.data));

test("portable archives replace producer-relative file: specs with the pinned version", () => {
  const encoder = new TextEncoder();
  const manifest = (dependencies: Record<string, string>) => {
    const data = encoder.encode(JSON.stringify({ name: "@aphrody/a", dependencies }));
    return [
      { name: "package/package.json", type: "file" as const, mode: 0o644, size: data.length, data },
    ];
  };
  const pinned = new Map([["@aphrody/runtime-sdk", "0.1.0"]]);
  expect(
    read(
      portableArchive(
        manifest({ "@aphrody/runtime-sdk": "file:.cache/sdk.tgz", zod: "^4" }),
        pinned,
        "@aphrody/a",
      ),
    ).dependencies,
  ).toEqual({ "@aphrody/runtime-sdk": "0.1.0", zod: "^4" });
  expect(() => portableArchive(manifest({ other: "file:x.tgz" }), pinned, "@aphrody/a")).toThrow(
    "unpinned",
  );
});
