/**
 * `yolo scan`: Fast, parallel, recursive repository and directory scanner.
 * Thin CLI dispatcher delegating to @aphrody/yolo-core/vfs.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  scanDirectory,
  renderScanMarkdown,
  renderScanTerminal,
  formatBytes,
  type ExtensionStat,
  type FileEntry,
  type ScanReport,
  type ScanOptions,
} from "../../../../packages/engine/core/src/vfs/scan";

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
  --help, -h      Show this help

Options may appear before or after dir. Use -- before a dir starting with -.`;

function parseList(value: string | undefined, option: string): string[] | undefined {
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

    const target = positionals[0] === undefined ? root : resolve(process.cwd(), positionals[0]);
    const exts = parseList(values.exts, "--exts");
    const exclude = parseList(values.exclude, "--exclude");
    let parallel: number | undefined;
    if (values.parallel !== undefined) {
      parallel = Number(values.parallel);
      if (!/^\d+$/.test(values.parallel) || !Number.isSafeInteger(parallel) || parallel <= 0) {
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
  void runScanCommand(process.argv.slice(2), process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
