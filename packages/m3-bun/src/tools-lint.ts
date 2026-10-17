// SPDX-License-Identifier: Apache-2.0
// `m3-bun lint`: the rules of `@aphrody/eslint-plugin-m3` run by the native `bun lint` (its `jsPlugins`), on the app's sources.
// The config is generated per run from the plugin's own `recommended` or `strict` preset.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTool } from "./tools-load.ts";

export type LintPreset = "recommended" | "strict";

export interface LintOptions {
  /** App directory (default: the working directory). */
  dir?: string;
  /** Files or directories to lint, relative to `dir` (default: `dir`). */
  paths?: string[];
  preset?: LintPreset;
  /** Apply the autofixes (`valid-icon-name`, `no-mui-prop-on-md`). */
  fix?: boolean;
  /** Also run the default `correctness` rules (default: only the m3 rules). */
  correctness?: boolean;
  /** The Bun executable that runs `bun lint` (default: this process). */
  bun?: string;
}

export interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  /** `m3/no-sx-prop`, or `eslint/no-unused-vars` with `correctness`. */
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export interface LintReport {
  diagnostics: LintDiagnostic[];
  errors: number;
  warnings: number;
  files: number;
  rules: number;
  /** The `bun lint` exit code: 0 when no error. */
  exitCode: number;
}

interface LintJson {
  diagnostics: Array<{
    message: string;
    code: string;
    severity: string;
    filename: string;
    labels?: Array<{ span: { line: number; column: number } }>;
  }>;
  number_of_files: number;
  number_of_rules: number;
}

/**
 * The executable that runs `bun lint`: the option, else this process. A standalone `m3-bun` executable runs
 * as Bun through `BUN_BE_BUN=1`, so the native linter and its `jsPlugins` are always available.
 */
export function bunExecutable(explicit?: string): string {
  return explicit ?? process.execPath;
}

/** `m3(no-sx-prop)` -> `m3/no-sx-prop`. */
export const ruleName = (code: string): string => code.replace(/^([\w-]+)\((.+)\)$/, "$1/$2");

/** Lint an app with the m3 rules. */
export async function lintApp(options: LintOptions = {}): Promise<LintReport> {
  const dir = resolve(options.dir ?? process.cwd());
  const plugin = (await loadTool("@aphrody/eslint-plugin-m3", () => import("@aphrody/eslint-plugin-m3"))).default;
  const preset = options.preset ?? "recommended";
  const rules = plugin.configs[preset]?.rules;
  if (!rules) throw new Error(`m3-bun lint: unknown preset ${preset} (${Object.keys(plugin.configs).join(", ")})`);
  const configDir = await mkdtemp(join(tmpdir(), "m3-bun-lint-"));
  try {
    const config = join(configDir, ".oxlintrc.json");
    await Bun.write(
      config,
      JSON.stringify({
        jsPlugins: [fileURLToPath(import.meta.resolve("@aphrody/eslint-plugin-m3")).replaceAll("\\", "/")],
        ...(options.correctness ? {} : { categories: { correctness: "off" } }),
        rules,
      }),
    );
    const binary = bunExecutable(options.bun);
    const proc = Bun.spawn(
      [
        binary,
        "lint",
        "-c",
        config,
        "--format",
        "json",
        "--ignore-pattern",
        "**/dist/**",
        ...(options.fix ? ["--fix"] : []),
        ...(options.paths?.length ? options.paths : ["."]),
      ],
      {
        windowsHide: true,
        cwd: dir,
        env: { ...process.env, BUN_BE_BUN: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let json: LintJson;
    try {
      json = JSON.parse(stdout) as LintJson;
    } catch {
      throw new Error(`m3-bun lint: bun lint exited ${exitCode} without a JSON report:\n${stderr || stdout}`);
    }
    if (!options.correctness && json.number_of_rules < Object.keys(rules).length)
      throw new Error(
        `m3-bun lint: ${binary} lint enabled ${json.number_of_rules} of the ${Object.keys(rules).length} m3 rules: this Bun does not run jsPlugins`,
      );
    const diagnostics = json.diagnostics.map((d): LintDiagnostic => {
      const span = d.labels?.[0]?.span;
      return {
        file: d.filename.replaceAll("\\", "/"),
        line: span?.line ?? 0,
        column: span?.column ?? 0,
        rule: ruleName(d.code),
        severity: d.severity === "error" ? "error" : "warning",
        message: d.message,
      };
    });
    return {
      diagnostics,
      errors: diagnostics.filter(d => d.severity === "error").length,
      warnings: diagnostics.filter(d => d.severity === "warning").length,
      files: json.number_of_files,
      rules: json.number_of_rules,
      exitCode,
    };
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}
