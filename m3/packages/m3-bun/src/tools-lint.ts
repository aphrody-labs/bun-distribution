// SPDX-License-Identifier: Apache-2.0
// `m3-bun lint`: the rules of `@aphrody/eslint-plugin-m3` run by oxlint (its `jsPlugins`), on the app's sources.
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
  /** Also run oxlint's default `correctness` rules (default: only the m3 rules). */
  correctness?: boolean;
  /** The oxlint executable (default: `oxlint` on PATH, else the `oxlint` package). */
  oxlint?: string;
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
  /** oxlint's exit code: 0 when no error. */
  exitCode: number;
}

interface OxlintJson {
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

/** The oxlint executable: the option, `oxlint` on PATH, else the `bin` of a resolvable `oxlint` package. */
export function oxlintBinary(explicit?: string): string {
  if (explicit) return explicit;
  const onPath = Bun.which("oxlint");
  if (onPath) return onPath;
  try {
    const manifest = Bun.resolveSync("oxlint/package.json", import.meta.dir);
    const { bin } = require(manifest) as { bin: string | Record<string, string> };
    return resolve(manifest, "..", typeof bin === "string" ? bin : (bin.oxlint ?? Object.values(bin)[0]!));
  } catch {
    throw new Error("m3-bun lint: oxlint is not installed (bun add -d oxlint, or put it on PATH)");
  }
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
    const proc = Bun.spawn(
      [
        oxlintBinary(options.oxlint),
        "-c",
        config,
        "--format",
        "json",
        "--ignore-pattern",
        "**/dist/**",
        ...(options.fix ? ["--fix"] : []),
        ...(options.paths?.length ? options.paths : ["."]),
      ],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let json: OxlintJson;
    try {
      json = JSON.parse(stdout) as OxlintJson;
    } catch {
      throw new Error(`m3-bun lint: oxlint exited ${exitCode} without a JSON report:\n${stderr || stdout}`);
    }
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
