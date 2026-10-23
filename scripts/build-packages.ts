#!/usr/bin/env bun
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertRuntimeFacts, currentRuntimeFacts, hashFile, loadConfig, repositoryRoot } from "@aphrody/bun-workspace";
import { runProcess } from "@aphrody/bun-workspace/process";

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
  entries: Array<{
    export: string;
    source: string;
    sha256: string;
    typesSource: string;
    typesSHA256: string;
  }>;
  diagnostics: Diagnostic[];
  existing?: { schemaVersion: number; treeHash: string; identityKey?: string };
  disposition?: "compile" | "recompile" | "reuse";
};

const usage = `Usage: bun scripts/build-packages.ts <plan|build> --package <paths|ovh|kernel-client> [--package ...]
Select every package explicitly. Outputs are written only to build/packages/<package>.
Build records compiled JavaScript only; it never executes or deploys the output.`;
/** The one product version every package, receipt and the root manifest carry. */
const productVersion: unknown = (await Bun.file(join(repositoryRoot, "package.json")).json()).version;
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
    for await (const manifest of manifestGlob.scan({
      cwd: root,
      onlyFiles: true,
    })) {
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
        typesSHA256: await hashFile(typesSource, {
          maxBytes: 20 * 1024 * 1024,
        }),
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
    if (!(await missing(outputDir))) {
      const owned = await inspectOwnedOutput(root, result, outputDir);
      result.existing = {
        schemaVersion: owned.receipt.schemaVersion,
        treeHash: owned.treeHash,
        identityKey: owned.receipt.identity?.key,
      };
    }
  } catch (error) {
    diagnostics.push(fail("OUTPUT_PATH_INVALID", error instanceof Error ? error.message : String(error), outputPath));
  }

  result.status = diagnostics.length === 0 ? "ready" : "blocked";
  if (result.status === "ready") {
    try {
      const identity = await captureIdentity(root, result);
      result.disposition = !result.existing
        ? "compile"
        : result.existing.schemaVersion === 2 && result.existing.identityKey === identity.key
          ? "reuse"
          : "recompile";
    } catch (error) {
      diagnostics.push(
        fail("BUILD_IDENTITY_INVALID", error instanceof Error ? error.message : String(error), packagePath),
      );
      result.status = "blocked";
    }
  }
  return result;
}

type SourceSnapshot = Map<string, { sha256: string; bytes: number }>;
type FileProof = { path: string; sha256: string; bytes: number };
type ReceiptEntry = {
  export: string;
  path: string;
  sha256: string;
  typesPath: string;
  typesSHA256: string;
};
const buildOptions = {
  naming: {
    entry: "[dir]/[name].js",
    chunk: "chunk-[hash].js",
    asset: "asset-[name]-[hash]",
  },
  target: "bun",
  packages: "external",
  metafile: true,
  sourcemap: "none",
} as const;
const rootInputFiles = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "aphrody.config.json",
  "bunfig.toml",
  "scripts/build-packages.ts",
];
type BuildIdentity = {
  key: string;
  inputs: {
    packageSnapshot: FileProof[];
    ownerSnapshot: FileProof[];
    rootFiles: Array<{
      path: string;
      sha256: string | null;
      bytes: number | null;
    }>;
    runtime: { facts: ReturnType<typeof currentRuntimeFacts>; sha256: string };
    entries: ReceiptEntry[];
    options: typeof buildOptions;
  };
};
type Receipt = {
  schemaVersion: 1 | 2;
  package: { id: PackageId; name: string; version: string };
  source: { packagePath: string; entries: ReceiptEntry[]; inputs: FileProof[] };
  outputs: Array<FileProof & { kind: string }>;
  qualification: { compiledJS: boolean; executed: false; deployed: false };
  createdAt: string;
  identity?: BuildIdentity;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(canonical(value)).digest("hex");
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || canonical(Object.keys(value).sort()) !== canonical(keys.sort()))
    throw new Error("Receipt has unknown or missing fields.");
}
function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validPath(path: unknown, prefix: string): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${prefix}/`) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every(part => part && part !== "." && part !== "..")
  );
}
function rows(value: unknown, prefix: string, output = false): void {
  if (!Array.isArray(value) || !value.length || value.length > 4096) throw new Error("Receipt file ledger is invalid.");
  const seen = new Set<string>();
  for (const item of value) {
    exact(item, output ? ["path", "sha256", "bytes", "kind"] : ["path", "sha256", "bytes"]);
    if (
      !validPath(item.path, prefix) ||
      !sha(item.sha256) ||
      typeof item.bytes !== "number" ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      seen.has(item.path)
    )
      throw new Error("Receipt file proof is invalid.");
    if (output && !["entry-point", "chunk", "asset", "sourcemap"].includes(String(item.kind)))
      throw new Error("Unknown output artifact kind.");
    seen.add(item.path);
  }
}
function entries(value: unknown, prefix: string): void {
  if (!Array.isArray(value) || !value.length || value.length > 256) throw new Error("Receipt exports are invalid.");
  const seen = new Set<string>();
  for (const item of value) {
    exact(item, ["export", "path", "sha256", "typesPath", "typesSHA256"]);
    if (
      typeof item.export !== "string" ||
      (item.export !== "." && !item.export.startsWith("./")) ||
      seen.has(item.export) ||
      !validPath(item.path, prefix) ||
      !validPath(item.typesPath, prefix) ||
      !sha(item.sha256) ||
      !sha(item.typesSHA256)
    )
      throw new Error("Receipt export proof is invalid.");
    seen.add(item.export);
  }
}
function validateReceipt(value: unknown, plan: PackagePlan): Receipt {
  if (!record(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2))
    throw new Error("Unknown output receipt version.");
  exact(value, [
    "schemaVersion",
    "package",
    "source",
    "outputs",
    "qualification",
    "createdAt",
    ...(value.schemaVersion === 2 ? ["identity"] : []),
  ]);
  exact(value.package, ["id", "name", "version"]);
  if (value.package.id !== plan.id || value.package.name !== plan.name || value.package.version !== productVersion)
    throw new Error("Receipt belongs to another package owner.");
  exact(value.source, ["packagePath", "entries", "inputs"]);
  if (value.source.packagePath !== plan.packagePath) throw new Error("Receipt source owner differs.");
  entries(value.source.entries, plan.packagePath);
  rows(value.source.inputs, plan.packagePath);
  rows(value.outputs, plan.outputPath, true);
  exact(value.qualification, ["compiledJS", "executed", "deployed"]);
  if (
    value.qualification.compiledJS !== true ||
    value.qualification.executed !== false ||
    value.qualification.deployed !== false ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error("Receipt has no valid prior compilation attestation.");
  const parsed = value as unknown as Receipt;
  const expectedEntries = parsed.source.entries
    .map(
      entry =>
        `${plan.outputPath}/${entry.path.slice(plan.packagePath.length + 1).replace(/\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/, ".js")}`,
    )
    .sort();
  if (
    canonical(expectedEntries) !==
    canonical(
      parsed.outputs
        .filter(item => item.kind === "entry-point")
        .map(item => item.path)
        .sort(),
    )
  )
    throw new Error("Receipt entry outputs do not match its exports.");
  for (const entry of parsed.source.entries)
    if (!parsed.source.inputs.some(input => input.path === entry.path && input.sha256 === entry.sha256))
      throw new Error("Receipt entry lacks a compiler input proof.");
  if (value.schemaVersion === 2) {
    exact(value.identity, ["key", "inputs"]);
    if (!sha(value.identity.key)) throw new Error("Invalid build identity hash.");
    exact(value.identity.inputs, ["packageSnapshot", "ownerSnapshot", "rootFiles", "runtime", "entries", "options"]);
    const identityInputs = value.identity.inputs;
    rows(identityInputs.packageSnapshot, plan.packagePath);
    rows(identityInputs.ownerSnapshot, "packages/bun-workspace");
    entries(identityInputs.entries, plan.packagePath);
    if (
      canonical(identityInputs.entries) !== canonical(value.source.entries) ||
      canonical(identityInputs.options) !== canonical(buildOptions)
    )
      throw new Error("Receipt compiler options or entries differ.");
    if (!Array.isArray(identityInputs.rootFiles) || identityInputs.rootFiles.length !== rootInputFiles.length)
      throw new Error("Root input proofs are incomplete.");
    const rootPaths = new Set<string>();
    for (const row of identityInputs.rootFiles) {
      exact(row, ["path", "sha256", "bytes"]);
      if (
        typeof row.path !== "string" ||
        !rootInputFiles.includes(row.path) ||
        rootPaths.has(row.path) ||
        !(
          (sha(row.sha256) && typeof row.bytes === "number" && Number.isSafeInteger(row.bytes) && row.bytes >= 0) ||
          (row.sha256 === null && row.bytes === null)
        )
      )
        throw new Error("Root input proof is invalid.");
      rootPaths.add(row.path);
    }
    exact(identityInputs.runtime, ["facts", "sha256"]);
    exact(identityInputs.runtime.facts, ["version", "revision", "sourceUrl", "executable"]);
    const facts = identityInputs.runtime.facts;
    if (
      !sha(identityInputs.runtime.sha256) ||
      typeof facts.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(facts.version) ||
      typeof facts.revision !== "string" ||
      !/^[a-f0-9]{40}$/.test(facts.revision) ||
      typeof facts.executable !== "string" ||
      !isAbsolute(facts.executable) ||
      (facts.sourceUrl !== null && typeof facts.sourceUrl !== "string") ||
      digest(identityInputs) !== value.identity.key
    )
      throw new Error("Receipt runtime or identity is invalid.");
    const sourceRows = parsed.identity!.inputs.packageSnapshot;
    for (const input of parsed.source.inputs)
      if (!sourceRows.some(row => canonical(row) === canonical(input)))
        throw new Error("Compiler input is outside the identity snapshot.");
  }
  return parsed;
}

async function captureIdentity(root: string, plan: PackagePlan): Promise<BuildIdentity> {
  const config = await loadConfig(root);
  const facts = currentRuntimeFacts();
  assertRuntimeFacts(config.runtime, facts);
  const ledger = (snapshot: SourceSnapshot): FileProof[] =>
    [...snapshot]
      .map(([path, item]) => ({ path: relativePath(root, path), ...item }))
      .sort((a, b) => a.path.localeCompare(b.path));
  const rootFiles = [];
  for (const path of rootInputFiles) {
    const absolute = resolve(root, path);
    await assertNoSymlinkComponents(root, absolute);
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile()) throw new Error("Root compiler input is not a regular file.");
      rootFiles.push({
        path,
        sha256: await hashFile(absolute, {
          maxBytes: maxSnapshotFileBytes,
          expectedBytes: metadata.size,
        }),
        bytes: metadata.size,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path !== "bunfig.toml") throw error;
      rootFiles.push({ path, sha256: null, bytes: null });
    }
  }
  const inputs: BuildIdentity["inputs"] = {
    packageSnapshot: ledger(await snapshotPackageSources(resolve(root, plan.packagePath))),
    ownerSnapshot: ledger(await snapshotPackageSources(join(root, "packages/bun-workspace"))),
    rootFiles,
    runtime: {
      facts,
      sha256: await hashFile(facts.executable, { maxBytes: 512 * 1024 * 1024 }),
    },
    entries: plan.entries.map(entry => ({
      export: entry.export,
      path: relativePath(root, entry.source),
      sha256: entry.sha256,
      typesPath: relativePath(root, entry.typesSource),
      typesSHA256: entry.typesSHA256,
    })),
    options: buildOptions,
  };
  for (const entry of inputs.entries) {
    if (
      !inputs.packageSnapshot.some(row => row.path === entry.path && row.sha256 === entry.sha256) ||
      !inputs.packageSnapshot.some(row => row.path === entry.typesPath && row.sha256 === entry.typesSHA256)
    )
      throw new Error("Entry source changed after planning.");
  }
  return { key: digest(inputs), inputs };
}

async function inspectOwnedOutput(
  root: string,
  plan: PackagePlan,
  directory: string,
): Promise<{ receipt: Receipt; treeHash: string }> {
  await assertNoSymlinkComponents(root, directory);
  if (!(await lstat(directory)).isDirectory() || !inside(root, await realpath(directory)))
    throw new Error("Output directory is not a real owned directory.");
  const receiptPath = join(directory, "build-receipt.json");
  await assertNoSymlinkComponents(root, receiptPath);
  const receiptFile = Bun.file(receiptPath);
  if (receiptFile.size > 2 * 1024 * 1024) throw new Error("Output receipt exceeds its limit.");
  const receiptBytes = await receiptFile.arrayBuffer();
  if (receiptBytes.byteLength > 2 * 1024 * 1024) throw new Error("Output receipt exceeds its limit.");
  const receiptHash = new Bun.CryptoHasher("sha256").update(receiptBytes).digest("hex");
  const receipt = validateReceipt(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes)), plan);
  const expected = new Map(receipt.outputs.map(item => [item.path.slice(plan.outputPath.length + 1), item]));
  if (expected.has("build-receipt.json")) throw new Error("Receipt cannot declare itself as an artifact.");
  const expectedDirectories = new Set<string>();
  for (const path of expected.keys())
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent))
      expectedDirectories.add(parent.replaceAll("\\", "/"));
  const found: FileProof[] = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      await assertNoSymlinkComponents(root, path);
      const metadata = await lstat(path);
      const local = relativePath(directory, path);
      if (metadata.isDirectory()) {
        if (!expectedDirectories.has(local)) throw new Error("Output tree contains an undeclared directory.");
        pending.push(path);
      } else if (metadata.isFile()) {
        const item = expected.get(local);
        if (local !== "build-receipt.json" && !item) throw new Error("Output tree contains a foreign file.");
        const hash = await hashFile(path, {
          maxBytes: 200 * 1024 * 1024,
          expectedBytes: item?.bytes ?? metadata.size,
        });
        if (item && hash !== item.sha256) throw new Error("Output artifact hash differs from its receipt.");
        if (local === "build-receipt.json" && (hash !== receiptHash || metadata.size !== receiptBytes.byteLength))
          throw new Error("Receipt changed during output verification.");
        found.push({ path: local, sha256: hash, bytes: metadata.size });
      } else throw new Error("Output tree contains a non-regular node.");
    }
  }
  if (found.length !== expected.size + 1) throw new Error("Output tree is incomplete.");
  return {
    receipt,
    treeHash: digest(found.sort((a, b) => a.path.localeCompare(b.path))),
  };
}

async function snapshotPackageSources(packageDir: string): Promise<SourceSnapshot> {
  const snapshot: SourceSnapshot = new Map();
  let totalBytes = 0;
  const pending = [packageDir];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(entry.name)) continue;
      if (/^(?:\.env(?:\..*)?|\.ovh\.conf|credentials(?:\..*)?|profiles\.json)$/i.test(entry.name))
        throw new Error("Protected configuration is outside the package compiler snapshot contract.");
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Package source tree contains a symlink: ${path}`);
      if (metadata.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!metadata.isFile()) continue;
      const sha256 = await hashFile(path, {
        maxBytes: maxSnapshotFileBytes,
        expectedBytes: metadata.size,
      });
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

async function compilePackage(
  root: string,
  plan: PackagePlan,
  outputDir: string,
  expectedIdentity: string,
): Promise<Record<string, unknown>> {
  const packageDir = resolve(root, plan.packagePath);
  if (resolve(process.cwd()) !== root)
    throw new Error("Run package builds from the Bun OS repository root so metafile paths have a stable base.");
  const identity = await captureIdentity(root, plan);
  if (identity.key !== expectedIdentity) throw new Error("Compiler inputs changed before the bounded worker started.");
  const inputSnapshot = await snapshotPackageSources(packageDir);
  for (const entry of plan.entries) {
    const initial = inputSnapshot.get(entry.source);
    const typeInitial = inputSnapshot.get(entry.typesSource);
    if (!initial || initial.sha256 !== entry.sha256 || !typeInitial || typeInitial.sha256 !== entry.typesSHA256)
      throw new Error(`Package entry changed after planning: ${entry.export}`);
  }
  await assertNoSymlinkComponents(root, dirname(outputDir));
  await mkdir(outputDir);
  await assertNoSymlinkComponents(root, outputDir);
  const result = await Bun.build({
    entrypoints: plan.entries.map(entry => entry.source),
    outdir: outputDir,
    root: packageDir,
    ...buildOptions,
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
    const sha256 = await hashFile(source, {
      maxBytes: maxSnapshotFileBytes,
      expectedBytes: metadata.bytes,
    });
    if (sha256 !== before.sha256) throw new Error(`Bundler input changed while compiling: ${input}`);
    inputHashes.push({
      path: relativePath(root, source),
      sha256,
      bytes: metadata.bytes,
    });
  }

  const outputs: Array<{
    path: string;
    sha256: string;
    bytes: number;
    kind: string;
  }> = [];
  let compiledJS = false;
  for (const artifact of result.outputs) {
    const path = await resolveBuildOutput(root, outputDir, artifact.path);
    const sha256 = await hashFile(path, { maxBytes: 200 * 1024 * 1024 });
    const bytes = Bun.file(path).size;
    if (artifact.kind === "entry-point" && /\.(?:js|mjs|cjs)$/.test(path)) compiledJS = true;
    outputs.push({
      path: `${plan.outputPath}/${relativePath(outputDir, path)}`,
      sha256,
      bytes,
      kind: artifact.kind,
    });
  }
  if (!compiledJS) throw new Error("Bun.build produced no JavaScript entry-point artifact.");

  const receipt = {
    schemaVersion: 2,
    package: { id: plan.id, name: plan.name, version: productVersion },
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
    identity,
    qualification: { compiledJS, executed: false, deployed: false },
    createdAt: new Date().toISOString(),
  };
  validateReceipt(receipt, plan);
  if ((await captureIdentity(root, plan)).key !== identity.key)
    throw new Error("Build inputs changed while compiling.");
  const receiptPath = join(outputDir, "build-receipt.json");
  await assertNoSymlinkComponents(root, receiptPath);
  const receiptHandle = await open(receiptPath, "wx", 0o600);
  try {
    await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await receiptHandle.close();
  }
  await inspectOwnedOutput(root, plan, outputDir);
  return {
    id: plan.id,
    name: plan.name,
    status: "built",
    receipt: `${plan.outputPath}/build-receipt.json`,
    outputs,
    diagnostics,
    qualification: receipt.qualification,
  };
}

async function guardOwnedMutation(root: string, id: PackageId, path: string): Promise<void> {
  const base = resolve(root, "build/packages");
  const local = relativePath(base, resolve(path));
  const stage = new RegExp(
    `^\\.stage-${id}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:/(?:payload|prior|lease.json))?$`,
  );
  if (local !== id && local !== `.${id}.lock` && !stage.test(local))
    throw new Error("Mutation is outside this package owner's exact paths.");
  await assertNoSymlinkComponents(root, path);
  const parent = await realpath(dirname(path));
  const actualBase = await realpath(base);
  if (!inside(root, actualBase) || !inside(actualBase, parent, true))
    throw new Error("Mutation parent resolves outside root build/packages.");
}
async function missing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
async function moveOwned(root: string, id: PackageId, from: string, to: string): Promise<void> {
  await guardOwnedMutation(root, id, from);
  await guardOwnedMutation(root, id, to);
  if (!(await missing(to))) throw new Error("Refusing to overwrite an existing move destination.");
  await rename(from, to);
  await guardOwnedMutation(root, id, to);
}
async function removeOwnedOutput(root: string, plan: PackagePlan, path: string, expectedTree: string): Promise<void> {
  await guardOwnedMutation(root, plan.id, path);
  if ((await inspectOwnedOutput(root, plan, path)).treeHash !== expectedTree)
    throw new Error("Owned output changed before removal.");
  await guardOwnedMutation(root, plan.id, path);
  await rm(path, { recursive: true });
}
async function removeEmptyStage(root: string, plan: PackagePlan, stage: string, lease: string): Promise<void> {
  await guardOwnedMutation(root, plan.id, stage);
  const names = await readdir(stage);
  if (names.length !== 1 || names[0] !== "lease.json" || (await Bun.file(join(stage, "lease.json")).text()) !== lease)
    throw new Error("Staging contains unqualified files; preservation is required.");
  await guardOwnedMutation(root, plan.id, join(stage, "lease.json"));
  await unlink(join(stage, "lease.json"));
  await guardOwnedMutation(root, plan.id, stage);
  // The sole owned lease has been removed; no foreign or previous outputs remain.
  if ((await readdir(stage)).length) throw new Error("Staging changed before empty removal.");
  await rmdir(stage);
}
async function releasePackageLock(root: string, plan: PackagePlan, lockPath: string, nonce: string): Promise<void> {
  await guardOwnedMutation(root, plan.id, lockPath);
  if ((await Bun.file(lockPath).text()) !== nonce) throw new Error("Package lock ownership changed; lock preserved.");
  await unlink(lockPath);
}
async function buildPackage(root: string, plan: PackagePlan): Promise<Record<string, unknown>> {
  if (resolve(process.cwd()) !== root) throw new Error("Run package builds from the repository root.");
  const outputDir = resolve(root, plan.outputPath);
  await assertNoSymlinkComponents(root, dirname(outputDir));
  await mkdir(dirname(outputDir), { recursive: true });
  const lockPath = join(dirname(outputDir), `.${plan.id}.lock`);
  await guardOwnedMutation(root, plan.id, lockPath);
  const lock = await open(lockPath, "wx", 0o600);
  const nonce = crypto.randomUUID();
  await lock.writeFile(nonce);
  let stage: string | undefined;
  let lease: string | undefined;
  let outcome: Record<string, unknown> | undefined;
  let failure: Error | undefined;
  try {
    outcome = await (async () => {
      const identity = await captureIdentity(root, plan);
      const exists = !(await missing(outputDir));
      const old = exists ? await inspectOwnedOutput(root, plan, outputDir) : undefined;
      if (old?.treeHash !== plan.existing?.treeHash) throw new Error("Output changed after planning.");
      if (old?.receipt.schemaVersion === 2 && old.receipt.identity?.key === identity.key) {
        if (
          (await captureIdentity(root, plan)).key !== identity.key ||
          (await inspectOwnedOutput(root, plan, outputDir)).treeHash !== old.treeHash
        )
          throw new Error("Reuse inputs or outputs changed during verification.");
        return {
          id: plan.id,
          name: plan.name,
          status: "reused",
          compiledThisRun: false,
          receipt: `${plan.outputPath}/build-receipt.json`,
          attestedAt: old.receipt.createdAt,
          outputs: old.receipt.outputs,
          qualification: old.receipt.qualification,
        };
      }
      stage = join(dirname(outputDir), `.stage-${plan.id}-${crypto.randomUUID()}`);
      await guardOwnedMutation(root, plan.id, stage);
      await mkdir(stage);
      lease = JSON.stringify({
        schemaVersion: 1,
        id: plan.id,
        identityKey: identity.key,
      });
      const leasePath = join(stage, "lease.json");
      await guardOwnedMutation(root, plan.id, leasePath);
      const leaseHandle = await open(leasePath, "wx", 0o600);
      try {
        await leaseHandle.writeFile(lease);
      } finally {
        await leaseHandle.close();
      }
      const worker = await runProcess(
        [process.execPath, import.meta.path, "_compile-package", plan.id, stage, identity.key],
        root,
        { timeoutMs: 30000, maxOutputBytes: 2 * 1024 * 1024 },
      );
      if (worker.code !== 0)
        throw new Error("Bounded package compiler failed; unqualified staging is preserved for review.");
      const payload = join(stage, "payload");
      const candidate = await inspectOwnedOutput(root, plan, payload);
      if (candidate.receipt.identity?.key !== identity.key || (await captureIdentity(root, plan)).key !== identity.key)
        throw new Error("Staged output does not match stable compiler inputs.");
      if (old) {
        if ((await inspectOwnedOutput(root, plan, outputDir)).treeHash !== old.treeHash)
          throw new Error("Previous output changed before replacement.");
        await moveOwned(root, plan.id, outputDir, join(stage, "prior"));
      } else if (!(await missing(outputDir))) throw new Error("Foreign output appeared before installation.");
      await moveOwned(root, plan.id, payload, outputDir);
      const installed = await inspectOwnedOutput(root, plan, outputDir);
      if (
        installed.treeHash !== candidate.treeHash ||
        installed.receipt.identity?.key !== identity.key ||
        (await captureIdentity(root, plan)).key !== identity.key
      )
        throw new Error("Output switch failed verification; prior transient output is preserved.");
      if (old) await removeOwnedOutput(root, plan, join(stage, "prior"), old.treeHash);
      await removeEmptyStage(root, plan, stage, lease);
      stage = undefined;
      return {
        id: plan.id,
        name: plan.name,
        status: "built",
        compiledThisRun: true,
        receipt: `${plan.outputPath}/build-receipt.json`,
        outputs: installed.receipt.outputs,
        qualification: installed.receipt.qualification,
      };
    })();
  } catch (error) {
    const preservedStaging = stage ? relativePath(root, stage) : undefined;
    failure = new Error(
      `${error instanceof Error ? error.message : String(error)}${preservedStaging ? ` Preserved transient staging: ${preservedStaging}` : ""}`,
    );
  } finally {
    try {
      await lock.close();
      await releasePackageLock(root, plan, lockPath, nonce);
    } catch (error) {
      const cleanup = error instanceof Error ? error.message : "Package lock cleanup failed.";
      failure = new Error(failure ? `${failure.message} ${cleanup}` : cleanup);
    }
  }
  if (failure) throw failure;
  if (!outcome) throw new Error("Package build produced no result.");
  return outcome;
}

async function compileWorker(root: string, args: string[], rootPackage: Record<string, unknown>): Promise<number> {
  if (args.length !== 3 || !Object.hasOwn(packageSpecs, args[0]!) || !sha(args[2]))
    throw new Error("Invalid internal compiler selection.");
  const id = args[0] as PackageId;
  const stage = resolve(args[1]!);
  const identityKey = args[2]!;
  await guardOwnedMutation(root, id, stage);
  if (
    !relativePath(resolve(root, "build/packages"), stage).startsWith(`.stage-${id}-`) ||
    !(await lstat(stage)).isDirectory()
  )
    throw new Error("Worker requires its exclusive stage directory.");
  await guardOwnedMutation(root, id, join(stage, "lease.json"));
  const leaseMetadata = await lstat(join(stage, "lease.json"));
  if (!leaseMetadata.isFile() || leaseMetadata.size > 4096)
    throw new Error("Worker lease is not a bounded regular file.");
  const lease = await Bun.file(join(stage, "lease.json")).json();
  exact(lease, ["schemaVersion", "id", "identityKey"]);
  if (
    lease.schemaVersion !== 1 ||
    lease.id !== id ||
    lease.identityKey !== identityKey ||
    canonical((await readdir(stage)).sort()) !== canonical(["lease.json"])
  )
    throw new Error("Worker stage lease is invalid or contains foreign files.");
  const plan = await packagePlan(root, rootPackage, id);
  if (plan.status !== "ready") throw new Error("Worker package preflight failed.");
  const result = await compilePackage(root, plan, join(stage, "payload"), identityKey);
  return result.status === "built" ? 0 : 1;
}

function parseArgs(args: string[]): {
  action: "plan" | "build";
  packages: PackageId[];
} {
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
  const root = await realpath(repositoryRoot);
  const rootPackage = await Bun.file(join(root, "package.json")).json();
  if (!record(rootPackage) || typeof rootPackage.version !== "string" || !/^d+.d+.d+$/.test(rootPackage.version))
    throw new Error("Root Bun package version must be a release version.");
  if (Bun.argv[2] === "_compile-package") return compileWorker(root, Bun.argv.slice(3), rootPackage);
  const { action, packages } = parseArgs(Bun.argv.slice(2));
  const plans = await Promise.all(packages.map(id => packagePlan(root, rootPackage, id)));
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          action,
          root,
          complete: plans.every(plan => plan.status === "ready"),
          packages: plans,
        },
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
  const complete = results.every(result => result.status === "built" || result.status === "reused");
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
