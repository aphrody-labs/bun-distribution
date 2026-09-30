import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function keywords(text: string): Set<string> {
  const ignored = new Set([
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
  return new Set(
    (text.toLowerCase().match(/[a-z0-9_\-.]{5,}/g) ?? []).filter((word) => !ignored.has(word)),
  );
}

export function runDocsOverlaps(args: string[]): number {
  let root = process.cwd();
  let threshold = 0.45;
  const excludes: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--exclude") excludes.push(args[++index] ?? "");
    else if (arg === "--threshold") threshold = Number(args[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops docs-overlaps [--root <repository>] [--exclude <path>]... [--threshold <0..1>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error("invalid root or threshold");
  root = resolve(root);
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "*.md"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  const docs = new TextDecoder()
    .decode(result.stdout)
    .trim()
    .split("\n")
    .filter(
      (file) => file.startsWith("docs/") && !excludes.some((exclude) => file.includes(exclude)),
    );
  const entries = docs.map((file) => ({
    file,
    words: keywords(readFileSync(resolve(root, file), "utf8")),
  }));
  let overlaps = 0;
  for (let left = 0; left < entries.length; left++)
    for (let right = left + 1; right < entries.length; right++) {
      const a = entries[left];
      const b = entries[right];
      if (!a || !b || a.words.size === 0 || b.words.size === 0) continue;
      const common = [...a.words].filter((word) => b.words.has(word)).length;
      const similarity = common / Math.min(a.words.size, b.words.size);
      if (similarity > threshold) {
        overlaps++;
        console.log(`High overlap (${(similarity * 100).toFixed(1)}%): ${a.file} <--> ${b.file}`);
      }
    }
  console.log(
    `documentation overlap audit: ${docs.length} files, ${overlaps} high-overlap pair(s)`,
  );
  return 0;
}
