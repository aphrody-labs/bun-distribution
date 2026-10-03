// SPDX-License-Identifier: Apache-2.0
// Packing and fixture setup stay sequential to keep provenance and filesystem operations ordered.
/* eslint-disable no-await-in-loop */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareIecodePackages,
  validateArchiveEntries,
  validateArchiveTypes,
  canonicalizePackageArchive,
  readIecodeSource,
} from "./iecode-packages";

const temporary: string[] = [];

test("canonical archive bytes are independent of source ordering, ownership, timestamps and gzip headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iecode-canonical-"));
  temporary.push(directory);
  const paths = [join(directory, "host-one.tgz"), join(directory, "host-two.tgz")];
  for (let index = 0; index < paths.length; index++) {
    await run(
      [
        "python3",
        "-I",
        "-c",
        `import io, sys, tarfile
host = int(sys.argv[2])
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for name in (['package/src/a.ts', 'package/src/b.ts'] if host == 0 else ['package/src/b.ts', 'package/src/a.ts']):
        entry = tarfile.TarInfo(name)
        content = ('export const name = ' + repr(name)).encode()
        entry.size = len(content)
        entry.uid = host + 1000
        entry.gid = host + 1001
        entry.uname = 'host-' + str(host)
        entry.gname = 'group-' + str(host)
        entry.mtime = host + 123456789
        entry.mode = 0o644 if host == 0 else 0o664
        entry.pax_headers = {'atime': str(host + 999)}
        archive.addfile(entry, io.BytesIO(content))
`,
        paths[index]!,
        String(index),
      ],
      directory,
    );
    await canonicalizePackageArchive(paths[index]!, directory);
  }
  expect(await readFile(paths[0]!)).toEqual(await readFile(paths[1]!));
  const once = await readFile(paths[0]!);
  await canonicalizePackageArchive(paths[0]!, directory);
  expect(await readFile(paths[0]!)).toEqual(once);
  expect(await run(["tar", "-xOf", paths[0]!, "package/src/a.ts"], directory)).toContain(
    "export const name",
  );
});
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

test("release preparation uses the pinned snapshot without switching a dirty producer", async () => {
  const options = await fixture();
  const revision = (await run(["git", "rev-parse", "HEAD"], options.source)).trim();
  await writeFile(join(options.source, "notes.txt"), "uncommitted developer data");
  const stage = options.destination;
  await mkdir(join(stage, "config"), { recursive: true });
  await mkdir(join(stage, "packages/infra/workspace/src"), { recursive: true });
  await writeFile(
    join(stage, "config/sibling-checkouts.json"),
    JSON.stringify({
      iecode: {
        path: "../iecode",
        rev: revision,
        repository: "https://github.com/aphrody-labs/iecode.git",
        packages: ["inagle", "inagle-cross", "azalee"],
        envOverride: "APHRODY_IECODE_ROOT",
      },
    }),
  );
  for (const module of ["iecode-packages.ts", "canonical-tar.ts"])
    await writeFile(
      join(stage, "packages/infra/workspace/src", module),
      await readFile(join(import.meta.dir, module), "utf8"),
    );
  await run(
    [
      "bash",
      join(import.meta.dir, "../../../../scripts/rg/prepare-iecode-release.sh"),
      stage,
      options.source,
    ],
    stage,
  );
  const manifest = JSON.parse(
    await readFile(join(stage, ".cache/iecode-packages/manifest.json"), "utf8"),
  );
  expect(manifest.sourceRevision).toBe(revision);
  expect(manifest.dirty).toBe(false);
  expect(await readFile(join(options.source, "notes.txt"), "utf8")).toBe(
    "uncommitted developer data",
  );
  expect((await run(["git", "rev-parse", "HEAD"], options.source)).trim()).toBe(revision);
});

test("publication preserves old manifest on archive conflict and rejects symlink destinations", async () => {
  const options = await fixture();
  const first = await prepareIecodePackages({ ...options, apply: true });
  await prepareIecodePackages({ ...options, apply: true });
  const manifest = await readFile(join(options.destination, "manifest.json"), "utf8");
  const archive = first.packages[0]!;
  await writeFile(join(options.destination, archive.archive), "conflicting bytes");
  await expect(prepareIecodePackages({ ...options, apply: true })).rejects.toThrow(
    "conflicts with provenance",
  );
  expect(await readFile(join(options.destination, "manifest.json"), "utf8")).toBe(manifest);
  const alias = options.destination + "-alias";
  await symlink(options.destination, alias);
  await expect(
    prepareIecodePackages({ ...options, destination: join(alias, "new"), apply: true }),
  ).rejects.toThrow("symlink");
});

test("archive metadata rejects links without extracting their targets", async () => {
  const options = await fixture();
  const archive = join(options.destination + "-link.tgz");
  await run(
    [
      "python3",
      "-I",
      "-c",
      `import sys, tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    item = tarfile.TarInfo('package/src/link.ts')
    item.type = tarfile.SYMTYPE
    item.linkname = '/outside'
    archive.addfile(item)
`,
      archive,
    ],
    options.source,
  );
  await expect(validateArchiveTypes(archive, options.source)).rejects.toThrow(
    "Unsupported archive entry type",
  );
});

test("packing refuses source aliases before any external content is archived", async () => {
  const options = await fixture();
  await writeFile(join(options.source, "external.txt"), "synthetic fixture outside package");
  await symlink(
    join(options.source, "external.txt"),
    join(options.source, "packages/inagle/src/alias.ts"),
  );
  await expect(
    prepareIecodePackages({ ...options, apply: true, allowDirty: true }),
  ).rejects.toThrow("refused before packing");
  expect(await Bun.file(join(options.destination, "manifest.json")).exists()).toBe(false);
});

test("failed repacking cannot replace previously committed archive bytes or manifest", async () => {
  const options = await fixture();
  await prepareIecodePackages({ ...options, apply: true });
  const manifestBefore = await readFile(join(options.destination, "manifest.json"), "utf8");
  await writeFile(
    join(options.source, "packages/inagle/src/index.ts"),
    "export const contract = 2;\n",
  );
  await expect(
    prepareIecodePackages({ ...options, apply: true, allowDirty: true }),
  ).rejects.toThrow("conflicts with provenance");
  expect(await readFile(join(options.destination, "manifest.json"), "utf8")).toBe(manifestBefore);
  for (const item of (
    JSON.parse(manifestBefore) as { packages: Array<{ archive: string; sha256: string }> }
  ).packages)
    expect(
      createHash("sha256")
        .update(await readFile(join(options.destination, item.archive)))
        .digest("hex"),
    ).toBe(item.sha256);
  await expect(
    prepareIecodePackages({
      ...options,
      destination: join(options.source, "..archives"),
      apply: true,
      allowDirty: true,
    }),
  ).rejects.toThrow("outside the producer");
});

test("CI reads the pinned producer contract through the archive owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iecode-source-"));
  temporary.push(directory);
  const contract = {
    repository: "https://github.com/aphrody-labs/iecode.git",
    path: "../iecode",
    rev: "c".repeat(40),
    envOverride: "APHRODY_IECODE_ROOT",
    packages: ["inagle", "inagle-cross", "azalee"],
  };
  const config = join(directory, "sibling-checkouts.json");
  const output = join(directory, "github-output");
  await writeFile(config, JSON.stringify({ iecode: contract }));
  await writeFile(output, "previous=kept\n");
  const source = (...args: string[]) =>
    Bun.spawn([process.execPath, join(import.meta.dir, "iecode-packages.ts"), "source", ...args], {
      env: { ...process.env, GITHUB_OUTPUT: output },
      stdout: "pipe",
      stderr: "pipe",
    });
  expect(await source().exited).not.toBe(0);
  const child = source("--config", config, "--github-output");
  expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({
    slug: "aphrody-labs/iecode",
    revision: contract.rev,
  });
  expect(await child.exited).toBe(0);
  expect(await readFile(output, "utf8")).toBe(
    `previous=kept\nrepository=aphrody-labs/iecode\nrevision=${contract.rev}\n`,
  );
  const field = source("--config", config, "--field", "revision");
  expect(await new Response(field.stdout).text()).toBe(`${contract.rev}\n`);
  expect(await source("--config", config, "--field", "unknown").exited).not.toBe(0);
  for (const invalid of [{ path: "../other" }, { rev: "main" }, { packages: ["inagle"] }]) {
    await writeFile(config, JSON.stringify({ iecode: { ...contract, ...invalid } }));
    await expect(readIecodeSource(config)).rejects.toThrow();
  }
});
