// SPDX-License-Identifier: Apache-2.0
/** Bounded static site mirroring through the Aphrody Web Rust owner. */
import { runAphrodyCli, type AphrodyCliOptions, type CliResult } from "./cli";

export interface AphrodyWebMirrorRequest {
  url: string;
  outputDir: string;
  recursive?: boolean;
  maxPages?: number;
  maxAssets?: number;
  maxDepth?: number;
  maxConcurrency?: number;
  delayMs?: number;
  allowedDomains?: string[];
  resolveCdns?: boolean | string[];
  proxy?: string;
}

export interface AphrodyWebMirrorFailure {
  url: string;
  error: string;
}

export interface AphrodyWebMirrorReport {
  requests: number;
  pagesWritten: number;
  assetsWritten: number;
  bytesWritten: number;
  files: string[];
  failures: AphrodyWebMirrorFailure[];
}

/** Mirrors HTML, linked CSS, and referenced static resources to a local tree. */
export async function aphrodyWebMirror(
  request: AphrodyWebMirrorRequest,
  options: Omit<AphrodyCliOptions, "json"> = {},
): Promise<AphrodyWebMirrorReport> {
  const seed = new URL(request.url);
  if (!["http:", "https:"].includes(seed.protocol) || seed.username || seed.password) {
    throw new Error("Aphrody Web mirror requires a credential-free HTTP(S) URL");
  }
  if (!request.outputDir.trim()) throw new Error("Aphrody Web mirror requires an output directory");
  const maxPages = request.maxPages ?? 100;
  const maxAssets = request.maxAssets ?? 2_000;
  const maxDepth = request.maxDepth ?? 3;
  const maxConcurrency = request.maxConcurrency ?? 4;
  const delayMs = request.delayMs ?? 500;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10_000) {
    throw new Error("Aphrody Web mirror maxPages must be between 1 and 10000");
  }
  if (!Number.isInteger(maxAssets) || maxAssets < 0 || maxAssets > 20_000) {
    throw new Error("Aphrody Web mirror maxAssets must be between 0 and 20000");
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("Aphrody Web mirror maxDepth must be a nonnegative integer");
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
    throw new Error("Aphrody Web mirror maxConcurrency must be between 1 and 64");
  }
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error("Aphrody Web mirror delayMs must be a nonnegative integer");
  }

  const args = [
    "web",
    "mirror",
    seed.href,
    request.outputDir,
    "--max-pages",
    String(maxPages),
    "--max-assets",
    String(maxAssets),
    "--max-depth",
    String(maxDepth),
    "--concurrency",
    String(maxConcurrency),
    "--delay-ms",
    String(delayMs),
    "--json",
  ];
  if (request.recursive) args.push("--recursive");
  if (request.allowedDomains?.length)
    args.push("--allowed-domains", request.allowedDomains.join(","));
  if (request.resolveCdns === true) args.push("--resolve-cdns", "true");
  else if (Array.isArray(request.resolveCdns) && request.resolveCdns.length) {
    args.push("--resolve-cdns", request.resolveCdns.join(","));
  }
  if (request.proxy) args.push("--proxy", request.proxy);

  const result: CliResult<AphrodyWebMirrorReport> = await runAphrodyCli<AphrodyWebMirrorReport>(
    args,
    {
      timeoutMs: 600_000,
      ...options,
      json: true,
    },
  );
  if (result.kind === "exit" && result.ok && !isMirrorReport(result.data)) {
    throw new Error("Aphrody Web mirror returned an invalid report");
  }
  if (result.kind !== "exit" || !result.ok) {
    throw new Error(formatMirrorCliError(result));
  }
  return result.data as AphrodyWebMirrorReport;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isMirrorReport(value: unknown): value is AphrodyWebMirrorReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<AphrodyWebMirrorReport>;
  return (
    isNonnegativeSafeInteger(report.requests) &&
    isNonnegativeSafeInteger(report.pagesWritten) &&
    isNonnegativeSafeInteger(report.assetsWritten) &&
    isNonnegativeSafeInteger(report.bytesWritten) &&
    Array.isArray(report.files) &&
    report.files.every((path) => typeof path === "string") &&
    Array.isArray(report.failures) &&
    report.failures.every(
      (failure) =>
        Boolean(failure) &&
        typeof failure === "object" &&
        typeof failure.url === "string" &&
        failure.url.length > 0 &&
        typeof failure.error === "string" &&
        failure.error.length > 0,
    )
  );
}

function formatMirrorCliError(result: CliResult): string {
  if (result.kind === "not_found")
    return "Aphrody CLI unavailable (" + result.bin + "): " + result.message;
  if (result.kind === "timeout")
    return (
      "Aphrody Web mirror timed out after " + result.timeoutMs + " ms: " + result.stderr.trim()
    );
  if (result.kind === "invalid_json")
    return "Aphrody Web mirror returned invalid JSON: " + result.error;
  return (
    "Aphrody Web mirror exited " +
    result.code +
    ": " +
    (result.stderr.trim() || result.stdout.trim())
  );
}
