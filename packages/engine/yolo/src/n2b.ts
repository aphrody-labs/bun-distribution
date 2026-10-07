// SPDX-License-Identifier: MIT
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  NodeProjectReport,
  ScanNodeProjectOptions,
} from "@aphrody/yolo-core/src/compiler/native.ts";

export const N2B_HELP = `Usage: yolo n2b [path] [options]

Scan a Node.js project with the native N2B engine in this process.
The default path is the current directory; the default mode checks without editing.

  --jobs <1..6>       Bound native scan concurrency
  --fix              Apply safe transformations
  --aggressive       Apply aggressive transformations (exclusive with --fix)
  --dry-run          Preview transformations without writing project files
  --ignore <glob>    Exclude a pattern; may be repeated
  --library <path>   Native tooling library (otherwise YOLO_TOOLING_LIB)
  --json             Print the original schema-version-2 report
  --help, -h         Print this help without loading a native library

Exit codes: 0 success, 1 findings in check mode, 2 errors or invalid arguments.
`;

export interface N2bArguments {
  readonly help: boolean;
  readonly json: boolean;
  readonly root: string;
  readonly libraryPath?: string;
  readonly options: ScanNodeProjectOptions;
}

function nonempty(value: string, label: string): string {
  if (value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be nonempty and contain no NUL character`);
  }
  return value;
}

export function parseN2bArguments(args: readonly string[], cwd = process.cwd()): N2bArguments {
  const { values, positionals } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: true,
    options: {
      jobs: { type: "string" },
      fix: { type: "boolean" },
      aggressive: { type: "boolean" },
      "dry-run": { type: "boolean" },
      ignore: { type: "string", multiple: true },
      library: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1) throw new TypeError("Expected at most one project path");
  if (values.fix && values.aggressive) {
    throw new TypeError("--fix and --aggressive are mutually exclusive");
  }
  if (values.jobs !== undefined && !/^[1-6]$/.test(values.jobs)) {
    throw new TypeError("--jobs must be an integer from 1 through 6");
  }
  const mode = values.aggressive ? "aggressive" : values.fix ? "fix" : "check";
  return {
    help: values.help ?? false,
    json: values.json ?? false,
    root: resolve(cwd, nonempty(positionals[0] ?? ".", "Project path")),
    ...(values.library === undefined
      ? {}
      : { libraryPath: resolve(cwd, nonempty(values.library, "--library")) }),
    options: {
      mode,
      dry_run: values["dry-run"] ?? false,
      ...(values.jobs === undefined ? {} : { jobs: Number(values.jobs) }),
      ...(values.ignore === undefined
        ? {}
        : { ignore: values.ignore.map((pattern) => nonempty(pattern, "--ignore")) }),
    },
  };
}

export function n2bExitCode(report: NodeProjectReport): number {
  if (report.files.some((file) => file.findings.some((finding) => finding.severity === "error"))) {
    return 2;
  }
  return report.mode === "check" && report.findings_total > 0 ? 1 : 0;
}

export function renderN2bReport(report: NodeProjectReport, dryRun = false): string {
  const changed = report.files.filter((file) => file.changed).length;
  const heading = `N2B ${report.mode}${dryRun ? " (dry run)" : ""}: ${report.files_scanned} files scanned, ${report.findings_total} findings, ${changed} files ${dryRun ? "would change" : "changed"}`;
  const findings = report.files.flatMap((file) =>
    file.findings.map(
      (finding) =>
        `${file.path}:${finding.line}:${finding.col} ${finding.severity} ${finding.rule_id}: ${finding.message}`,
    ),
  );
  return [heading, ...findings].join("\n");
}

export async function runN2bCommand(args: readonly string[], cwd = process.cwd()): Promise<number> {
  try {
    const parsed = parseN2bArguments(args, cwd);
    if (parsed.help) {
      console.log(N2B_HELP);
      return 0;
    }
    if (!statSync(parsed.root).isDirectory()) {
      throw new TypeError("Project path must be a directory");
    }
    const { NativeTooling } = await import("@aphrody/yolo-core/src/compiler/native.ts");
    using tooling = new NativeTooling(
      parsed.libraryPath === undefined ? {} : { path: parsed.libraryPath },
    );
    const report = tooling.scanNodeProject(parsed.root, parsed.options);
    console.log(
      parsed.json
        ? JSON.stringify(report, null, 2)
        : renderN2bReport(report, parsed.options.dry_run),
    );
    return n2bExitCode(report);
  } catch (error) {
    console.error(`yolo n2b: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
