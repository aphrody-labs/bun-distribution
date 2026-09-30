// SPDX-License-Identifier: Apache-2.0
import { loadNativeLibrary } from "./library";
import { cString, envelope, ownedJson } from "./native-response";

export interface ScanNodeProjectOptions {
  mode?: "check" | "fix" | "aggressive";
  ignore?: string[];
  /** Preview fix/aggressive transformations without writing project files. */
  dry_run?: boolean;
}

export interface NodeProjectFinding {
  rule_id: string;
  category: string;
  severity: "error" | "warn" | "info";
  confidence: number;
  message: string;
  line: number;
  col: number;
  start_byte: number;
  end_byte: number;
  original: string;
  replacement?: string;
  autofix: boolean;
  aggressive?: boolean;
  docs_url: string;
  context: { before: string[]; line: string; after: string[] };
  compat?: {
    status: "full" | "partial" | "missing";
    module: string;
    missing_apis?: string[];
    equivalent?: string;
    bunpp?: string;
  };
}

export interface NodeProjectReport {
  schema_version: 2;
  $schema: string;
  tool: string;
  version: string;
  mode: "check" | "fix" | "aggressive";
  root: string;
  files_scanned: number;
  findings_total: number;
  files: { path: string; changed: boolean; findings: NodeProjectFinding[] }[];
}

/** Run N2B in-process. Fix/aggressive modes may write files unless dry_run=true. */
export function scanNodeProject(root: string, options?: ScanNodeProjectOptions): NodeProjectReport {
  const input = cString(root);
  if (options !== undefined) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("scanNodeProject options must be an object");
    }
    if (options.mode !== undefined && !["check", "fix", "aggressive"].includes(options.mode)) {
      throw new TypeError("scanNodeProject mode must be check, fix or aggressive");
    }
    if (
      options.ignore !== undefined &&
      (!Array.isArray(options.ignore) || !options.ignore.every((item) => typeof item === "string"))
    ) {
      throw new TypeError("scanNodeProject ignore must be an array of strings");
    }
    if (options.dry_run !== undefined && typeof options.dry_run !== "boolean") {
      throw new TypeError("scanNodeProject dry_run must be a boolean");
    }
    for (const name of Object.keys(options)) {
      if (!["mode", "ignore", "dry_run"].includes(name))
        throw new TypeError(`Unknown scanNodeProject option: ${name}`);
    }
  }
  const encodedOptions = options === undefined ? undefined : cString(JSON.stringify(options));
  const { symbols } = loadNativeLibrary();
  const pointer =
    encodedOptions === undefined
      ? symbols.node2bun_scan_json(input)
      : symbols.node2bun_scan_with_options_json(input, encodedOptions);
  const result = envelope(ownedJson(pointer, symbols.node2bun_string_free, "N2B scan"), "N2B scan");
  const report = result.report as NodeProjectReport | undefined;
  if (!report || report.schema_version !== 2 || !Array.isArray(report.files)) {
    throw new Error("N2B scan: unsupported or invalid report schema");
  }
  return report;
}

/** Return newline offsets in UTF-16 code units, matching JavaScript strings. */
export function findNewlinesUtf16(source: string): Uint32Array {
  if (typeof source !== "string") throw new TypeError("findNewlinesUtf16 expects a string");
  if (source.length === 0) return new Uint32Array();
  const bytes = new Uint8Array(source.length * 2);
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  const { symbols } = loadNativeLibrary();
  const count = Number(symbols.find_newlines_u16(bytes, bytes.length, null, 0));
  const offsets = new Uint32Array(count);
  if (count > 0) symbols.find_newlines_u16(bytes, bytes.length, offsets, count);
  return offsets;
}
