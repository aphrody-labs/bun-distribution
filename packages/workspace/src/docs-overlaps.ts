import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const IGNORED_WORDS = new Set([
  "https",
  "fichier",
  "fichiers",
  "commit",
  "valeur",
  "donnees",
  "projet",
  "command",
  "return",
]);

function keywords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9_\-.]{5,}/g) ?? []).filter(
      (word) => !IGNORED_WORDS.has(word),
    ),
  );
}

export interface DocumentOverlap {
  left: string;
  right: string;
  similarity: number;
}

/** Keyword-set overlap (common words over the smaller set) for every document pair above `threshold`. */
export function findDocumentOverlaps(
  documents: ReadonlyArray<{ file: string; text: string }>,
  threshold: number,
): DocumentOverlap[] {
  const entries = documents.map(({ file, text }) => ({ file, words: keywords(text) }));
  const overlaps: DocumentOverlap[] = [];
  for (let left = 0; left < entries.length; left++)
    for (let right = left + 1; right < entries.length; right++) {
      const a = entries[left];
      const b = entries[right];
      if (!a || !b || a.words.size === 0 || b.words.size === 0) continue;
      const common = [...a.words].filter((word) => b.words.has(word)).length;
      const similarity = common / Math.min(a.words.size, b.words.size);
      if (similarity > threshold) overlaps.push({ left: a.file, right: b.file, similarity });
    }
  return overlaps;
}

export function runDocsOverlaps(args: string[]): number {
  let root = process.cwd();
  let threshold = 0.45;
  const excludes: string[] = [];
  const includes: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--exclude") excludes.push(args[++index] ?? "");
    else if (arg === "--include") includes.push(args[++index] ?? "");
    else if (arg === "--threshold") threshold = Number(args[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops docs-overlaps [--root <repository>] [--include <path-substring>]... [--exclude <path-substring>]... [--threshold <0..1>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error("invalid root or threshold");
  if (includes.some((include) => !include)) throw new Error("--include requires a path substring");
  root = resolve(root);
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "*.md"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  const docs = new TextDecoder()
    .decode(result.stdout)
    .trim()
    .split("\n")
    .filter(
      (file) =>
        file.startsWith("docs/") &&
        existsSync(resolve(root, file)) &&
        (includes.length === 0 || includes.some((include) => file.includes(include))) &&
        !excludes.some((exclude) => file.includes(exclude)),
    );
  const overlaps = findDocumentOverlaps(
    docs.map((file) => ({ file, text: readFileSync(resolve(root, file), "utf8") })),
    threshold,
  );
  for (const overlap of overlaps)
    console.log(
      `High overlap (${(overlap.similarity * 100).toFixed(1)}%): ${overlap.left} <--> ${overlap.right}`,
    );
  console.log(
    `documentation overlap audit: ${docs.length} files, ${overlaps.length} high-overlap pair(s)`,
  );
  return 0;
}
