// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Bun.plugin() scans once through the native SDK and indexes findings for
// onLoad/onEnd. Legacy subprocess scanning requires explicit native: "off".

import type { BunPlugin } from "bun";
import { scan, type ScanOptions } from "./index";
import type { Finding, N2BReport } from "./types";
import { resolve } from "node:path";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

export interface N2BPluginOptions extends Pick<
  ScanOptions,
  "ignore" | "bin" | "cwd" | "jobs" | "libraryPath"
> {
  /** Root to scan. Defaults to Bun.env.PWD (the build's cwd). */
  root?: string;
  /** "warn" (default) logs findings but lets the build complete. "error" throws at onEnd. */
  onFindings?: "warn" | "error";
  /** Suppress per-file logs. Summary at onEnd is still printed. */
  quiet?: boolean;
  /** Pre-computed report (e.g. reused across watched builds). Skips native and CLI calls. */
  report?: N2BReport;
  /** auto and required use the SDK; off explicitly selects the historical CLI adapter. */
  native?: "auto" | "required" | "off";
}

/**
 * Create the n2b Bun plugin. Usage:
 *
 *     import { n2bPlugin } from "@aphrody/n2b-core/plugin";
 *     Bun.plugin(n2bPlugin({ onFindings: "warn" }));
 *
 * The plugin scans once per build through the Yolo SDK. A missing native provider
 * fails the build; the historical CLI is used only when native: "off" is explicit.
 */
export function n2bPlugin(opts: N2BPluginOptions = {}): BunPlugin {
  const onFindings = opts.onFindings ?? "warn";
  const quiet = opts.quiet ?? false;

  // Per-file findings keyed by absolute path.
  let byPath = new Map<string, Finding[]>();
  let total = 0;
  let filesCount = 0;

  return {
    name: "n2b",

    async setup(build) {
      const root = resolve(opts.root ?? process.cwd());

      let report = opts.report;
      const native = opts.native ?? "required";
      if (!["auto", "required", "off"].includes(native)) {
        throw new TypeError("n2b native policy must be auto, required or off");
      }
      if (native !== "off" && (opts.bin !== undefined || opts.cwd !== undefined)) {
        throw new Error("n2b native scan cannot use a custom CLI binary or working directory");
      }
      if (!report) {
        if (native === "off") {
          const legacy = await import("@aphrody/n2b-core/cli");
          report = await legacy.scan(root, {
            mode: "check",
            ...(opts.ignore === undefined ? {} : { ignore: opts.ignore }),
            quiet: true,
            ...(opts.bin === undefined ? {} : { bin: opts.bin }),
            ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
          });
        } else {
          report = await scan(root, {
            mode: "check",
            dry_run: true,
            ...(opts.ignore === undefined ? {} : { ignore: opts.ignore }),
            ...(opts.jobs === undefined ? {} : { jobs: opts.jobs }),
            ...(opts.libraryPath === undefined ? {} : { libraryPath: opts.libraryPath }),
          });
        }
      }

      byPath = new Map();
      total = 0;
      filesCount = 0;
      for (const file of report.files) {
        if (file.findings.length === 0) continue;
        filesCount++;
        // Keys stored both relative (as n2b emits) and absolute for onLoad matching.
        byPath.set(file.path, file.findings);
        byPath.set(resolve(root, file.path), file.findings);
        total += file.findings.length;
      }

      build.onLoad({ filter: /\.[jt]sx?$|\.m[jt]s$|\.c[jt]s$/ }, ({ path }) => {
        if (quiet) return undefined;
        const findings = byPath.get(path);
        if (!findings) return undefined;
        const rel = path.startsWith(root) ? path.slice(root.length + 1) : path;
        for (const f of findings) {
          const loc = `${DIM}${rel}:${f.line}:${f.col}${RESET}`;
          const tag = `${CYAN}${f.rule_id}${RESET}`;
          const repl = f.replacement
            ? ` ${DIM}→${RESET} ${GREEN}${trunc(f.replacement, 60)}${RESET}`
            : "";
          console.warn(`${YELLOW}[n2b]${RESET} ${loc} ${tag} ${f.message}${repl}`);
        }
        return undefined;
      });

      build.onEnd(() => {
        if (total === 0) {
          if (!quiet) console.log(`${GREEN}[n2b]${RESET} no Node→Bun issues detected`);
          return;
        }
        const mark = onFindings === "error" ? `${RED}✗${RESET}` : `${YELLOW}!${RESET}`;
        console.warn(
          `\n${mark} ${BOLD}[n2b]${RESET} ${total} finding(s) across ${filesCount} file(s)`,
        );
        if (onFindings === "error") {
          throw new Error(`[n2b] ${total} finding(s) — fix them or set onFindings: "warn"`);
        }
      });
    },
  };
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
