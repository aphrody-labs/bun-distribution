/**
 * `yolo scan`: Fast, parallel, recursive repository and directory scanner.
 * Thin CLI dispatcher delegating to @aphrody/yolo-core/vfs.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runAphrody } from "./aphrody-delegate";
import {
  scanDirectory,
  renderScanMarkdown,
  renderScanTerminal,
  formatBytes,
  type ExtensionStat,
  type FileEntry,
  type ScanReport,
  type ScanOptions,
} from "@aphrody/yolo-core/src/vfs/scan.ts";

export {
  scanDirectory,
  renderScanMarkdown,
  renderScanTerminal,
  formatBytes,
  type ExtensionStat,
  type FileEntry,
  type ScanReport,
  type ScanOptions,
};

const SCAN_HELP = `Usage: yolo scan [dir] [options]

Recursively scan dir, or the caller's default directory when omitted.

Options:
  --exts LIST      Include comma-separated file extensions (e.g. ts,rs,toml)
  --exclude LIST   Exclude comma-separated directory names instead of defaults
  --parallel N     Maximum parallel I/O workers (positive integer, default: 16)
  --json          Print the scan report as JSON
  --md            Print the scan report as Markdown
  --ingest        Delegate to 'aphrody home index': scan, code graph, chunk and index into the
                  agent home database (incremental by content hash)
  --profile NAME  Domain home for --ingest (aphrody, dbfr, ie); default: the global home
  --label NAME    Source label for --ingest (default: the directory name)
  --help, -h      Show this help

Options may appear before or after dir. Use -- before a dir starting with -.`;

function parseList(
  value: string | undefined,
  option: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => item.length === 0)) {
    throw new Error(`${option} requires a non-empty comma-separated list`);
  }
  return items;
}

export async function runScanCommand(
  args: readonly string[],
  root: string,
  out: (s: string) => void = console.log,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        exts: { type: "string" },
        exclude: { type: "string" },
        parallel: { type: "string" },
        json: { type: "boolean" },
        md: { type: "boolean" },
        ingest: { type: "boolean" },
        profile: { type: "string" },
        label: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      out(SCAN_HELP);
      return 0;
    }
    if (positionals.length > 1) {
      throw new Error("Expected at most one scan directory");
    }
    if (values.json && values.md) {
      throw new Error("Choose one output format: --json or --md");
    }

    const target =
      positionals[0] === undefined
        ? root
        : resolve(process.cwd(), positionals[0]);
    if (values.ingest) {
      const delegated = await runAphrody([
        "home",
        ...(values.profile ? ["--profile", values.profile] : []),
        "index",
        target,
        ...(values.label ? ["--label", values.label] : []),
      ]);
      if (delegated.code !== 0) {
        console.error(
          `yolo scan error: ${delegated.stderr.trim() || "aphrody home index failed"}`,
        );
        return delegated.code;
      }
      out(delegated.stdout.trimEnd());
      return 0;
    }
    if (values.profile || values.label) {
      throw new Error("--profile and --label require --ingest");
    }
    const exts = parseList(values.exts, "--exts");
    const exclude = parseList(values.exclude, "--exclude");
    let parallel: number | undefined;
    if (values.parallel !== undefined) {
      parallel = Number(values.parallel);
      if (
        !/^\d+$/.test(values.parallel) ||
        !Number.isSafeInteger(parallel) ||
        parallel <= 0
      ) {
        throw new Error("--parallel requires a positive safe integer");
      }
    }

    const report = await scanDirectory(target, { exts, exclude, parallel });
    if (values.json) {
      out(JSON.stringify(report, null, 2));
    } else if (values.md) {
      out(renderScanMarkdown(report));
    } else {
      out(renderScanTerminal(report));
    }
    return 0;
  } catch (err) {
    console.error(`yolo scan error: ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  void runScanCommand(process.argv.slice(2), process.cwd()).then(
    (code) => (process.exitCode = code),
  );
}
