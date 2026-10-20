// SPDX-License-Identifier: MIT
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sourceIntegrity } from "./source-integrity.ts";
type FileIdentity = { sha256: string; bytes: number };
export type SourceEntry = [string, "directory"] | [string, "symlink", string] | [string, "file", number, string];
type LinuxTarget = "linux-x64" | "linux-arm64";

export interface ProductPayloadReceipt {
  schemaVersion: 1;
  kind: "bun-os-product-payload";
  root: "sources/bun-os";
  sourceRepository: "aphrody-labs/bun-distribution";
  sourceRevision: string;
  target: LinuxTarget;
  runtime: { revision: string; version: string; sha256: string; bytes: number };
  lock: FileIdentity;
  sourceReceipt: FileIdentity;
  sourceEntries: SourceEntry[];
  preparedInputs: { path: string; sha256: string; bytes: number; sourceRevision: string }[];
  sourceTreeSHA256: string;
  installedTreeSHA256: string;
  installedModesSHA256: string;
  commands: number;
  install: { passed: true; frozenLockfile: true; lifecycleScripts: false };
  qualification: { productCli: false; nativeCommands: false; fullProduct: false };
}

export function productPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`Invalid product path: ${path}`);
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Product path escapes its root: ${path}`);
  return absolute;
}

export async function productIdentity(path: string): Promise<FileIdentity> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Expected regular product input: ${path}`);
  const file = Bun.file(path);
  const hash = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of file.stream()) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  if (bytes !== entry.size) throw new Error(`Product file changed while hashing: ${path}`);
  return { bytes, sha256: hash.digest("hex") };
}

export const sameProductIdentity = (a: FileIdentity, b: FileIdentity) => a.bytes === b.bytes && a.sha256 === b.sha256;

/** Capture original entries, including tracked node_modules fixtures, before installing dependencies. */
export async function sourceEntries(root: string): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  async function visit(prefix: string) {
    const children = await readdir(join(root, prefix), { withFileTypes: true });
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const child of children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) {
        entries.push([path, "directory"]);
        await visit(path);
      } else if (child.isSymbolicLink()) entries.push([path, "symlink", await readlink(join(root, path))]);
      else if (child.isFile()) {
        const file = await productIdentity(join(root, path));
        entries.push([path, "file", file.bytes, file.sha256]);
      } else throw new Error(`Unsupported product source: ${path}`);
    }
  }
  await visit("");
  return entries;
}

/** Product permissions are separate from the established byte/source checksum contract. */
export async function productModesSHA256(root: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Product modes require a real root directory");
  hash.update(JSON.stringify([".", "directory", rootStat.mode & 0o7777]) + "\n");
  async function visit(prefix: string) {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        hash.update(JSON.stringify([path, "directory", stat.mode & 0o7777]) + "\n");
        await visit(path);
      } else if (stat.isFile()) hash.update(JSON.stringify([path, "file", stat.mode & 0o7777]) + "\n");
      else throw new Error(`Unsupported product permissions entry: ${path}`);
    }
  }
  await visit("");
  return hash.digest("hex");
}

export function entryTreeHash(entries: SourceEntry[]): string {
  const tree = new Bun.CryptoHasher("sha256");
  for (const entry of entries) tree.update(JSON.stringify(entry) + "\n");
  return tree.digest("hex");
}

export async function verifySourceEntries(root: string, entries: SourceEntry[]) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || seen.has(entry[0]))
      throw new Error("Invalid or duplicate product source entry");
    const path = productPath(root, entry[0]);
    seen.add(entry[0]);
    const stat = await lstat(path);
    if (entry[1] === "directory" && entry.length === 2 && stat.isDirectory() && !stat.isSymbolicLink()) continue;
    if (entry[1] === "symlink" && entry.length === 3 && stat.isSymbolicLink() && await readlink(path) === entry[2]) continue;
    if (entry[1] === "file" && entry.length === 4 && sameProductIdentity(await productIdentity(path), { bytes: entry[2], sha256: entry[3] })) continue;
    throw new Error(`Frozen product source changed: ${entry[0]}`);
  }
}

/** Preserve frozen source fixture links without dereferencing; installed links must be relocatable. */
export async function verifyLinks(root: string, sources: SourceEntry[]) {
  const originalLinks = new Map<string, string>();
  for (const entry of sources) if (entry[1] === "symlink") originalLinks.set(entry[0], entry[2]);
  async function visit(prefix: string) {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(root, path);
      if (entry.isSymbolicLink()) {
        const target = await readlink(absolute);
        if (originalLinks.has(path)) {
          if (originalLinks.get(path) !== target) throw new Error(`Frozen source symlink changed: ${path}`);
          continue;
        }
        if (isAbsolute(target)) throw new Error(`Absolute product symlink: ${path}`);
        const physical = await realpath(absolute);
        const rel = relative(root, physical);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
          throw new Error(`Product symlink escapes workspace: ${path}`);
      } else if (entry.isDirectory()) await visit(path);
      else if (!entry.isFile()) throw new Error(`Unsupported installed product entry: ${path}`);
    }
  }
  await visit("");
}

/** Frozen install can add dependency trees and explicitly prepared archives, never new source. */
export async function verifyInstalledAdditions(root: string, sources: SourceEntry[], prepared: { path: string }[]) {
  const original = new Set(sources.map(entry => entry[0]));
  const allowed = new Set(prepared.flatMap(input => {
    const parts = input.path.split("/");
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }));
  async function visit(prefix: string) {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!original.has(path) && !allowed.has(path) && !path.split("/").includes("node_modules"))
        throw new Error(`Install added a non-dependency product path: ${path}`);
      if (entry.isDirectory()) await visit(path);
    }
  }
  await visit("");
}

/** Generated sidecars belong to an existing root workspace member and never replace source. */
export async function validatePreparedProductPath(root: string, path: string, sources: SourceEntry[]) {
  productPath(root, path);
  if (sources.some(entry => entry[0] === path)) throw new Error(`Prepared input replaces frozen source: ${path}`);
  if (/^build\/packages\/[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(path)) return;
  const parts = path.split("/");
  if (parts.length < 4 || parts[0] !== "packages" || !["dist", "wasm"].includes(parts[2]!) ||
    parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)))
    throw new Error(`Prepared input must be a package archive or workspace build sidecar: ${path}`);
  const member = parts.slice(0, 2).join("/");
  if (!sources.some(entry => entry[0] === `${member}/package.json` && entry[1] === "file"))
    throw new Error(`Prepared sidecar has no frozen workspace manifest: ${path}`);
  const workspace = await Bun.file(join(root, "package.json")).json() as {
    workspaces?: string[] | { packages?: string[] };
  };
  const members = Array.isArray(workspace.workspaces) ? workspace.workspaces : workspace.workspaces?.packages ?? [];
  if (!members.some(pattern => new Bun.Glob(pattern.replace(/\/$/, "")).match(member)))
    throw new Error(`Prepared sidecar does not belong to a declared root workspace member: ${path}`);
  if (parts[2] === "wasm") {
    const files = new Set([
      "aphrody_command_wasm.js",
      "aphrody_command_wasm.d.ts",
      "aphrody_command_wasm_bg.wasm",
      "aphrody_command_wasm_bg.wasm.d.ts",
      "provenance.json",
    ]);
    const manifest = await Bun.file(join(root, member, "package.json")).json() as {
      name?: string;
      imports?: Record<string, string>;
    };
    if (member !== "packages/cli-wasm" || manifest.name !== "@aphrody/cli-wasm" ||
      manifest.imports?.["#cli-wasm-glue"] !== "./wasm/aphrody_command_wasm.js" ||
      parts.length !== 4 || !files.has(parts[3]!))
      throw new Error(`Prepared WASM input is not a generated artifact of the declared CLI-WASM owner: ${path}`);
  }
}

export interface ProductPayloadExpected {
  target: string;
  runtime: { sha256: string; revision: string };
}

const CLI_WASM_INPUTS = [
  "packages/cli-wasm/wasm/aphrody_command_wasm.js",
  "packages/cli-wasm/wasm/aphrody_command_wasm.d.ts",
  "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm",
  "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm.d.ts",
  "packages/cli-wasm/wasm/provenance.json",
] as const;

/** The frozen product must carry the complete generated module set for its CLI-WASM owner. */
export async function validateProductWasmInputs(
  root: string,
  inputs: readonly { path: string }[],
): Promise<void> {
  const manifest = await Bun.file(join(root, "packages/cli-wasm/package.json")).json() as {
    name?: string;
    imports?: Record<string, string>;
  };
  if (manifest.name !== "@aphrody/cli-wasm" || manifest.imports?.["#cli-wasm-glue"] !== "./wasm/aphrody_command_wasm.js")
    throw new Error("Frozen product has an invalid CLI-WASM owner manifest");
  const paths = new Set(inputs.map(input => input.path));
  const missing = CLI_WASM_INPUTS.filter(path => !paths.has(path));
  if (missing.length) throw new Error(`Frozen product is missing required CLI-WASM inputs: ${missing.join(", ")}`);
}

/** Offline verification of a copied workspace and its separate producer receipt. */
export async function verifyProductPayload(
  payloadRoot: string,
  receiptPath: string,
  expected: ProductPayloadExpected,
): Promise<ProductPayloadReceipt> {
  expected = structuredClone(expected);
  if (!["linux-x64", "linux-arm64"].includes(expected.target) ||
    !/^[a-f0-9]{40}$/.test(expected.runtime?.revision) || !/^[a-f0-9]{64}$/.test(expected.runtime?.sha256))
    throw new Error("Product verification requires an exact Linux target and runtime identity");
  const root = resolve(payloadRoot);
  if (!(await lstat(root)).isDirectory() || await realpath(root) !== root)
    throw new Error("Product root must be a real directory");
  await productIdentity(receiptPath);
  const receipt: ProductPayloadReceipt = await Bun.file(receiptPath).json();
  if (receipt.schemaVersion !== 1 || receipt.kind !== "bun-os-product-payload" || receipt.root !== "sources/bun-os" ||
    receipt.sourceRepository !== "aphrody-labs/bun-distribution" || !/^[a-f0-9]{40}$/.test(receipt.sourceRevision) ||
    !["linux-x64", "linux-arm64"].includes(receipt.target) || receipt.target !== expected.target ||
    receipt.runtime?.revision !== expected.runtime.revision || receipt.runtime.sha256 !== expected.runtime.sha256 ||
    !/^[a-f0-9]{40}$/.test(receipt.runtime.revision) || !/^[a-f0-9]{64}$/.test(receipt.runtime.sha256) ||
    !Number.isSafeInteger(receipt.runtime.bytes) || receipt.runtime.bytes <= 0 ||
    typeof receipt.runtime.version !== "string" || !receipt.runtime.version ||
    !/^[a-f0-9]{64}$/.test(receipt.sourceTreeSHA256) || !/^[a-f0-9]{64}$/.test(receipt.installedTreeSHA256) ||
    !/^[a-f0-9]{64}$/.test(receipt.installedModesSHA256) ||
    !/^[a-f0-9]{64}$/.test(receipt.lock?.sha256) || !Number.isSafeInteger(receipt.lock.bytes) || receipt.lock.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(receipt.sourceReceipt?.sha256) || !Number.isSafeInteger(receipt.sourceReceipt.bytes) || receipt.sourceReceipt.bytes <= 0 ||
    receipt.install?.passed !== true || receipt.install.frozenLockfile !== true || receipt.install.lifecycleScripts !== false ||
    receipt.qualification?.productCli !== false || receipt.qualification.nativeCommands !== false || receipt.qualification.fullProduct !== false ||
    !Number.isSafeInteger(receipt.commands) || receipt.commands <= 0 || !Array.isArray(receipt.preparedInputs) ||
    !Array.isArray(receipt.sourceEntries) || !receipt.sourceEntries.length)
    throw new Error("Invalid product payload receipt; installation does not qualify the CLI");
  if (!sameProductIdentity(receipt.lock, await productIdentity(join(root, "bun.lock"))))
    throw new Error("Frozen product lockfile changed");
  if (entryTreeHash(receipt.sourceEntries) !== receipt.sourceTreeSHA256)
    throw new Error("Frozen product source inventory changed");
  await verifySourceEntries(root, receipt.sourceEntries);
  const preparedPaths = new Set<string>();
  for (const input of receipt.preparedInputs) {
    await validatePreparedProductPath(root, input.path, receipt.sourceEntries);
    if (preparedPaths.has(input.path) || input.sourceRevision !== receipt.sourceRevision ||
      !sameProductIdentity(input, await productIdentity(productPath(root, input.path))))
      throw new Error("Prepared product archive differs from its pinned inputs");
    preparedPaths.add(input.path);
  }
  await validateProductWasmInputs(root, receipt.preparedInputs);
  await verifyLinks(root, receipt.sourceEntries);
  await verifyInstalledAdditions(root, receipt.sourceEntries, receipt.preparedInputs);
  for (const file of ["src/cli.ts", "src/cli/main.ts", "src/cli/commands.ts", "package.json"])
    await productIdentity(productPath(root, file));
  const installed = await sourceIntegrity(root);
  if (installed.lfsPointers.length || installed.treeSHA256 !== receipt.installedTreeSHA256)
    throw new Error("Installed product tree differs from its receipt");
  if (await productModesSHA256(root) !== receipt.installedModesSHA256)
    throw new Error("Installed product file or directory permissions differ from their receipt");
  return receipt;
}
