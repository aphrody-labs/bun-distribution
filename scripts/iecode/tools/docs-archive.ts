#!/usr/bin/env bun
/** Full documentation snapshot with compact historical/research projections. */
import { existsSync, statSync, lstatSync, writeFileSync, mkdtempSync, renameSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { documentationSourceFiles } from "../validation/docs-files";

const root = resolve(import.meta.dir, "../../..");
const docsDir = join(root, "docs");
const archivePath = join(root, "docs.7z");
export const archivedDocPrefixes = ["docs/history/", "docs/research/"];

function run7z(args: string[], cwd = root): string {
  const command = Bun.which("7za") ?? Bun.which("7z");
  if (!command) throw new Error("Install 7-Zip to manage the documentation archive.");
  const result = Bun.spawnSync([command, ...args], { cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

export function listArchivedDocs(): string[] {
  if (!existsSync(archivePath)) return [];
  return run7z(["l", "-slt", "-ba", archivePath])
    .split(/\r?\n\r?\n/)
    .filter(entry => !/^Attributes = D/m.test(entry))
    .map(entry => /^Path = (.+)$/m.exec(entry)?.[1]?.replaceAll("\\", "/"))
    .filter((path): path is string => Boolean(path?.startsWith("docs/")));
}

export function unpackDocs(): void {
  // Preserve local edits when restoring archived documentation.
  run7z(["x", "-aos", "-y", archivePath]);
  const check = Bun.spawnSync(["bun", "run", "docs:check"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (check.exitCode !== 0) throw new Error("Documentation validation failed after extraction.");
}

export function packDocs(): void {
  if (!existsSync(docsDir)) throw new Error("Restore documentation with bun run docs:unpack first.");
  // Cold files live in the archive; merge local edits without dropping absent history.
  if (existsSync(archivePath)) {
    run7z(["x", "-aos", "-y", archivePath, ...archivedDocPrefixes.map(prefix => `${prefix}*`)]);
  }
  const stage = mkdtempSync(join(root, ".docs-archive-"));
  try {
    // Only tracked source and existing archive projections are publication inputs.
    // Ignored private notes and concurrent untracked drafts stay outside the snapshot.
    const coldProjections = listArchivedDocs().filter(path =>
      archivedDocPrefixes.some(prefix => path.startsWith(prefix)),
    );
    const files = documentationSourceFiles(root, coldProjections, false)
      .filter(path => path.startsWith("docs/") && existsSync(join(root, path)))
      .sort();
    for (const path of files) {
      if (/[\r\n\0]/.test(path) || path.split("/").includes("..") || resolve(root, path) === root)
        throw new Error("Unsafe documentation archive path");
      if (!lstatSync(join(root, path)).isFile())
        throw new Error("Refusing to archive a non-regular documentation input");
    }
    if (!files.length) throw new Error("No source documentation files to archive");
    const listFile = join(stage, "files.txt");
    writeFileSync(listFile, `${files.join("\n")}\n`, "utf8");
    const stagedArchive = join(stage, "docs.7z");
    run7z([
      "a",
      "-t7z",
      "-m0=lzma2",
      "-mx=9",
      "-mfb=273",
      "-md=64m",
      "-ms=on",
      "-y",
      "-scsUTF-8",
      stagedArchive,
      `@${listFile}`,
    ]);
    run7z(["t", stagedArchive]);
    renameSync(stagedArchive, archivePath);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  console.log(`Documentation archive: ${statSync(archivePath).size} bytes.`);
}

export async function compactDocs(): Promise<void> {
  packDocs();
  const packed = new Set(listArchivedDocs());
  const stage = mkdtempSync(join(root, ".docs-archive-"));
  let files = 0;
  try {
    run7z(["x", "-y", archivePath, ...archivedDocPrefixes.map(prefix => `${prefix}*`)], stage);
    for (const prefix of archivedDocPrefixes) {
      const directory = join(root, prefix);
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        if (!entry.isFile()) throw new Error(`Refusing to compact a non-regular file: ${entry.name}`);
        const path = join(entry.parentPath, entry.name);
        const relativePath = path.slice(root.length + 1);
        if (!packed.has(relativePath.replaceAll("\\", "/")))
          throw new Error("Cannot compact a cold tree containing files excluded from the source archive");
        const source = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
        const restored = new Bun.CryptoHasher("sha256")
          .update(await Bun.file(join(stage, relativePath)).arrayBuffer())
          .digest("hex");
        if (source !== restored) throw new Error(`Archive differs from source: ${relativePath}`);
        files++;
      }
    }
    // Remove projections only after every source file survives an actual extraction.
    for (const prefix of archivedDocPrefixes) rmSync(join(root, prefix), { recursive: true, force: true });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  console.log(`Compacted ${files} verified files into docs.7z. Restore with bun run docs:unpack.`);
}

if (import.meta.main) {
  switch (process.argv[2] ?? "sync") {
    case "unpack":
      unpackDocs();
      break;
    case "pack":
      packDocs();
      break;
    case "compact":
      await compactDocs();
      break;
    case "sync":
      if (!existsSync(docsDir)) unpackDocs();
      else if (archivedDocPrefixes.some(prefix => !existsSync(join(root, prefix)))) await compactDocs();
      else packDocs();
      break;
    default:
      throw new Error("Usage: bun scripts/iecode/tools/docs-archive.ts [unpack|pack|compact|sync]");
  }
}
