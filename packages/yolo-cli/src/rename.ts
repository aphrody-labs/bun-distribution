/**
 * `yolo rename`: `bun rename` (the Bun fork's built-in renamer) with the Aphrody defaults. Without
 * rules it applies the `aphrody` preset, without targets it renames `crates/tauri`, journals go to
 * `.cache/rename` and the Aphrody audit trails are never rewritten. Journals stay restorable by both.
 */
import { runBunTool } from "./bun-tools";

export interface RenameRule {
  readonly from: string;
  readonly to: string;
}

/** `aphrody` moves every upstream npm scope to @aphrody. */
export const PRESETS: Record<string, readonly RenameRule[]> = {
  aphrody: [{ from: "@tauri-apps/", to: "@aphrody/" }],
};

export const APHRODY_EXCLUDES: readonly string[] = [
  "**/audits/**",
  "**/.changes/*.md",
];
export const DEFAULT_TARGET = "crates/tauri";
export const JOURNAL_DIR = ".cache/rename";

const VALUE_FLAGS = new Set([
  "--from",
  "--to",
  "--include",
  "--exclude",
  "--rules",
  "--journal-dir",
  "--restore",
]);

/** The `bun rename` arguments for `yolo rename <args>`, run from the repository root. */
export function bunRenameArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let rules = false;
  let targets = false;
  let restore = false;
  let journal = false;
  let tail: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--help" || arg === "-h") return ["--help"];
    if (arg === "--") {
      tail = args.slice(i);
      targets ||= tail.length > 1;
      break;
    }
    if (arg === "--preset") {
      const name = args[++i];
      const preset = name === undefined ? undefined : PRESETS[name];
      if (!preset)
        throw new Error(
          `Unknown preset "${name ?? ""}" (available: ${Object.keys(PRESETS).join(", ")})`,
        );
      for (const rule of preset) out.push("--from", rule.from, "--to", rule.to);
      rules = true;
      continue;
    }
    if (arg === "--from" || arg === "--rules") rules = true;
    else if (arg === "--restore") restore = true;
    else if (arg === "--journal-dir") journal = true;
    else if (!arg.startsWith("-")) targets = true;
    out.push(arg);
    if (VALUE_FLAGS.has(arg) && i + 1 < args.length)
      out.push(args[++i] as string);
  }
  if (restore) return [...out, ...tail];
  if (!rules)
    for (const rule of PRESETS.aphrody!)
      out.unshift("--from", rule.from, "--to", rule.to);
  if (!journal) out.push("--journal-dir", JOURNAL_DIR);
  for (const glob of APHRODY_EXCLUDES) out.push("--exclude", glob);
  if (!targets) out.push(DEFAULT_TARGET);
  return [...out, ...tail];
}

export async function runRenameCommand(
  args: readonly string[],
  rootDir: string,
): Promise<number> {
  let bunArgs: string[];
  try {
    bunArgs = bunRenameArgs(args);
  } catch (error) {
    console.error(
      `\x1b[31mError:\x1b[0m ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  return runBunTool("rename", bunArgs, rootDir);
}

if (import.meta.main) {
  void runRenameCommand(process.argv.slice(2), process.cwd()).then(
    (code) => (process.exitCode = code),
  );
}
