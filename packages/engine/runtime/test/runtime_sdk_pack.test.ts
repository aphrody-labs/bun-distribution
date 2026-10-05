// SPDX-License-Identifier: MIT
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packRuntimeSdk } from "../../../../scripts/release/runtime_sdk_pack";
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function run(argv: string[], cwd: string) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(err);
  return out.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "yolo-sdk-snapshot-"));
  temporary.push(root);
  const sdk = join(root, "packages/engine/runtime");
  await mkdir(join(sdk, "src"), { recursive: true });
  await writeFile(join(root, "LICENSE"), "MIT fixture license\n");
  await writeFile(join(sdk, "README.md"), "# SDK fixture\n");
  await writeFile(join(sdk, "runtime.d.ts"), "declare module 'runtime:system';\n");
  await writeFile(join(sdk, "src/index.ts"), "export const snapshot = 'committed';\n");
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "@aphrody/runtime-sdk",
      version: "0.1.0",
      files: ["src", "runtime.d.ts", "README.md"],
      dependencies: {},
      scripts: { prepack: "touch hook-ran" },
    }),
  );
  await run(["git", "init", "-q"], root);
  await run(["git", "add", "."], root);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-dev",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-qm",
      "Fixture",
    ],
    root,
  );
  return { root, sdk, revision: await run(["git", "rev-parse", "HEAD"], root) };
}
test("pack committed SDK reproducibly without engines, hooks or dirty source changes", async () => {
  const f = await fixture();
  await writeFile(join(f.sdk, "src/index.ts"), "uncommitted editor content\n");
  await mkdir(join(f.root, "vendor"));
  await writeFile(join(f.root, "vendor/engine"), "engine excluded\n");
  const before = await run(["git", "status", "--porcelain"], f.root);
  const one = await packRuntimeSdk({
    root: f.root,
    destination: join(f.root, "out-one"),
    revision: f.revision,
  });
  const two = await packRuntimeSdk({
    root: f.root,
    destination: join(f.root, "out-two"),
    revision: f.revision,
  });
  expect(one.sha256).toBe(two.sha256);
  expect(one).toMatchObject({ yoloRevision: f.revision, dirty: false });
  expect(await run(["tar", "-xOf", one.path, "package/src/index.ts"], f.root)).toBe(
    "export const snapshot = 'committed';",
  );
  expect(await run(["tar", "-xOf", one.path, "package/LICENSE"], f.root)).toBe(
    "MIT fixture license",
  );
  expect(await run(["tar", "-tzf", one.path], f.root)).not.toMatch(/vendor|target|hook-ran/);
  expect(await Bun.file(join(f.sdk, "hook-ran")).exists()).toBe(false);
  expect(await readFile(join(f.sdk, "src/index.ts"), "utf8")).toBe("uncommitted editor content\n");
  expect(before).toContain("src/index.ts");
  expect(await run(["git", "rev-parse", "HEAD"], f.root)).toBe(f.revision);
});
test("existing conflicts refuse publication while preserving provenance", async () => {
  const f = await fixture();
  const destination = join(f.root, "out");
  const result = await packRuntimeSdk({ root: f.root, destination });
  const manifest = await readFile(result.path + ".json", "utf8");
  await writeFile(result.path, "conflicting bytes");
  await expect(packRuntimeSdk({ root: f.root, destination })).rejects.toThrow(/conflicts/);
  expect(await readFile(result.path + ".json", "utf8")).toBe(manifest);
});
test("the generated tooling contract carries its Apache license in the SDK archive", async () => {
  const f = await fixture();
  const metadata = JSON.parse(await readFile(join(f.sdk, "package.json"), "utf8"));
  metadata.files.push("LICENSE-APACHE");
  metadata.license = "MIT AND Apache-2.0";
  await writeFile(join(f.sdk, "package.json"), JSON.stringify(metadata));
  await writeFile(join(f.sdk, "LICENSE-APACHE"), "Apache fixture license\n");
  await run(["git", "add", "packages/engine/runtime"], f.root);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-dev",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-qm",
      "Include tooling license",
    ],
    f.root,
  );
  const result = await packRuntimeSdk({ root: f.root, destination: join(f.root, "out") });
  expect(await run(["tar", "-xOf", result.path, "package/LICENSE-APACHE"], f.root)).toBe(
    "Apache fixture license",
  );
});
test("linked committed SDK sources are refused before extraction", async () => {
  const f = await fixture();
  await symlink("../README.md", join(f.sdk, "src/linked.ts"));
  await run(["git", "add", "."], f.root);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-dev",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-qm",
      "Linked fixture",
    ],
    f.root,
  );
  await expect(packRuntimeSdk({ root: f.root, destination: join(f.root, "out") })).rejects.toThrow(
    /regular files/,
  );
  await expect(
    packRuntimeSdk({ root: f.root, destination: join(f.root, "out"), revision: "--help" }),
  ).rejects.toThrow(/pinned revision/);
});

test("linked destination and provenance cannot overwrite another file", async () => {
  const f = await fixture();
  const destination = join(f.root, "out");
  const result = await packRuntimeSdk({ root: f.root, destination });
  const protectedFile = join(f.root, "other-owner");
  await writeFile(protectedFile, "preserve this file");
  await rm(result.path + ".json");
  await symlink(protectedFile, result.path + ".json");
  await expect(packRuntimeSdk({ root: f.root, destination })).rejects.toThrow(/regular file/);
  expect(await readFile(protectedFile, "utf8")).toBe("preserve this file");
  const alias = join(f.root, "alias");
  await symlink(destination, alias);
  await expect(packRuntimeSdk({ root: f.root, destination: alias })).rejects.toThrow(
    /real directory/,
  );
});
