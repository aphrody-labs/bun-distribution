// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTar } from "../src/canonical-tar.ts";
import {
  aphrodyClosure,
  aphrodyPackageDirectories,
  archiveName,
  assertPublicEntries,
  auditArchive,
  embedExternalImports,
  exportTargets,
  portableArchive,
  publishOrder,
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

test("the RG closure packs the runtime SDK as a workspace member", async () => {
  const { members, external } = await aphrodyClosure(root, ["@aphrody/agent-browser"]);
  expect(members.map((member) => member.name)).toEqual([
    "@aphrody/agent-browser",
    "@aphrody/runtime-sdk",
  ]);
  expect(external).toEqual([]);
});

test("members follow the root workspaces globs beyond packages/*/*", async () => {
  const directories = await aphrodyPackageDirectories(root);
  expect(directories.get("@aphrody/canvas")).toBe(join(root, "m3/packages/canvas"));
  expect(directories.get("@aphrody/api")).toBe(join(root, "crates/tauri/aphrody-tauri-api"));
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

const sourceEntry = (text: string) => {
  const data = new TextEncoder().encode(text);
  return {
    name: "package/src/config/catalog.ts",
    type: "file" as const,
    mode: 0o644,
    size: data.length,
    data,
  };
};

test("JSON imported from outside the package is embedded and its specifier rewritten", async () => {
  const repository = await mkdtemp(join(tmpdir(), "aphrody-packages-external-"));
  try {
    const packageDirectory = join(repository, "packages/web/x");
    await mkdir(join(repository, "crates/web/x/data"), { recursive: true });
    await writeFile(join(repository, "crates/web/x/data/catalog.json"), '{"operations":{}}');
    const entries = await embedExternalImports(
      [
        sourceEntry(
          'import data from "../../../../../crates/web/x/data/catalog.json";\nimport x from "./x.ts";\n',
        ),
      ],
      packageDirectory,
      repository,
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      "package/src/config/catalog.ts",
      "package/.aphrody-external/crates/web/x/data/catalog.json",
    ]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(
      'import data from "../../.aphrody-external/crates/web/x/data/catalog.json";\nimport x from "./x.ts";\n',
    );
    await expect(
      embedExternalImports(
        [sourceEntry('import y from "../../../other/src/y.ts";')],
        packageDirectory,
        repository,
      ),
    ).rejects.toThrow("outside its package");
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("private or traversing entries are refused", () => {
  const entry = (name: string) => ({
    name,
    type: "file" as const,
    mode: 0o644,
    size: 0,
    data: new Uint8Array(),
  });
  expect(() => assertPublicEntries([entry("package/src/index.ts")], "@aphrody/a")).not.toThrow();
  for (const name of [
    "package/.env",
    "package/.env.local",
    "package/.npmrc",
    "package/keys/a.pem",
    "package/data/game.cpk",
    "other/x.ts",
    "package/../x",
  ])
    expect(() => assertPublicEntries([entry(name)], "@aphrody/a")).toThrow("private or unsafe");
});

const member = (name: string, text: string) => {
  const data = new TextEncoder().encode(text);
  return { name, type: "file" as const, mode: 0o644, size: data.length, data };
};

test("publication audit refuses unshipped exports, workspace specs, credentials and host paths", () => {
  const manifest = (value: object) => member("package/package.json", JSON.stringify(value));
  expect(
    auditArchive(
      [
        manifest({ version: "1.0.0", exports: "./src/index.ts" }),
        member("package/src/index.ts", ""),
      ],
      "@aphrody/a",
    ),
  ).toEqual([]);
  const problems = auditArchive(
    [
      manifest({
        version: "1.0.0",
        exports: { bun: "./guest-js/index.ts" },
        dependencies: { "@aphrody/b": "workspace:*" },
      }),
      member("package/dist/a.js", 'const t = "npm_' + "a".repeat(36) + '";'),
      member("package/dist/b.js", "// built in /home/aphro/aphrody"),
    ],
    "@aphrody/a",
  );
  expect(problems.join("\n")).toContain("exports not shipped: guest-js/index.ts");
  expect(problems.join("\n")).toContain("unpublishable spec @aphrody/b@workspace:*");
  expect(problems.join("\n")).toContain("credential-like text in package/dist/a.js");
  expect(problems.join("\n")).toContain("host path in package/dist/b.js");
});

test("publication order puts @aphrody runtime dependencies first", async () => {
  const order = await publishOrder(root, ["@aphrody/plugin-opener", "@aphrody/api"]);
  expect(order.indexOf("@aphrody/api")).toBeLessThan(order.indexOf("@aphrody/plugin-opener"));
});
