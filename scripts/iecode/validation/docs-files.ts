import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Source files honor Git ignores; archive projections remain independently validated. */
export function documentationSourceFiles(
  root: string,
  archived: Iterable<string>,
  includeUntracked = true,
): string[] {
  const result = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "-z",
      "--cached",
      ...(includeUntracked ? ["--others", "--exclude-standard"] : []),
    ],
    { cwd: root },
  );
  if (result.exitCode !== 0) throw new Error("Cannot enumerate repository files");
  return [
    ...new Set([
      ...result.stdout
        .toString()
        .split("\0")
        .filter((path) => path && existsSync(resolve(root, path))),
      ...archived,
    ]),
  ];
}
