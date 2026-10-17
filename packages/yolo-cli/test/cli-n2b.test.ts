// SPDX-License-Identifier: MIT
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { n2bExitCode, parseN2bArguments, renderN2bReport } from "../src/n2b.ts";
import type { NodeProjectReport } from "../../yolo-core/src/compiler/native.ts";

const repository = resolve(import.meta.dir, "../../../docs/aphrody");
const work = mkdtempSync(join(tmpdir(), "yolo-cli-n2b-"));
const userHome = join(work, "user-home");
mkdirSync(userHome);
const missingLibrary = join(work, "missing-tooling-library");
const configuredLibrary = process.env["YOLO_TOOLING_LIB"];

afterAll(() => rmSync(work, { recursive: true, force: true }));

function run(args: string[], cwd = work, library = missingLibrary) {
  return Bun.spawnSync(
    [process.execPath, "--no-install", join(repository, "packages/engine/yolo/src/index.ts"), "n2b", ...args],
    {
      windowsHide: true,
      cwd,
      env: {
        PATH: process.platform === "win32" ? (process.env["PATH"] ?? "") : "/usr/bin:/bin",
        HOME: userHome,
        YOLO_TOOLING_LIB: library,
        ...(process.platform === "win32" ? { SystemRoot: process.env["SystemRoot"] } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    },
  );
}

function report(mode: "check" | "fix" | "aggressive" = "check"): NodeProjectReport {
  return {
    $schema: "https://raw.githubusercontent.com/aphrody-code/n2b/main/schema/v2.json",
    schema_version: 2,
    tool: "node2bun",
    version: "0.6.2",
    mode,
    root: work,
    files_scanned: 2,
    findings_total: 1,
    files: [
      {
        path: "entry.js",
        changed: mode !== "check",
        findings: [
          {
            rule_id: "shebang/node",
            category: "runtime",
            severity: "warn",
            confidence: 1,
            message: "Use Bun in the shebang",
            line: 1,
            col: 1,
            start_byte: 0,
            end_byte: 19,
            original: "#!/usr/bin/env node",
            replacement: "#!/usr/bin/env bun",
            autofix: true,
            docs_url: "https://bun.sh/docs/runtime",
            context: { before: [], line: "#!/usr/bin/env node", after: [] },
          },
        ],
      },
    ],
  };
}

describe("native N2B CLI contract", () => {
  test("defaults to the caller's directory and read-only check mode", () => {
    const parsed = parseN2bArguments([], work);
    expect(parsed.root).toBe(work);
    expect(parsed.options).toEqual({ mode: "check", dry_run: false });
    expect(parsed.help).toBe(false);
    expect(parsed.json).toBe(false);
    expect(parsed.libraryPath).toBeUndefined();
  });

  test("forwards bounded jobs, repeated ignores and preview mode and resolves explicit paths", () => {
    const parsed = parseN2bArguments(
      [
        "project",
        "--aggressive",
        "--dry-run",
        "--jobs",
        "6",
        "--ignore",
        "dist/**",
        "--ignore=*.test.ts",
        "--library",
        "tooling.so",
        "--json",
      ],
      work,
    );
    expect(parsed.root).toBe(join(work, "project"));
    expect(parsed.libraryPath).toBe(join(work, "tooling.so"));
    expect(parsed.json).toBe(true);
    expect(parsed.options).toEqual({
      mode: "aggressive",
      dry_run: true,
      jobs: 6,
      ignore: ["dist/**", "*.test.ts"],
    });
    expect(parseN2bArguments(["--fix", "--jobs", "1"], work).options.mode).toBe("fix");
  });

  test("rejects invalid or ambiguous input before loading a provider", () => {
    for (const args of [
      ["--unknown"],
      ["one", "two"],
      ["--fix", "--aggressive"],
      ["--jobs"],
      ...["0", "7", "-1", "NaN", "1.5", "1e0", "+2", ""].map(jobs => [`--jobs=${jobs}`]),
      ["--ignore="],
      ["--ignore", "bad\0glob"],
      ["--library="],
      ["--library", "bad\0path"],
      [""],
      ["bad\0path"],
    ]) {
      expect(() => parseN2bArguments(args, work)).toThrow();
    }
  });

  test("retains check findings and gives severity errors precedence in every mode", () => {
    expect(n2bExitCode(report())).toBe(1);
    expect(n2bExitCode(report("fix"))).toBe(0);
    expect(n2bExitCode(report("aggressive"))).toBe(0);
    expect(n2bExitCode({ ...report(), files: [], findings_total: 0 })).toBe(0);
    for (const mode of ["check", "fix", "aggressive"] as const) {
      const result = report(mode);
      expect(
        n2bExitCode({
          ...result,
          files: result.files.map(file =>
            Object.assign({}, file, {
              findings: file.findings.map(finding => ({
                ...finding,
                severity: "error",
              })),
            }),
          ),
        }),
      ).toBe(2);
    }
  });

  test("renders locations and dry-run scope without modifying the native report", () => {
    const result = report("fix");
    const before = JSON.stringify(result);
    expect(renderN2bReport(result, true)).toBe(
      "N2B fix (dry run): 2 files scanned, 1 findings, 1 files would change\nentry.js:1:1 warn shebang/node: Use Bun in the shebang",
    );
    expect(JSON.stringify(result)).toBe(before);
  });

  test("CLI help works with a missing native library and leaves the directory untouched", () => {
    const before = readdirSync(work).toSorted();
    const help = run(["--help", "--library", missingLibrary]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("Usage: yolo n2b");
    expect(help.stdout.toString()).toContain("YOLO_TOOLING_LIB");
    expect(help.stderr.toString()).toBe("");
    expect(run(["-h"]).exitCode).toBe(0);
    expect(readdirSync(work).toSorted()).toEqual(before);
  });

  test("CLI argument and path errors are explicit and precede any native load", () => {
    for (const [args, message] of [
      [["--jobs", "0"], "--jobs"],
      [["--fix", "--aggressive"], "mutually exclusive"],
      [["--unknown"], "Unknown option"],
      [["absent-project"], "ENOENT"],
    ] as const) {
      const result = run([...args]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toContain(`yolo n2b:`);
      expect(result.stderr.toString()).toContain(message);
      expect(result.stderr.toString()).not.toContain(missingLibrary);
    }
    const file = join(work, "file.js");
    writeFileSync(file, "export {};");
    expect(run([file]).stderr.toString()).toContain("Project path must be a directory");
  });

  test("missing native libraries fail explicitly instead of invoking a substitute", () => {
    const result = run(["--json", "--library", missingLibrary]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("yolo n2b:");
    expect(result.stderr.toString()).toContain("Selected native tooling library is missing");
    expect(result.stderr.toString()).toContain("selection preserved");
  });

  test.skipIf(configuredLibrary === undefined)(
    "native check, preview, ignore and fix preserve their real file contracts",
    () => {
      const project = join(work, "native-project");
      mkdirSync(project);
      const file = join(project, "entry.js");
      const original = "#!/usr/bin/env node\nconsole.log('hello');\n";
      writeFileSync(file, original);
      const args = [project, "--library", resolve(configuredLibrary!), "--json", "--jobs", "1"];
      const checked = run(args, project, configuredLibrary);
      const checkedReport = JSON.parse(checked.stdout.toString()) as NodeProjectReport;
      expect(checkedReport.schema_version).toBe(2);
      expect(checkedReport.mode).toBe("check");
      expect(checkedReport.files.some(item => item.findings.some(finding => finding.rule_id === "shebang/node"))).toBe(
        true,
      );
      expect(checked.exitCode).toBe(n2bExitCode(checkedReport));
      expect(readFileSync(file, "utf8")).toBe(original);

      const preview = run([...args, "--fix", "--dry-run"], project, configuredLibrary);
      expect(preview.exitCode).toBe(0);
      expect((JSON.parse(preview.stdout.toString()) as NodeProjectReport).mode).toBe("fix");
      expect(readFileSync(file, "utf8")).toBe(original);

      const ignored = run([...args, "--aggressive", "--ignore", "entry.js"], project, configuredLibrary);
      expect(ignored.exitCode).toBe(0);
      expect((JSON.parse(ignored.stdout.toString()) as NodeProjectReport).findings_total).toBe(0);
      expect(readFileSync(file, "utf8")).toBe(original);

      const fixed = run([...args, "--fix"], project, configuredLibrary);
      expect(fixed.exitCode).toBe(0);
      expect(readFileSync(file, "utf8")).toContain("#!/usr/bin/env bun");
      expect(readFileSync(file, "utf8")).not.toBe(original);
    },
  );
});
