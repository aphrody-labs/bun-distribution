import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  scanDirectory,
  renderScanMarkdown,
  renderScanTerminal,
  runScanCommand,
  type ScanReport,
} from "../src/scan";

const rootDir = resolve(import.meta.dir, "../../../docs/aphrody");

describe("yolo scan CLI arguments", () => {
  const fixtureDir = mkdtempSync(resolve(tmpdir(), "yolo-scan-args-"));

  beforeAll(async () => {
    mkdirSync(resolve(fixtureDir, "nested"));
    mkdirSync(resolve(fixtureDir, "skip"));
    mkdirSync(resolve(fixtureDir, "-target"));
    await Promise.all([
      Bun.write(resolve(fixtureDir, "alpha.ts"), "export const alpha = 1;\n"),
      Bun.write(
        resolve(fixtureDir, "nested/beta.ts"),
        "export const beta = 2;\n",
      ),
      Bun.write(
        resolve(fixtureDir, "skip/generated.ts"),
        "export const generated = true;\n",
      ),
      Bun.write(resolve(fixtureDir, "README.md"), "# scan fixture\n"),
      Bun.write(
        resolve(fixtureDir, "-target/gamma.ts"),
        "export const gamma = 3;\n",
      ),
    ]);
  });

  afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

  async function invoke(args: readonly string[]): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }> {
    const proc = Bun.spawn(
      [
        process.execPath,
        resolve(rootDir, "packages/engine/yolo/src/index.ts"),
        "scan",
        ...args,
      ],
      {
        windowsHide: true,
        cwd: fixtureDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, stdout, stderr };
  }

  it.each([
    [
      "before dir",
      [
        "--exts",
        "ts",
        "--exclude",
        "skip,-target",
        "--parallel",
        "2",
        ".",
        "--json",
      ],
    ],
    [
      "after dir",
      [
        ".",
        "--exts",
        ".ts",
        "--exclude",
        "skip,-target",
        "--parallel",
        "2",
        "--json",
      ],
    ],
    [
      "mixed with equals",
      ["--exts= ts ", ".", "--exclude=skip,-target", "--parallel=2", "--json"],
    ],
  ])("consumes option values %s", async (_label, args) => {
    const result = await invoke(args as string[]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as ScanReport;
    expect(report.target).toBe(fixtureDir);
    expect(report.totalFiles).toBe(2);
    expect(report.byExtension.map((entry) => entry.ext)).toEqual([".ts"]);
    expect(report.largestFiles.map((entry) => entry.path).toSorted()).toEqual([
      "alpha.ts",
      "nested/beta.ts",
    ]);
  });

  it("uses the supplied default root when option values are the only arguments", async () => {
    const output: string[] = [];
    const code = await runScanCommand(
      [
        "--exts",
        "ts",
        "--exclude",
        "skip,-target",
        "--parallel",
        "2",
        "--json",
      ],
      fixtureDir,
      (text) => output.push(text),
    );
    expect(code).toBe(0);
    const report = JSON.parse(output.join("")) as ScanReport;
    expect(report.target).toBe(fixtureDir);
    expect(report.totalFiles).toBe(2);
  });

  it("scans a directory starting with - after the option terminator", async () => {
    const result = await invoke(["--json", "--", "-target"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as ScanReport;
    expect(report.target).toBe(resolve(fixtureDir, "-target"));
    expect(report.totalFiles).toBe(1);
  });

  it("prints scan help without scanning the default root", async () => {
    const output: string[] = [];
    expect(
      await runScanCommand(["--help"], resolve(fixtureDir, "missing"), (text) =>
        output.push(text),
      ),
    ).toBe(0);
    expect(output.join("\n")).toContain("Usage: yolo scan [dir] [options]");
    expect(output.join("\n")).toContain("--parallel N");
    const result = await invoke(["-h"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--exts LIST");
    expect(result.stdout).not.toContain("Tree Fingerprint");
  });

  it.each(["--exts", "--exclude", "--parallel"])(
    "rejects a missing value for %s",
    async (option) => {
      const result = await invoke([option]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(option);
      expect(result.stderr).toMatch(/argument|value/i);

      const beforeFlag = await invoke([option, "--json"]);
      expect(beforeFlag.code).toBe(1);
      expect(beforeFlag.stdout).toBe("");
      expect(beforeFlag.stderr).toContain(option);
    },
  );

  it.each([
    "0",
    "-1",
    "1.5",
    "2workers",
    "NaN",
    "Infinity",
    "",
    "9007199254740992",
  ])("rejects invalid worker count %j", async (value) => {
    const result = await invoke([".", `--parallel=${value}`, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "--parallel requires a positive safe integer",
    );
  });

  it.each([
    ["--exts", ""],
    ["--exts", "ts,,rs"],
    ["--exclude", " "],
    ["--exclude", "skip,"],
  ])("rejects an empty list item in %s %j", async (option, value) => {
    const result = await invoke([".", option, value, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `${option} requires a non-empty comma-separated list`,
    );
  });

  it("rejects unknown options, extra directories and conflicting formats", async () => {
    await Promise.all(
      [["--unknown"], [".", "nested"], ["--json", "--md"]].map(async (args) => {
        const result = await invoke(args);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(
          /Unknown option|at most one scan directory|one output format/,
        );
      }),
    );
  });

  it("returns a meaningful failure for a nonexistent directory", async () => {
    const result = await invoke(["--exts", "ts", "--json", "missing"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `Target path does not exist: ${resolve(fixtureDir, "missing")}`,
    );
  });
});

describe("yolo scan (Native Bun Parallel Recursive Scanner)", () => {
  it("should scan directory and return schema yolo.scan/1 with lines and fingerprint", async () => {
    const report = await scanDirectory(
      resolve(rootDir, "packages/engine/yolo/src"),
    );
    expect(report.schema).toBe("yolo.scan/1");
    expect(report.totalFiles).toBeGreaterThan(5);
    expect(report.totalBytes).toBeGreaterThan(10000);
    expect(report.totalLines).toBeGreaterThan(500);
    expect(report.treeFingerprint).toBeDefined();
    expect(report.treeFingerprint.length).toBeGreaterThan(0);
    expect(report.byExtension.length).toBeGreaterThan(0);
    expect(report.largestFiles.length).toBeGreaterThan(0);
  });

  it("should filter by extension correctly", async () => {
    const report = await scanDirectory(
      resolve(rootDir, "packages/engine/yolo/src"),
      {
        exts: ["ts"],
      },
    );
    expect(report.totalFiles).toBeGreaterThan(0);
    for (const extStat of report.byExtension) {
      expect(extStat.ext).toBe(".ts");
    }
  });

  it("should render markdown and terminal outputs without errors", async () => {
    const report = await scanDirectory(
      resolve(rootDir, "packages/engine/yolo/src"),
      {
        maxFiles: 5,
      },
    );
    const md = renderScanMarkdown(report);
    expect(md).toContain("# yolo scan:");
    expect(md).toContain("| Extension |");

    const term = renderScanTerminal(report);
    expect(term).toContain("=== YOLO Recursive Scan ===");
  });
});

describe("yolo scan --ingest delegates to the aphrody home pipeline", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "yolo-scan-ingest-"));
  const fake = resolve(
    dir,
    process.platform === "win32" ? "aphrody.cmd" : "aphrody",
  );
  const log = resolve(dir, "args.log");

  beforeAll(async () => {
    if (process.platform === "win32") {
      await Bun.write(
        fake,
        `@echo off\r\n(for %%a in (%*) do @echo %%~a) > "${log}"\r\necho {"source":"fake","indexed":1}\r\n`,
      );
      return;
    }
    await Bun.write(
      fake,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\necho '{"source":"fake","indexed":1}'\n`,
    );
    await Bun.$`chmod +x ${fake}`.quiet();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("passes profile, root and label to `aphrody home index` and prints its JSON", async () => {
    const previous = process.env.APHRODY_BIN;
    process.env.APHRODY_BIN = fake;
    try {
      const lines: string[] = [];
      const code = await runScanCommand(
        ["--ingest", "--profile", "dbfr", "--label", "repo", dir],
        dir,
        (s) => lines.push(s),
      );
      expect(code).toBe(0);
      expect(JSON.parse(lines.join("\n"))).toEqual({
        source: "fake",
        indexed: 1,
      });
      const args = (await Bun.file(log).text()).trim().split(/\r?\n/);
      expect(args).toEqual([
        "home",
        "--profile",
        "dbfr",
        "index",
        dir,
        "--label",
        "repo",
      ]);
    } finally {
      if (previous === undefined) delete process.env.APHRODY_BIN;
      else process.env.APHRODY_BIN = previous;
    }
  });

  it("rejects --profile without --ingest and reports a missing binary", async () => {
    expect(
      await runScanCommand(["--profile", "dbfr", dir], dir, () => {}),
    ).toBe(1);
    const previous = {
      a: process.env.APHRODY_BIN,
      y: process.env.YOLO_APHRODY_BIN,
      p: process.env.PATH,
    };
    process.env.APHRODY_BIN = "";
    process.env.YOLO_APHRODY_BIN = "";
    process.env.PATH = dir + "/nowhere";
    try {
      expect(await runScanCommand(["--ingest", dir], dir, () => {})).toBe(127);
    } finally {
      process.env.APHRODY_BIN = previous.a;
      process.env.YOLO_APHRODY_BIN = previous.y;
      process.env.PATH = previous.p;
    }
  });
});
