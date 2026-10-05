// SPDX-License-Identifier: Apache-2.0
import { NativeTooling, type ScanNodeProjectOptions } from "@aphrody/runtime-sdk/tooling";
import type { N2BReport } from "@aphrody/n2b-types";
import { resolve } from "node:path";
import type { N2BError } from "./cli";

export interface ScanOptions extends ScanNodeProjectOptions {
  /** Compatibility option; native scanning emits no subprocess output. */
  quiet?: boolean;
  /** Explicit native provider; otherwise the SDK honors YOLO_TOOLING_LIB. */
  libraryPath?: string;
  /** Legacy CLI options are accepted only by the explicit ./cli entry point. */
  bin?: string;
  cwd?: string;
}

/** Scan in process. A missing provider is an error; no executable fallback runs. */
export async function scan(root: string, options: ScanOptions = {}): Promise<N2BReport> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("N2B scan options must be an object");
  }
  if (options.bin !== undefined || options.cwd !== undefined) {
    throw new TypeError(
      "Native N2B scan cannot use bin/cwd; select @aphrody/n2b-core/cli explicitly",
    );
  }
  if (options.quiet !== undefined && typeof options.quiet !== "boolean") {
    throw new TypeError("N2B quiet must be a boolean");
  }
  using tooling = new NativeTooling(
    options.libraryPath === undefined ? {} : { path: options.libraryPath },
  );
  const report = tooling.scanNodeProject(resolve(root), {
    mode: options.mode ?? "check",
    ...(options.ignore === undefined ? {} : { ignore: options.ignore }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    ...(options.dry_run === undefined ? {} : { dry_run: options.dry_run }),
  });
  // Keep the historical scan contract: warning findings are returned; errors reject.
  if (report.files.some((file) => file.findings.some((finding) => finding.severity === "error"))) {
    const error = new Error("Native N2B scan reported error-level findings") as N2BError;
    error.code = 2;
    error.stderr = "";
    throw error;
  }
  return report;
}
