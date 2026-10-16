// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  measureStartupComparison,
  runStartupBenchCli,
  type StartupCommand,
} from "../../../../scripts/audit/bench/startup";

const command = (
  id: string,
  code = 'console.log("fixture")',
): StartupCommand => ({
  id,
  argv: [process.execPath, "-e", code],
  stdout: "fixture\n",
});

describe("fresh-process startup benchmark", () => {
  test("alternates real process pairs, checks output identity and keeps initial/primed raw timings", () => {
    const cwd = mkdtempSync(join(tmpdir(), "startup-test-"));
    try {
      const result = measureStartupComparison(
        command("reference"),
        command("candidate"),
        {
          samples: 10,
          warmupPairs: 2,
          cwd,
          env: { HOME: cwd },
        },
      );
      expect(result.identicalOutput).toBe(true);
      for (const phase of [
        result.initialFreshProcesses,
        result.primedFreshProcesses,
      ]) {
        expect(phase.pairs).toHaveLength(10);
        expect(phase.summary.referenceMs.count).toBe(10);
        expect(phase.summary.candidateMs.p50).toBeGreaterThan(0);
        expect(phase.summary.candidateMs.p95).toBeLessThanOrEqual(
          phase.summary.candidateMs.max,
        );
        for (const pair of phase.pairs) {
          expect(pair.order).toEqual(
            pair.index % 2 === 0
              ? ["reference", "candidate"]
              : ["candidate", "reference"],
          );
          expect(pair.reference.exitCode).toBe(0);
          expect(pair.candidate.stdoutSha256).toBe(pair.reference.stdoutSha256);
          expect(pair.reference.stdoutBytes).toBe(8);
          expect(pair.reference.elapsedMs).toBeGreaterThan(0);
          expect(pair.candidate.elapsedMs).toBeGreaterThan(0);
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test("rejects failure, mismatched output, timeouts and out-of-bounds sampling", () => {
    const cwd = mkdtempSync(join(tmpdir(), "startup-errors-"));
    try {
      const options = { samples: 10, warmupPairs: 0, cwd, env: { HOME: cwd } };
      expect(() =>
        measureStartupComparison(
          command("ref"),
          command("exit", "process.exit(7)"),
          options,
        ),
      ).toThrow("exit failed (exit 7");
      expect(() =>
        measureStartupComparison(
          command("ref"),
          command("wrong", 'console.log("wrong")'),
          options,
        ),
      ).toThrow("output identity changed");
      expect(() =>
        measureStartupComparison(
          command("ref"),
          command("slow", "setTimeout(()=>{},5000)"),
          {
            ...options,
            timeoutMs: 20,
          },
        ),
      ).toThrow("failed");
      expect(() =>
        measureStartupComparison(command("ref"), command("candidate"), {
          ...options,
          samples: 9,
        }),
      ).toThrow("samples");
      expect(() =>
        measureStartupComparison(command("ref"), command("candidate"), {
          ...options,
          warmupPairs: 21,
        }),
      ).toThrow("warmupPairs");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test("unknown CLI flags and missing values fail before any measurement", async () => {
    await expect(runStartupBenchCli(["--unknown"])).rejects.toThrow(
      "Unknown startup option",
    );
    await expect(runStartupBenchCli(["--out"])).rejects.toThrow(
      "Missing value",
    );
  });
});
