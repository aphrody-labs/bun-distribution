import { readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
]);
const PATH_START =
  /(?<![A-Za-z0-9_])(?:[A-Za-z]:[\\/]+|\\\\\?\\(?:UNC\\)?[^\\/\s]+[\\/]+[^\\/\s]+|\\\\[^\\/\s]+[\\/]+[^\\/\s]+|%[A-Za-z_][A-Za-z0-9_]*%[\\/]+)/gi;
const INVALID_WINDOWS_PATH_CHARACTERS = /[<>"|?*]/;
const PATH_END = /[\r\n"'<>|;,)}\]*?]/;
const TRAILING_PUNCTUATION = /[.:!?)}\]]+$/;

export interface WindowsPathFinding {
  file: string;
  line: number;
  column: number;
  path: string;
}

async function walk(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    console.error(
      `warning: cannot read ${directory}: ${error instanceof Error ? error.message : error}`,
    );
    return [];
  }
  // Sibling directories are independent: walk them concurrently and keep the sorted order.
  const nested = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<string[]> => {
        const path = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) return [];
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(path);
        return entry.isFile() ? [path] : [];
      }),
  );
  return nested.flat();
}

export async function scanWindowsPaths(root: string): Promise<WindowsPathFinding[]> {
  const resolvedRoot = await realpath(root);
  const findings: WindowsPathFinding[] = [];
  for (const file of await walk(resolvedRoot)) {
    if (file === resolve(import.meta.dir, "windows-paths.ts")) continue;
    let raw: Buffer;
    try {
      // Files are read one at a time so that memory stays bounded to a single file across the repository.
      // oxlint-disable-next-line no-await-in-loop -- sequential reads bound memory to one file at a time
      raw = await readFile(file);
    } catch (error) {
      console.error(
        `warning: cannot read ${file}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }
    if (raw.includes(0)) continue;
    for (const [lineIndex, line] of raw.toString("utf8").split(/\r?\n/).entries()) {
      PATH_START.lastIndex = 0;
      for (const match of line.matchAll(PATH_START)) {
        const start = match.index ?? 0;
        let end = start + match[0].length;
        if (line.slice(start, end).includes("\\\\]/") || line.startsWith("]/", end)) continue;
        const following = line[end];
        if (following && INVALID_WINDOWS_PATH_CHARACTERS.test(following)) continue;
        while (end < line.length) {
          const character = line[end];
          if (!character || PATH_END.test(character)) break;
          end += 1;
        }
        const value = line.slice(start, end).trimEnd().replace(TRAILING_PUNCTUATION, "");
        if (!value || INVALID_WINDOWS_PATH_CHARACTERS.test(value)) continue;
        findings.push({
          file: relative(resolvedRoot, file).replaceAll("\\", "/"),
          line: lineIndex + 1,
          column: start + 1,
          path: value,
        });
      }
    }
  }
  return findings;
}

export async function runWindowsPaths(args: string[]): Promise<number> {
  let root = process.cwd();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root") root = args[++index] ?? "";
    else if (args[index] === "--json") json = true;
    else throw new Error("usage: yolo ops windows-paths [--root <directory>] [--json]");
  }
  if (!root) throw new Error("usage: yolo ops windows-paths [--root <directory>] [--json]");
  const findings = await scanWindowsPaths(root);
  if (json) console.log(JSON.stringify(findings, null, 2));
  else if (findings.length === 0)
    console.log(`No hard-coded Windows paths found under ${resolve(root)}`);
  else
    findings.forEach((finding) =>
      console.log(`${finding.file}:${finding.line}:${finding.column}: ${finding.path}`),
    );
  return findings.length === 0 ? 0 : 1;
}
