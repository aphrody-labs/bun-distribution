// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPILE_FLAGS } from "../../../../scripts/aphrody/release/compile-flags";
import { runSupervisorBenchCli, runSupervisorBenchmark } from "./supervisor-benchmark";

describe("native supervisor benchmark", () => {
  test("the direct entrypoint reports help and usage failures without acquiring artifacts", () => {
    const script = join(import.meta.dir, "supervisor-benchmark.ts");
    for (const [args, expectedCode, expectedText] of [
      [["--help"], 0, "Usage: yolo bench --supervisor"],
      [["--unrecognized"], 2, "Unknown benchmark option"],
      [[], 2, "--artifact is required"],
    ] as const) {
      const result = Bun.spawnSync([process.execPath, script, ...args], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      });
      expect(result.exitCode).toBe(expectedCode);
      const output = result.stdout.toString() + result.stderr.toString();
      expect(output).toContain(expectedText);
      expect(output).not.toContain("No manifest.json");
    }
  });

  test("a bytecode executable can import the benchmark without running its entrypoint", () => {
    const temporary = mkdtempSync(join(tmpdir(), "yolo-bench-import-"));
    try {
      const entry = join(temporary, "entry.ts");
      const binary = join(temporary, process.platform === "win32" ? "import.exe" : "import");
      writeFileSync(
        entry,
        `import { runSupervisorBenchmark } from ${JSON.stringify(join(import.meta.dir, "supervisor-benchmark.ts"))};\nconsole.log("BENCHMARK_IMPORTED", typeof runSupervisorBenchmark);\n`,
      );
      const compiled = Bun.spawnSync(
        [process.execPath, "build", "--compile", ...COMPILE_FLAGS, entry, "--outfile", binary],
        { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout: 30000 },
      );
      expect({
        code: compiled.exitCode,
        error: compiled.stderr.toString(),
      }).toEqual({
        code: 0,
        error: "",
      });
      const imported = Bun.spawnSync([binary, "--artifact", "/absent-runtime"], {
        windowsHide: true,
        cwd: temporary,
        env: {
          PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      });
      expect(imported.exitCode).toBe(0);
      expect(imported.stdout.toString()).toBe("BENCHMARK_IMPORTED function\n");
      expect(imported.stderr.toString()).toBe("");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 35000);

  test("invalid sampling and unknown CLI options fail before acquiring artifacts", async () => {
    await expect(runSupervisorBenchmark({ artifact: "/absent-runtime", samples: 0 })).rejects.toThrow(
      "samples must be an integer in 10..100",
    );
    await expect(runSupervisorBenchmark({ artifact: "/absent-runtime", samples: 10.5 })).rejects.toThrow(
      "samples must be an integer in 10..100",
    );
    await expect(runSupervisorBenchCli(["--artifact"])).rejects.toThrow("Missing value");
    await expect(runSupervisorBenchCli(["--unrecognized"])).rejects.toThrow("Unknown benchmark");
  });

  const artifact = process.env.YOLO_BENCH_ARTIFACT;
  const sdkDirectory = process.env.YOLO_BENCH_SDK;
  test.skipIf(!artifact || !sdkDirectory)(
    "paired real process lifecycles preserve exact output and auditable distributions",
    async () => {
      const result = await runSupervisorBenchmark({
        artifact: artifact!,
        sdkDirectory: sdkDirectory!,
        samples: 10,
      });
      expect(result.target).toBe(result.artifact.build.target);
      expect(result.artifact.librarySha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.sdk.modulesSha256).toMatch(/^[a-f0-9]{64}$/);
      for (const phase of [result.cold, result.warm]) {
        expect(phase.pairs).toHaveLength(10);
        expect(phase.summary.directMs.count).toBe(10);
        expect(phase.summary.nativeMs.count).toBe(10);
        expect(phase.summary.pairedNativeMinusDirectMs.count).toBe(10);
        expect(phase.summary.directMs.p50).toBeGreaterThan(0);
        expect(phase.summary.nativeMs.p50).toBeGreaterThan(0);
        expect(phase.summary.directMs.max).toBeGreaterThanOrEqual(phase.summary.directMs.p95);
        expect(phase.summary.nativeMs.max).toBeGreaterThanOrEqual(phase.summary.nativeMs.p95);
        for (const pair of phase.pairs) {
          expect(pair.order).toEqual(pair.pair % 2 === 0 ? ["direct", "native"] : ["native", "direct"]);
          for (const sample of [pair.direct, pair.native]) {
            expect(sample.exitCode).toBe(0);
            expect(sample.stdoutSha256).toBe(result.protocol.identity.stdoutSha256);
            expect(sample.stderrSha256).toBe(result.protocol.identity.stderrSha256);
            expect(sample.stdoutBytes).toBe(4096);
            expect(sample.stderrBytes).toBe(2048);
            expect(sample.rssBytes).toBeGreaterThan(0);
          }
        }
      }
      expect(result.cold.summary.directDriverMs!.p50).toBeGreaterThan(0);
      expect(result.cold.summary.nativeDriverMs!.p50).toBeGreaterThan(0);
      expect(result.warm.summary.directDriverMs).toBeUndefined();
    },
    30_000,
  );
});
