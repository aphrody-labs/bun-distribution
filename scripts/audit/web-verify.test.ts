// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { repositoryRoot } from "../../packages/web/agent-browser/src/config.ts";
import {
  checkConfigFile,
  executionCommand,
  parseArgs,
  planStages,
  runStages,
  WEB_CRATES,
} from "./web-verify.ts";

describe("native gate execution", () => {
  test("Windows Cargo uses the native serialized build owner", () => {
    expect(
      executionCommand(["scripts/build/rust/cargo-serial.sh", "check", "--locked"], "win32"),
    ).toEqual([
      "pwsh.exe",
      "-NoProfile",
      "-File",
      "scripts/dev/windows-cargo.ps1",
      "check",
      "--locked",
    ]);
  });

  test("Bun child execution uses the running executable and preserves its exit status", async () => {
    const results = await runStages(
      [
        {
          id: "bun",
          steps: [
            {
              name: "native runtime",
              command: ["bun", "-e", "console.log(process.execPath);process.exit(7)"],
              timeoutMs: 10_000,
            },
            {
              name: "later step",
              command: ["bun", "-e", "console.log('continued')"],
              timeoutMs: 10_000,
            },
          ],
        },
      ],
      repositoryRoot(),
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain("exit 7");
    expect(results[0]?.detail).toContain(process.execPath);
    expect(results[1]?.ok).toBe(true);
  });

  test("a missing executable reports failure without aborting subsequent gates", async () => {
    const results = await runStages(
      [
        {
          id: "bun",
          steps: [
            {
              name: "missing",
              command: ["aphrody-nonexistent-web-gate-20261009"],
              timeoutMs: 10_000,
            },
            {
              name: "later step",
              command: ["bun", "-e", "console.log('continued')"],
              timeoutMs: 10_000,
            },
          ],
        },
      ],
      repositoryRoot(),
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).not.toBeEmpty();
    expect(results[1]?.ok).toBe(true);
  });
});

describe("web verify planning", () => {
  test("default stages run config, bun, build and smoke; rust is opt-in", () => {
    expect(planStages({}).map((stage) => stage.id)).toEqual(["config", "bun", "build", "smoke"]);
    expect(planStages({ rust: true }).map((stage) => stage.id)).toEqual([
      "config",
      "bun",
      "build",
      "smoke",
      "rust",
    ]);
  });

  test("explicit stages are honoured and crawlability is dropped when its script is absent", () => {
    expect(planStages({ stages: ["smoke"] }).map((stage) => stage.id)).toEqual(["smoke"]);
    expect(planStages({ stages: ["crawlability"], crawlabilityAvailable: false })).toEqual([]);
    expect(
      planStages({ stages: ["crawlability"], crawlabilityAvailable: true })[0]?.steps[0]?.command,
    ).toEqual(["bun", "scripts/audit/web-crawlability.ts"]);
  });

  test("the rust stage names every web crate and uses locked, warning-free clippy", () => {
    const rust = planStages({ stages: ["rust"] })[0]!;
    for (const step of rust.steps)
      for (const crate of WEB_CRATES) expect(step.command).toContain(crate);
    expect(rust.steps.map((step) => step.command?.[1])).toEqual(["check", "clippy", "test"]);
    expect(rust.steps[1]!.command!.join(" ")).toContain("-- -D warnings");
  });

  test("argument parsing rejects unknown stages", () => {
    expect(parseArgs(["--stage", "config,smoke", "--json"])).toMatchObject({
      stages: ["config", "smoke"],
      json: true,
      rust: false,
    });
    expect(() => parseArgs(["--stage", "nope"])).toThrow(/unknown stage/);
  });
});

describe("config contract check", () => {
  test("the repository config and its documents are valid", () => {
    expect(checkConfigFile(repositoryRoot())).toEqual([]);
  });

  test("a missing config is reported", () => {
    expect(checkConfigFile("/nonexistent-aphrody-root")).toEqual([
      "tools/config/web.json is missing",
    ]);
  });
});
