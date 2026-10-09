import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_SKIPS = new Set([
  ".git",
  "node_modules",
  "target",
  "var",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);
type Record = { path: string; bytes: number; extension: string; sha256: string };

export async function runGitignoredAudit(args: string[]): Promise<number> {
  let root = process.cwd();
  const skips = new Set(DEFAULT_SKIPS);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--skip") skips.add(args[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops gitignored-audit [--root <repository>] [--skip <directory>]...");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a repository path");
  root = resolve(root);
  const result = Bun.spawnSync(
    ["git", "-C", root, "ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    { windowsHide: true, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  const paths = new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path && !path.split(/[\\/]/).some((segment) => skips.has(segment)));
  const records: Record[] = [];
  for (const path of paths) {
    const full = resolve(root, path);
    // One file at a time: hashing a large ignored tree in parallel would exhaust file descriptors.
    // oxlint-disable-next-line no-await-in-loop -- sequential reads bound open file descriptors on large ignored trees
    const info = await stat(full).catch(() => undefined);
    if (!info?.isFile()) continue;
    // oxlint-disable-next-line no-await-in-loop -- sequential reads bound open file descriptors on large ignored trees
    const bytes = await readFile(full);
    const name = path.split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");
    records.push({
      path,
      bytes: info.size,
      extension: dot >= 0 ? name.slice(dot).toLowerCase() : "",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const duplicates = [
    ...records
      .reduce(
        (groups, record) =>
          groups.set(record.sha256, [...(groups.get(record.sha256) ?? []), record.path]),
        new Map<string, string[]>(),
      )
      .values(),
  ].filter((group) => group.length > 1);
  console.log(
    JSON.stringify(
      {
        ignored: records.length,
        bytes: records.reduce((total, record) => total + record.bytes, 0),
        duplicates,
        largest: [...records].toSorted((a, b) => b.bytes - a.bytes).slice(0, 20),
      },
      null,
      2,
    ),
  );
  return 0;
}
