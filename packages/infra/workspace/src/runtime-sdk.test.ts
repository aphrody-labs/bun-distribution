// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRuntimeSdk } from "./runtime-sdk";
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })));
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
  const base = await mkdtemp(join(tmpdir(), "runtime-sdk-consumer-"));
  temporary.push(base);
  const root = join(base, "consumer"),
    source = join(base, "producer");
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(source, "scripts/release"), { recursive: true });
  const bytes = "fixture SDK bytes";
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const archive = "aphrody-runtime-sdk-0.1.0-" + sha256.slice(0, 8) + ".tgz";
  const owner = [
    'import {mkdir,writeFile} from "node:fs/promises";',
    'import {join} from "node:path";',
    "export async function packRuntimeSdk({destination,revision}) {",
    "await mkdir(destination,{recursive:true});",
    "const path=join(destination," + JSON.stringify(archive) + ");",
    "await writeFile(path," + JSON.stringify(bytes) + ");",
    'await writeFile(path+".json",JSON.stringify({name:"@aphrody/runtime-sdk",version:"0.1.0",archive:' +
      JSON.stringify(archive) +
      ",sha256:" +
      JSON.stringify(sha256) +
      ",bytes:" +
      bytes.length +
      ",yoloRevision:revision,dirty:false}));",
    "return {path}; }",
    "if(import.meta.main) await packRuntimeSdk({destination:Bun.argv[2],revision:Bun.argv[4]});",
  ].join("\n");
  await writeFile(join(source, "scripts/release/runtime_sdk_pack.ts"), owner);
  await run(["git", "init", "-q"], source);
  await run(["git", "remote", "add", "origin", "https://github.com/aphrody-labs/yolo.git"], source);
  await run(["git", "add", "."], source);
  await run(
    [
      "git",
      "-c",
      "user.name=aphrody-dev",
      "-c",
      "user.email=contact@aphrody.com",
      "commit",
      "-qm",
      "Pinned producer fixture",
    ],
    source,
  );
  const rev = await run(["git", "rev-parse", "HEAD"], source);
  const configuration = {
    yolo: {
      repository: "https://github.com/aphrody-labs/yolo.git",
      path: "../producer",
      rev,
      envOverride: "APHRODY_YOLO_ROOT",
      sdk: { version: "0.1.0", archive, sha256 },
    },
  };
  await writeFile(join(root, "config/sibling-checkouts.json"), JSON.stringify(configuration));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      workspaces: { catalog: { "@aphrody/runtime-sdk": "file:.cache/yolo-packages/" + archive } },
    }),
  );
  return { root, source, archive, bytes, configuration };
}
test("preview is read only; dirty owner is refused and verified cache reuse is offline", async () => {
  const f = await fixture();
  const preview = await prepareRuntimeSdk({ root: f.root, source: f.source });
  expect(preview).toMatchObject({ applied: false, cached: false });
  expect(await Bun.file(preview.archive).exists()).toBe(false);
  const ownerPath = join(f.source, "scripts/release/runtime_sdk_pack.ts");
  const original = await readFile(ownerPath, "utf8");
  await writeFile(ownerPath, "throw new Error('dirty owner must not execute');");
  await expect(prepareRuntimeSdk({ root: f.root, source: f.source, apply: true })).rejects.toThrow(
    /differs from the pin/,
  );
  expect(await readFile(ownerPath, "utf8")).toContain("dirty owner must not execute");
  await writeFile(ownerPath, original);
  const applied = await prepareRuntimeSdk({ root: f.root, source: f.source, apply: true });
  expect(applied.applied).toBe(true);
  expect(await readFile(applied.archive, "utf8")).toBe(f.bytes);
  await rename(f.source, f.source + "-offline");
  expect(await prepareRuntimeSdk({ root: f.root, source: f.source, apply: true })).toMatchObject({
    cached: true,
    applied: false,
  });
});
test("tampered archive and provenance refuse reuse without overwriting content", async () => {
  const f = await fixture();
  const applied = await prepareRuntimeSdk({ root: f.root, source: f.source, apply: true });
  await writeFile(applied.archive, "tampered fixture");
  await expect(prepareRuntimeSdk({ root: f.root, apply: true })).rejects.toThrow(/checksum/);
  expect(await readFile(applied.archive, "utf8")).toBe("tampered fixture");
  await writeFile(applied.archive, f.bytes);
  const provenance = JSON.parse(await readFile(applied.archive + ".json", "utf8"));
  provenance.dirty = true;
  await writeFile(applied.archive + ".json", JSON.stringify(provenance));
  await expect(prepareRuntimeSdk({ root: f.root, apply: true })).rejects.toThrow(/provenance/);
});
test("catalog mismatch and foreign producer origin are refused", async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, "package.json"),
    JSON.stringify({ workspaces: { catalog: { "@aphrody/runtime-sdk": "file:other.tgz" } } }),
  );
  await expect(prepareRuntimeSdk({ root: f.root, apply: true })).rejects.toThrow(/catalog/);
  await writeFile(
    join(f.root, "package.json"),
    JSON.stringify({
      workspaces: { catalog: { "@aphrody/runtime-sdk": "file:.cache/yolo-packages/" + f.archive } },
    }),
  );
  await run(
    ["git", "remote", "set-url", "origin", "https://example.test/aphrody-labs/yolo.git"],
    f.source,
  );
  await expect(prepareRuntimeSdk({ root: f.root, source: f.source, apply: true })).rejects.toThrow(
    /origin/,
  );
  expect(await Bun.file(join(f.root, ".cache/yolo-packages", f.archive)).exists()).toBe(false);
});
test("linked cached archives cannot stand in for another owner's file", async () => {
  const f = await fixture();
  const result = await prepareRuntimeSdk({ root: f.root, apply: true, source: f.source });
  const other = join(f.root, "other-owner");
  await writeFile(other, f.bytes);
  await rm(result.archive);
  await symlink(other, result.archive);
  await expect(prepareRuntimeSdk({ root: f.root, apply: true })).rejects.toThrow(/regular files/);
  expect(await readFile(other, "utf8")).toBe(f.bytes);
});

test("missing existing producer fails without creating a clone or cache", async () => {
  const f = await fixture();
  await expect(
    prepareRuntimeSdk({ root: f.root, source: join(f.root, "absent"), apply: true }),
  ).rejects.toThrow(/Automatic cloning is disabled/);
  expect(await Bun.file(join(f.root, ".cache/yolo-source.git/HEAD")).exists()).toBe(false);
  expect(await Bun.file(join(f.root, ".cache/yolo-packages", f.archive)).exists()).toBe(false);
});
