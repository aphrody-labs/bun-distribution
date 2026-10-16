// SPDX-License-Identifier: Apache-2.0
//
// Bun-native reference implementation of the Agent Home content revision
// `sha256-v1` (owner: crates/ai/agent-home/src/revision.rs). The algorithm is
// documented there and in docs/reference/ai/AGENT-HOME.md; both sides share
// one golden vector (test/agent-home-revision.test.ts and the Rust unit test).
// No FFI, no subprocess: SHA-256 comes from Bun.CryptoHasher.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const REVISION_ALGORITHM = "sha256-v1";

/** Directory names never part of the home content (any depth). */
export const EXCLUDED_DIRS: readonly string[] = [
  ".aphrody",
  ".git",
  ".coord",
  "db",
  "cache",
  "locks",
  "logs",
  "sessions",
  "node_modules",
];

/** File-name suffixes never part of the home content. */
export const EXCLUDED_SUFFIXES: readonly string[] = [
  ".tmp",
  ".lock",
  ".sqlite",
  ".sqlite-wal",
  ".sqlite-shm",
  ".db",
  ".db-wal",
  ".db-shm",
  "-journal",
];

export interface FileDigest {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface HomeRevision {
  readonly algorithm: string;
  readonly revision: string;
  readonly files: FileDigest[];
}

function sha256Hex(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

const encoder = new TextEncoder();

/** Byte-wise comparison of the UTF-8 encodings (the Rust sort order). */
function compareUtf8(a: string, b: string): number {
  return Buffer.compare(
    Buffer.from(encoder.encode(a)),
    Buffer.from(encoder.encode(b)),
  );
}

/** Content files of `root` (relative `/` paths), sorted by UTF-8 bytes. Symlinks are skipped. */
export function contentFiles(root: string): string[] {
  const out: string[] = [];
  const stack: Array<[string, string]> = [[root, ""]];
  while (stack.length > 0) {
    const [dir, prefix] = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (/[\r\n]/.test(name))
        throw new Error(`home content path contains a line break: ${name}`);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(name)) stack.push([join(dir, name), rel]);
      } else if (
        entry.isFile() &&
        !EXCLUDED_SUFFIXES.some((s) => name.endsWith(s))
      ) {
        out.push(rel);
      }
    }
  }
  return out.toSorted(compareUtf8);
}

/** `sha256-v1:` + SHA-256 of the manifest `<sha256> <size> <path>\n` per entry, in the given order. */
export function manifestRevision(files: readonly FileDigest[]): string {
  const manifest = files
    .map((f) => `${f.sha256} ${f.size} ${f.path}\n`)
    .join("");
  return `${REVISION_ALGORITHM}:${sha256Hex(manifest)}`;
}

/** The `sha256-v1` revision of the Agent Home at `root`, identical to `aphrody agent-home revision`. */
export function homeRevision(root: string): HomeRevision {
  if (!statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const files = contentFiles(root).map((path) => {
    const bytes = readFileSync(join(root, ...path.split("/")));
    return { path, size: bytes.byteLength, sha256: sha256Hex(bytes) };
  });
  return {
    algorithm: REVISION_ALGORITHM,
    revision: manifestRevision(files),
    files,
  };
}

/**
 * `SyncSnapshot.revision_sha256`: the same manifest over the seven synchronised documents, in contract
 * order (crates/ai/agent-home/sync-contract.json), without sorting.
 */
export function syncRevision(
  root: string,
  documents: readonly string[],
): string {
  return manifestRevision(
    documents.map((name) => {
      const bytes = readFileSync(join(root, name));
      return { path: name, size: bytes.byteLength, sha256: sha256Hex(bytes) };
    }),
  );
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: bun agent-home-revision.ts <home-dir> [--files]");
    process.exit(2);
  }
  const rev = homeRevision(root);
  const out = process.argv.includes("--files")
    ? rev
    : {
        algorithm: rev.algorithm,
        revision: rev.revision,
        file_count: rev.files.length,
      };
  console.log(JSON.stringify(out, null, 2));
}
