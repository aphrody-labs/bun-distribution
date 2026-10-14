#!/usr/bin/env bun
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertRuntimeFacts, currentRuntimeFacts, hashFile, loadConfig, repositoryRoot } from "@aphrody/bun-workspace";

const packageSpecs = {
  paths: { directory: "paths", name: "@aphrody/paths" },
  ovh: { directory: "ovh", name: "@aphrody/ovh" },
  "kernel-client": { directory: "kernel-client", name: "@aphrody/os" },
} as const;

type PackageId = keyof typeof packageSpecs;
type Diagnostic = { code: string; message: string; path?: string };
type PackagePlan = {
  id: PackageId;
  name: string;
  status: "ready" | "blocked";
  packagePath: string;
  outputPath: string;
  entries: Array<{ export: string; source: string; sha256: string; typesSource: string; typesSHA256: string }>;
  diagnostics: Diagnostic[];
};

const usage = `Usage: bun scripts/build-packages.ts <plan|build> --package <paths|ovh|kernel-client> [--package ...]
Select every package explicitly. Outputs are written only to build/packages/<package>.
Build records compiled JavaScript only; it never executes or deploys the output.`;
const maxSnapshotFileBytes = 50 * 1024 * 1024;
const maxSnapshotBytes = 512 * 1024 * 1024;
const excludedDirectories = new Set([".git", "node_modules", "dist", "build"]);

function inside(base: string, target: string, allowEqual = false): boolean {
  const local = relative(resolve(base), resolve(target));
  return (
    (allowEqual && local === "") || (!!local && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local))
  );
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function fail(code: string, message: string, path?: string): Diagnostic {
  return path ? { code, message, path } : { code, message };
}

async function assertNoSymlinkComponents(root: string, path: string): Promise<void> {
  if (!inside(root, path, true)) throw new Error(`Path escapes the checkout: ${path}`);
  const local = relative(root, path);
  let current = root;
  for (const part of local.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${current}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Symlink path")) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function workspaceMemberPaths(root: string, patterns: string[]): Promise<Set<string>> {
  const included = new Set<string>();
  const excluded: Bun.Glob[] = [];
  for (const pattern of patterns) {
    const omit = pattern.startsWith("!");
    const normalized = (omit ? pattern.slice(1) : pattern).replaceAll("\\", "/").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes(".."))
      throw new Error(`Invalid Bun workspace pattern: ${pattern}`);
    const manifestGlob = new Bun.Glob(`${normalized}/package.json`);
    if (omit) {
      excluded.push(manifestGlob);
      continue;
    }
    for await (const manifest of manifestGlob.scan({ cwd: root, onlyFiles: true })) {
      included.add(manifest.replaceAll("\\", "/").slice(0, -"/package.json".length));
    }
  }
  for (const pattern of excluded) {
    for await (const manifest of pattern.scan({ cwd: root, onlyFiles: true })) {
      included.delete(manifest.replaceAll("\\", "/").slice(0, -"/package.json".length));
    }
  }
  return included;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exportTargets(value: unknown): { runtime?: string; types?: string } {
  if (typeof value === "string") return { runtime: value, types: value };
  if (!record(value)) return {};
  const types = typeof value.types === "string" ? value.types : undefined;
  for (const condition of ["bun", "import", "node", "default"]) {
    if (!(condition in value)) continue;
    const nested = exportTargets(value[condition]);
    if (nested.runtime) return { runtime: nested.runtime, types: types ?? nested.types };
  }
  return types ? { types } : {};
}

function exportRows(exportsValue: unknown): Array<[string, unknown]> {
  if (typeof exportsValue === "string") return [[".", exportsValue]];
  if (!record(exportsValue)) throw new Error("package.json exports must be a string or object.");
  const entries = Object.entries(exportsValue);
  if (entries.some(([key]) => key === "." || key.startsWith("./"))) return entries;
  return [[".", exportsValue]];
}

async function resolveSource(packageDir: string, target: string, label: string): Promise<string> {
  if (!target.startsWith("./") || target.includes("\\") || target.includes("\0"))
    throw new Error(`${label} must be a package-relative export path: ${target}`);
  const path = resolve(packageDir, target.slice(2));
  if (!inside(packageDir, path)) throw new Error(`${label} escapes its package: ${target}`);
  await assertNoSymlinkComponents(packageDir, path);
  const real = await realpath(path);
  if (!inside(packageDir, real)) throw new Error(`${label} resolves outside its package: ${target}`);
  if (!/\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/.test(real))
    throw new Error(`${label} must point to TypeScript or JavaScript: ${target}`);
  return real;
}

async function packagePlan(root: string, rootPackage: Record<string, unknown>, id: PackageId): Promise<PackagePlan> {
  const spec = packageSpecs[id];
  const packagePath = `packages/${spec.directory}`;
  const packageDir = resolve(root, packagePath);
  const outputPath = `build/packages/${spec.directory}`;
  const outputDir = resolve(root, outputPath);
  const diagnostics: Diagnostic[] = [];
  const result: PackagePlan = {
    id,
    name: spec.name,
    status: "blocked",
    packagePath,
    outputPath,
    entries: [],
    diagnostics,
  };

  const workspacePatterns = rootPackage.workspaces;
  if (!Array.isArray(workspacePatterns) || workspacePatterns.some(pattern => typeof pattern !== "string")) {
    diagnostics.push(fail("ROOT_WORKSPACES_INVALID", "Root package.json must declare Bun workspace patterns."));
    return result;
  }
  const members = await workspaceMemberPaths(root, workspacePatterns as string[]);
  if (!members.has(packagePath))
    diagnostics.push(fail("WORKSPACE_MEMBER_MISSING", `${packagePath} is not an actual root Bun workspace member.`));

  try {
    await assertNoSymlinkComponents(root, packageDir);
    const manifestPath = join(packageDir, "package.json");
    await assertNoSymlinkComponents(packageDir, manifestPath);
    const packageJSON = await Bun.file(manifestPath).json();
    if (!record(packageJSON)) throw new Error("Package manifest must be a JSON object.");
    if (packageJSON.name !== spec.name) throw new Error(`Expected package name ${spec.name}.`);
    if (packageJSON.version !== rootPackage.version)
      throw new Error("Package version differs from the root product version.");
    const rows = exportRows(packageJSON.exports);
    const seenEntries = new Set<string>();
    for (const [key, value] of rows) {
      if (key !== "." && !key.startsWith("./")) throw new Error(`Unsupported package export key: ${key}`);
      const targets = exportTargets(value);
      const runtime = targets.runtime ?? targets.types;
      if (!runtime) throw new Error(`Export ${key} has no Bun/import/default JavaScript entry.`);
      const source = await resolveSource(packageDir, runtime, `Export ${key}`);
      const typesSource = await resolveSource(packageDir, targets.types ?? runtime, `Types export ${key}`);
      if (!/\.(?:ts|tsx|mts)$/.test(typesSource))
        throw new Error(`Types export ${key} must point to a TypeScript source.`);
      if (seenEntries.has(source)) throw new Error(`Two exports resolve to the same build entry: ${runtime}`);
      seenEntries.add(source);
      result.entries.push({
        export: key,
        source,
        sha256: await hashFile(source, { maxBytes: 20 * 1024 * 1024 }),
        typesSource,
        typesSHA256: await hashFile(typesSource, { maxBytes: 20 * 1024 * 1024 }),
      });
    }
    if (result.entries.length === 0) throw new Error("Package exports no JavaScript entrypoints.");
  } catch (error) {
    diagnostics.push(
      fail("PACKAGE_PREFLIGHT_FAILED", error instanceof Error ? error.message : String(error), packagePath),
    );
  }

  try {
    await assertNoSymlinkComponents(root, outputDir);
    try {
      await lstat(outputDir);
      diagnostics.push(
        fail(
          "OUTPUT_ALREADY_EXISTS",
          "Build output path must not exist; this owner does not clean or overwrite outputs.",
          outputPath,
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } catch (error) {
    diagnostics.push(fail("OUTPUT_PATH_INVALID", error instanceof Error ? error.message : String(error), outputPath));
  }

  result.status = diagnostics.length === 0 ? "ready" : "blocked";
  return result;
}

type SourceSnapshot = Map<string, { sha256: string; bytes: number }>;

async function snapshotPackageSources(packageDir: string): Promise<SourceSnapshot> {
  const snapshot: SourceSnapshot = new Map();
  let totalBytes = 0;
  const pending = [packageDir];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Package source tree contains a symlink: ${path}`);
      if (metadata.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!metadata.isFile()) continue;
      const sha256 = await hashFile(path, { maxBytes: maxSnapshotFileBytes, expectedBytes: metadata.size });
      totalBytes += metadata.size;
      if (totalBytes > maxSnapshotBytes) throw new Error("Package source snapshot exceeds the 512 MiB limit.");
      snapshot.set(await realpath(path), { sha256, bytes: metadata.size });
    }
  }
  return snapshot;
}

async function resolveMetafileInput(
  root: string,
  packageDir: string,
  input: string,
  snapshot: SourceSnapshot,
): Promise<string> {
  const candidates = isAbsolute(input) ? [resolve(input)] : [resolve(root, input), resolve(packageDir, input)];
  for (const candidate of candidates) {
    if (!inside(packageDir, candidate)) continue;
    try {
      await assertNoSymlinkComponents(packageDir, candidate);
      const canonical = await realpath(candidate);
      if (snapshot.has(canonical)) return canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Bundler input is not a pre-snapshotted file inside its package: ${input}`);
}

async function resolveBuildOutput(root: string, outputDir: string, output: string): Promise<string> {
  const candidates = isAbsolute(output) ? [resolve(output)] : [resolve(outputDir, output), resolve(root, output)];
  for (const candidate of candidates) {
    if (!inside(outputDir, candidate)) continue;
    try {
      await assertNoSymlinkComponents(root, candidate);
      const canonical = await realpath(candidate);
      if (inside(outputDir, canonical)) return canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Bundler output is not a file inside its package output directory: ${output}`);
}

function diagnosticsFromBuild(
  logs: Bun.BuildOutput["logs"],
): Array<Diagnostic & { level?: string; position?: unknown }> {
  return logs.map(log => ({
    code: "code" in log ? log.code : "BUN_BUILD_DIAGNOSTIC",
    message: log.message,
    level: log.level,
    ...(log.position ? { position: log.position } : {}),
  }));
}

async function buildPackage(root: string, plan: PackagePlan): Promise<Record<string, unknown>> {
  const packageDir = resolve(root, plan.packagePath);
  const outputDir = resolve(root, plan.outputPath);
  if (resolve(process.cwd()) !== root)
    throw new Error("Run package builds from the Bun OS repository root so metafile paths have a stable base.");
  const inputSnapshot = await snapshotPackageSources(packageDir);
  for (const entry of plan.entries) {
    const initial = inputSnapshot.get(entry.source);
    const typeInitial = inputSnapshot.get(entry.typesSource);
    if (!initial || initial.sha256 !== entry.sha256 || !typeInitial || typeInitial.sha256 !== entry.typesSHA256)
      throw new Error(`Package entry changed after planning: ${entry.export}`);
  }
  await assertNoSymlinkComponents(root, resolve(root, "build"));
  await mkdir(dirname(outputDir), { recursive: true });
  await mkdir(outputDir);
  await assertNoSymlinkComponents(root, outputDir);
  const result = await Bun.build({
    entrypoints: plan.entries.map(entry => entry.source),
    outdir: outputDir,
    root: packageDir,
    naming: { entry: "[dir]/[name].js", chunk: "chunk-[hash].js", asset: "asset-[name]-[hash]" },
    target: "bun",
    packages: "external",
    metafile: true,
    sourcemap: "none",
  });
  const diagnostics = diagnosticsFromBuild(result.logs);
  if (!result.success || !result.metafile) {
    return {
      id: plan.id,
      name: plan.name,
      status: "failed",
      diagnostics,
      qualification: { compiledJS: false, executed: false, deployed: false },
    };
  }

  const inputHashes: Array<{ path: string; sha256: string; bytes: number }> = [];
  for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
    const source = await resolveMetafileInput(root, packageDir, input, inputSnapshot);
    const before = inputSnapshot.get(source)!;
    if (before.bytes !== metadata.bytes) throw new Error(`Bundler input size changed after snapshot: ${input}`);
    const sha256 = await hashFile(source, { maxBytes: maxSnapshotFileBytes, expectedBytes: metadata.bytes });
    if (sha256 !== before.sha256) throw new Error(`Bundler input changed while compiling: ${input}`);
    inputHashes.push({ path: relativePath(root, source), sha256, bytes: metadata.bytes });
  }

  const outputs: Array<{ path: string; sha256: string; bytes: number; kind: string }> = [];
  let compiledJS = false;
  for (const artifact of result.outputs) {
    const path = await resolveBuildOutput(root, outputDir, artifact.path);
    const sha256 = await hashFile(path, { maxBytes: 200 * 1024 * 1024 });
    const bytes = Bun.file(path).size;
    if (artifact.kind === "entry-point" && /\.(?:js|mjs|cjs)$/.test(path)) compiledJS = true;
    outputs.push({ path: relativePath(root, path), sha256, bytes, kind: artifact.kind });
  }
  if (!compiledJS) throw new Error("Bun.build produced no JavaScript entry-point artifact.");

  const receipt = {
    schemaVersion: 1,
    package: { id: plan.id, name: plan.name, version: "1.4.4" },
    source: {
      packagePath: plan.packagePath,
      entries: plan.entries.map(entry => ({
        export: entry.export,
        path: relativePath(root, entry.source),
        sha256: entry.sha256,
        typesPath: relativePath(root, entry.typesSource),
        typesSHA256: entry.typesSHA256,
      })),
      inputs: inputHashes,
    },
    outputs,
    qualification: { compiledJS, executed: false, deployed: false },
    createdAt: new Date().toISOString(),
  };
  const receiptPath = join(outputDir, "build-receipt.json");
  await Bun.write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    id: plan.id,
    name: plan.name,
    status: "built",
    receipt: relativePath(root, receiptPath),
    outputs,
    diagnostics,
    qualification: receipt.qualification,
  };
}

function parseArgs(args: string[]): { action: "plan" | "build"; packages: PackageId[] } {
  const action = args.shift();
  if (action !== "plan" && action !== "build") throw new Error(usage);
  const selections: string[] = [];
  while (args.length) {
    const flag = args.shift();
    if (flag !== "--package") throw new Error(`Unexpected argument: ${flag ?? ""}\n${usage}`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`--package requires an explicit selection.\n${usage}`);
    selections.push(
      ...value
        .split(",")
        .map(item => item.trim())
        .filter(Boolean),
    );
  }
  if (selections.length === 0) throw new Error(`Select at least one package explicitly.\n${usage}`);
  if (new Set(selections).size !== selections.length) throw new Error("Duplicate package selection.");
  const unknown = selections.filter(value => !Object.hasOwn(packageSpecs, value));
  if (unknown.length) throw new Error(`Unknown package selection: ${unknown.join(", ")}\n${usage}`);
  return { action, packages: selections as PackageId[] };
}

async function main(): Promise<number> {
  const { action, packages } = parseArgs(Bun.argv.slice(2));
  const root = await realpath(repositoryRoot);
  const rootPackage = await Bun.file(join(root, "package.json")).json();
  if (!record(rootPackage) || rootPackage.version !== "1.4.4")
    throw new Error("Root Bun package version must be 1.4.4.");
  const plans = await Promise.all(packages.map(id => packagePlan(root, rootPackage, id)));
  if (action === "plan") {
    console.log(
      JSON.stringify(
        { schemaVersion: 1, action, root, complete: plans.every(plan => plan.status === "ready"), packages: plans },
        null,
        2,
      ),
    );
    return 0;
  }
  const blocked = plans.filter(plan => plan.status !== "ready");
  if (blocked.length) {
    console.log(JSON.stringify({ schemaVersion: 1, action, root, complete: false, packages: plans }, null, 2));
    return 1;
  }
  const config = await loadConfig(root);
  assertRuntimeFacts(config.runtime, currentRuntimeFacts());
  const results: Array<Record<string, unknown>> = [];
  for (const plan of plans) results.push(await buildPackage(root, plan));
  const complete = results.every(result => result.status === "built");
  console.log(JSON.stringify({ schemaVersion: 1, action, root, complete, packages: results }, null, 2));
  return complete ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then(code => (process.exitCode = code))
    .catch(error => {
      console.error(
        JSON.stringify({
          code: "PACKAGE_BUILD_OWNER_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exitCode = 1;
    });
}
