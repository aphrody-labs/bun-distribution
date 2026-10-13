#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";
import {
  appCapabilities,
  appHostname,
  assertRuntimeFacts,
  currentRuntimeFacts,
  hashFile,
  loadConfig,
  repositoryRoot,
  runProcess,
  runtimePinFor,
  type RuntimeTarget,
} from "@aphrody/bun-workspace";
import { compileStandaloneApp } from "@aphrody/bun-artifacts/compiler";
import type { ProductCatalog } from "./product.ts";

async function command(args: string[], root: string): Promise<string> {
  const result = await runProcess(args, root, { timeoutMs: 15000, maxOutputBytes: 1048576 });
  if (result.code) throw new Error("Product source inspection failed.");
  return result.stdout.trim();
}

export async function productCatalog(root: string): Promise<ProductCatalog> {
  const config = await loadConfig(root);
  const metadata = await Bun.file(join(root, "package.json")).json();
  const sourceLock = (await Bun.file(join(root, "sources.lock.json")).json()) as {
    repositories: { id: string; mount: string; repository: string; revision: string }[];
  };
  const inventory = (await Bun.file(join(root, "infra/apps.json")).json()) as {
    apps: { id: string; kind: string; hostname?: string; qualification: Record<string, boolean> }[];
  };
  const capabilities = new Map(appCapabilities(config).map(app => [app.libraryId, app]));
  return {
    schemaVersion: 1,
    product: "Aphrody / Bun",
    version: metadata.version,
    observedAt: new Date().toISOString(),
    sourceRevision: await command(["git", "rev-parse", "HEAD"], root),
    sources: [
      ...config.modules.map(module => ({
        id: module.id,
        path: module.path,
        repository: module.fork,
        revision: module.revision,
        license: module.license,
      })),
      ...sourceLock.repositories.map(source => ({
        id: "source:" + source.id,
        path: source.mount,
        repository: source.repository,
        revision: source.revision,
        license: null,
      })),
    ],
    apps: inventory.apps.map(app => ({
      id: app.id,
      kind: app.kind,
      hostname: capabilities.has(app.id) ? appHostname(capabilities.get(app.id)!.id, config) : (app.hostname ?? null),
      qualification: { ...app.qualification },
    })),
  };
}

async function build(root: string, output: string): Promise<void> {
  root = await realpath(root);
  const revision = await command(["git", "rev-parse", "HEAD"], root);
  const inputProofs = new Map<string, string>();
  const blobProofs = new Map<string, string>();
  const proveInput = async (input: string): Promise<void> => {
    input = await realpath(input);
    const local = relative(root, input);
    if (!local || local === ".." || local.startsWith(`..${sep}`) || resolve(root, local) !== input)
      throw new Error("Product compiler input leaves its source owner.");
    const gitPath = local.replaceAll("\\", "/");
    const blob = await command(["git", "rev-parse", `${revision}:${gitPath}`], root);
    const actual = await command(["git", "hash-object", `--path=${gitPath}`, input], root);
    if (actual !== blob) throw new Error("Product compiler input differs from its committed Git blob: " + gitPath);
    const digest = await hashFile(input);
    const previous = inputProofs.get(input);
    if (previous && previous !== digest) throw new Error("Product compiler input changed during qualification.");
    inputProofs.set(input, digest);
    blobProofs.set(input, blob);
  };
  for (const path of [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    ".gitattributes",
    "aphrody.config.json",
    "sources.lock.json",
    "infra/apps.json",
    "packages/bun-app-host/package.json",
    "packages/bun-app-host/src/build.ts",
    "packages/bun-artifacts/package.json",
    "packages/bun-artifacts/src/compiler.ts",
    "packages/bun-workspace/package.json",
    "packages/workspace/package.json",
  ])
    await proveInput(join(root, path));
  const config = await loadConfig(root);
  const target = ((process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "windows"
      : process.platform) +
    "-" +
    process.arch) as RuntimeTarget;
  assertRuntimeFacts(runtimePinFor(config, target), currentRuntimeFacts());
  if ((await Bun.file(output).exists()) || (await Bun.file(output + ".json").exists()))
    throw new Error("Select a fresh standalone output and receipt.");
  const catalog = await productCatalog(root);
  if (catalog.sourceRevision !== revision) throw new Error("Product revision changed before compilation.");
  const stage = join(root, "build/staging/product-server", crypto.randomUUID());
  await mkdir(stage, { recursive: true });
  await mkdir(dirname(output), { recursive: true });
  const entry = join(stage, "entry.ts");
  const product = resolve(import.meta.dir, "product.ts");
  await Bun.write(
    entry,
    `import { startProduct } from ${JSON.stringify(product)};
const catalog = ${JSON.stringify(catalog)};
if (Bun.argv.includes("--version")) console.log("Aphrody / Bun server " + catalog.version);
else { const server = startProduct(catalog); console.log("Aphrody / Bun server: " + server.url); const stop = () => server.stop(true); process.once("SIGINT", stop); process.once("SIGTERM", stop); }
`,
  );
  inputProofs.set(entry, await hashFile(entry));
  const targetName = ("bun-" +
    (process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : process.platform) +
    "-" +
    process.arch) as Bun.Build.CompileTarget;
  const compiled = await compileStandaloneApp({
    entrypoint: entry,
    target: targetName,
    executablePath: process.execPath,
    outfile: output,
    onInput: async path => {
      if (resolve(path) === entry) {
        if ((await hashFile(entry)) !== inputProofs.get(entry)) throw new Error("Generated product entry changed.");
      } else await proveInput(path);
    },
  });
  for (const path of Object.keys(compiled.metafile!.inputs)) {
    if (path.startsWith("<") || path.startsWith("bun:") || path === "bun" || isBuiltin(path)) continue;
    if (!inputProofs.has(await realpath(resolve(root, path))))
      throw new Error("Compiled source lacks a Git input proof.");
  }
  for (const [path, digest] of inputProofs)
    if ((await hashFile(path)) !== digest) throw new Error("Product compiler input changed.");
  for (const path of blobProofs.keys()) await proveInput(path);
  if ((await command(["git", "rev-parse", "HEAD"], root)) !== revision)
    throw new Error("Product sources changed during compilation.");
  await Bun.write(
    output + ".json",
    JSON.stringify(
      {
        schemaVersion: 1,
        product: catalog.product,
        version: catalog.version,
        sourceRevision: catalog.sourceRevision,
        observedAt: catalog.observedAt,
        sha256: await hashFile(output),
        inputs: [...inputProofs].map(([path, sha256]) => ({
          path,
          sha256,
          gitBlob: blobProofs.get(path) ?? null,
          generated: path === entry,
        })),
        runtime: currentRuntimeFacts(),
        qualification: { compiled: true, executed: false, deployed: false },
      },
      null,
      2,
    ) + "\n",
  );
}

if (import.meta.main) {
  const [action = "help", rootValue = repositoryRoot, outputValue] = Bun.argv.slice(2);
  const root = resolve(rootValue);
  const output = resolve(
    outputValue ?? join(root, "build/apps/bun-os-server" + (process.platform === "win32" ? ".exe" : "")),
  );
  if (action === "help") console.log("build.ts build [ROOT] [FRESH_OUTPUT] | catalog [ROOT]");
  else if (action === "catalog") console.log(JSON.stringify(await productCatalog(root), null, 2));
  else if (action === "compile-worker") await build(root, output);
  else if (action === "build") {
    const result = await runProcess([process.execPath, import.meta.path, "compile-worker", root, output], root, {
      timeoutMs: 30000,
      maxOutputBytes: 1048576,
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exitCode = result.code;
  } else throw new Error("Use build or catalog.");
}
