// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { repositoryRoot } from "../../packages/web/agent-browser/src/config.ts";
import { checkConfigFile, parseArgs, planStages, WEB_CRATES } from "./web-verify.ts";

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
    expect(checkConfigFile("/nonexistent-aphrody-root")).toEqual(["tools/config/web.json is missing"]);
  });
});
