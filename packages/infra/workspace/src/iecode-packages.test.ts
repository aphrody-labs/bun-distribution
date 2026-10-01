// SPDX-License-Identifier: Apache-2.0
// Packing and fixture setup stay sequential to keep provenance and filesystem operations ordered.
/* eslint-disable no-await-in-loop */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareIecodePackages, validateArchiveEntries } from "./iecode-packages";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function run(argv: string[], cwd: string) {
  const child = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(cwd, ".fixture-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(err);
  return out;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "iecode-pack-test-"));
  temporary.push(root);
  const source = join(root, "producer");
  await mkdir(source);
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "producer",
      private: true,
      workspaces: { packages: ["packages/*"], catalog: { zod: "3.25.76" } },
    }),
  );
  for (const member of ["inagle", "inagle-cross", "azalee"]) {
    const directory = join(source, "packages", member);
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "src/index.ts"), "export const contract = 1;\n");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: `fixture-${member}`,
        version: "1.2.3",
        files: ["src"],
        exports: "./src/index.ts",
        dependencies:
          member === "azalee" ? { "fixture-inagle": "workspace:*" } : { zod: "catalog:" },
      }),
    );
  }
  const zod = join(source, "packages", "zod");
  await mkdir(zod);
  await writeFile(join(zod, "package.json"), JSON.stringify({ name: "zod", version: "3.25.76" }));
  await run([process.execPath, "install", "--offline", "--ignore-scripts"], source);
  await writeFile(join(source, ".gitignore"), "node_modules/\n.fixture-cache/\n");
  await run(["git", "init", "-q"], source);
  await run(["git", "add", "."], source);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-code",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-qm",
      "Fixture",
    ],
    source,
  );
  return { source, destination: join(root, "archives") };
}

test("preview is read-only and dirty provenance requires an explicit option", async () => {
  const options = await fixture();
  const preview = await prepareIecodePackages(options);
  expect(preview.applied).toBe(false);
  expect(await Bun.file(join(options.destination, "manifest.json")).exists()).toBe(false);
  await writeFile(join(options.source, "notes.txt"), "local modification");
  await expect(prepareIecodePackages(options)).rejects.toThrow("source is dirty");
  expect((await prepareIecodePackages({ ...options, allowDirty: true })).dirty).toBe(true);
});

test("packing preserves producer metadata and emits checksummed translated archives", async () => {
  const options = await fixture();
  const before = await readFile(join(options.source, "packages/inagle/package.json"), "utf8");
  const result = await prepareIecodePackages({ ...options, apply: true });
  expect(result.packages).toHaveLength(3);
  const manifest = JSON.parse(await readFile(join(options.destination, "manifest.json"), "utf8"));
  for (const item of manifest.packages) {
    const archive = join(options.destination, item.archive);
    expect(item.sha256).toBe(
      createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    );
    const metadata = JSON.parse(
      await run(["tar", "-xOf", archive, "package/package.json"], options.source),
    );
    expect(metadata.dependencies).toEqual(
      item.name === "fixture-azalee" ? { "fixture-inagle": "1.2.3" } : { zod: "3.25.76" },
    );
  }
  expect(await readFile(join(options.source, "packages/inagle/package.json"), "utf8")).toBe(before);
  expect((await run(["git", "status", "--porcelain"], options.source)).trim()).toBe("");
  expect(await Bun.file(join(options.source, "bun.lock")).exists()).toBe(true);
});

test("archive checks reject private inputs and entries beyond the allowlist", () => {
  expect(() => validateArchiveEntries(["package/src/data/schema.ts"], ["src"])).not.toThrow();
  expect(() => validateArchiveEntries(["package/data/private.json"], ["data"])).toThrow("Private");
  expect(() => validateArchiveEntries(["package/src/.env"], ["src"])).toThrow("Private");
  expect(() => validateArchiveEntries(["package/src/game.cpk"], ["src"])).toThrow("Private");
  expect(() => validateArchiveEntries(["package/../escape"], ["src"])).toThrow("unsafe");
  expect(() => validateArchiveEntries(["package/other.ts"], ["src"])).toThrow("allowlist");
});

test("packing rejects a CLI target absent from the clean archive", async () => {
  const options = await fixture();
  const path = join(options.source, "packages/inagle/package.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  metadata.bin = { inagle: "./dist/missing.js" };
  await writeFile(path, JSON.stringify(metadata));
  await run(["git", "add", "."], options.source);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-code",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-m",
      "fixture CLI",
    ],
    options.source,
  );
  await expect(prepareIecodePackages({ ...options, apply: true })).rejects.toThrow(
    "missing archive entrypoint",
  );
});
