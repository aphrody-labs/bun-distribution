import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

import { expect, it } from "../../support/bunTest.js";
import { parse } from "yaml";
import { z } from "zod";

import { planTestSelection } from "../../../scripts/ci/test-selection.mjs";

import { parseTestDurations } from "../../ciTestSequencer.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { workflowGit } from "../../support/workflowGit.js";

const execute = promisify(execFile);
const script = new URL("../../../scripts/ci/test-report.mjs", import.meta.url);

// Each report invocation owns its CI state and summary destination. Inherited
// workflow flags must not change fixture outcomes or append to the real job.
const executeTimingReport = async (
  root: string,
  environment: NodeJS.ProcessEnv = {},
) => {
  const summary = join(root, "summary.md");
  await writeFile(summary, "");
  const output = await execute(process.execPath, [fileURLToPath(script)], {
    cwd: root,
    env: {
      ...process.env,
      SHARD_RESULT: "success",
      MERGE_RESULT: "success",
      SOURCE_REQUIRED: "false",
      SOURCE_RESULT: "",
      CI_VERIFY_TEST_INVENTORY: "false",
      CI_TEST_SELECTION: "",
      ...environment,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  return { ...output, summary: await readFile(summary, "utf8") };
};

const stepsSchema = z.array(
  z.object({
    name: z.string().optional(),
    run: z.string().optional(),
    uses: z.string().optional(),
    if: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  }),
);
const workflow = async () =>
  z
    .object({
      jobs: z.object({
        test: z.object({ steps: stepsSchema }),
        build: z.object({ steps: stepsSchema }),
        docs: z.object({ steps: stepsSchema }),
        static: z.object({ steps: stepsSchema }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    ).jobs;

// These workflow conditions use the shared boolean/string expression subset.
// Evaluate the checked-in expressions so failure-state coverage cannot drift
// into a separate test implementation of the collection policy.
function conditionValue(
  condition: string | undefined,
  needs: Record<string, unknown>,
  canceled: boolean,
  timingReportExists = false,
) {
  if (!condition) throw new Error("Missing report collection condition");
  return runInNewContext(
    condition
      .replaceAll("needs.test-shard", 'needs["test-shard"]')
      .replaceAll("needs.test-source", 'needs["test-source"]'),
    {
      needs,
      cancelled: () => canceled,
      hashFiles: () => (timingReportExists ? "timing-report" : ""),
    },
    { timeout: 1_000 },
  );
}

it("requires portable report validation even when the timing report is missing", async () => {
  const summary = (await workflow()).test.steps.find((step) =>
    step.run?.includes("scripts/ci/test-report.mjs"),
  );
  for (const tier of ["fast", "full"]) {
    for (const timingReportExists of [false, true]) {
      for (const code of ["true", "false"]) {
        for (const canceled of [false, true]) {
          expect(
            conditionValue(
              summary?.if,
              { changes: { outputs: { code, tier } } },
              canceled,
              timingReportExists,
            ),
          ).toBe(code === "true" && !canceled);
        }
      }
    }
  }
});

it("keeps diagnosis available after merge failure and publishes only complete successful history", async () => {
  const steps = (await workflow()).test!.steps;
  const diagnosis = steps.find((step) => step.with?.name === "test-results");
  expect(diagnosis?.if).toContain("!cancelled()");
  expect(diagnosis?.if).not.toContain("success()");
  const history = steps.find((step) => step.with?.name === "test-timings");
  expect(history?.if).toContain("success()");
  expect(history?.if).toContain("needs.test-shard.result == 'success'");
  expect(history?.if).toContain("needs.changes.outputs.tier == 'full'");
  expect(history?.with?.path).toBe(".cache/ci-test-history/test-results.json");
  const buildSteps = (await workflow()).build!.steps;
  const lookup = buildSteps.find((step) =>
    step.run?.includes("test-history.mjs"),
  );
  expect(lookup?.env).toMatchObject({
    CI_REPOSITORY: "${{ github.repository }}",
    CI_REPOSITORY_ID: "${{ github.repository_id }}",
    CI_DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
  });
  const download = buildSteps.find(
    (step) => step.name === "Download previous timing report",
  );
  expect(download?.with?.name).toBe(history?.with?.name);
  expect(download?.with?.["run-id"]).toBe(
    "${{ steps.history.outputs.run-id }}",
  );
});

it("rejects successful shard reports with missing or duplicate portable files", async () => {
  const root = await createTestTempDirectory("rea-ci-report-inventory-");
  await workflowGit(root, ["init"]);
  await mkdir(join(root, "tests"));
  for (const name of ["first", "second"])
    await writeFile(join(root, `tests/${name}.test.ts`), "// fixture\n");
  await workflowGit(root, ["add", "tests"]);
  const run = async (names: readonly string[]) => {
    await writeFile(
      join(root, "test-timings.json"),
      JSON.stringify({
        version: 1,
        success: true,
        files: names.map((name) => ({ name, durationMs: 1 })),
      }),
    );
    return executeTimingReport(root, {
      CI_VERIFY_TEST_INVENTORY: "true",
    });
  };
  await expect(
    run(["tests/first.test.ts", "tests/second.test.ts"]),
  ).resolves.toMatchObject({ stderr: "" });
  for (const names of [
    ["tests/first.test.ts"],
    ["tests/first.test.ts", "tests/second.test.ts", "tests/unplanned.test.ts"],
    ["tests/first.test.ts", "tests/first.test.ts", "tests/second.test.ts"],
  ]) {
    await expect(run(names)).rejects.toMatchObject({
      stderr: expect.stringContaining("Incomplete portable test inventory"),
    });
    await expect(
      readFile(join(root, ".cache/ci-test-history/test-results.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
  await run(["tests/first.test.ts", "tests/second.test.ts"]);
  await rm(join(root, "test-timings.json"));
  await expect(
    executeTimingReport(root, { CI_VERIFY_TEST_INVENTORY: "true" }),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("ENOENT"),
  });
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("exports portable timing history and removes it on a failed, partial, or invalid rerun", async () => {
  const root = await createTestTempDirectory("rea-ci-report-");
  const summary = join(root, "summary.md");
  const history = join(root, ".cache/ci-test-history/test-results.json");
  const report = {
    version: 1,
    success: true,
    files: [
      {
        name: join(root, "tests/slow.test.ts"),
        durationMs: 100,
        phases: {
          execution: 20,
          preparation: 20,
          environment: 10,
          imports: 40,
          setup: 10,
        },
      },
      { name: join(root, "tests/fast.test.ts"), durationMs: 10 },
    ],
  };
  const run = async (
    value: unknown,
    shards = "success",
    merge = "success",
    source?: string,
  ) => {
    await writeFile(join(root, "test-timings.json"), JSON.stringify(value));
    return executeTimingReport(root, {
      SHARD_RESULT: shards,
      SOURCE_REQUIRED: String(source !== undefined),
      SOURCE_RESULT: source ?? "",
      MERGE_RESULT: merge,
    });
  };
  await run(report);
  const contents = await readFile(history, "utf8");
  expect(contents).not.toContain("phases");
  expect(contents).not.toContain("startTime");
  expect(contents).not.toContain(root);
  expect(
    parseTestDurations(contents, resolve(root, "different-checkout")),
  ).toEqual(
    new Map([
      ["tests/slow.test.ts", 100],
      ["tests/fast.test.ts", 10],
    ]),
  );
  for (const [value, shards, merge] of [
    [{ ...report, success: false }, "failure", "failure"],
    [report, "cancelled", "success"],
    [report, "success", "failure"],
  ] as const) {
    await run(report);
    await run(value, shards, merge);
    await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(summary, "utf8")).toContain("diagnostic only");
  }
  await run(report, "success", "success", "success");
  expect(await readFile(history, "utf8")).toContain('"success":true');
  for (const [shards, source] of [
    ["skipped", "success"],
    ["success", "skipped"],
    ["success", "cancelled"],
    ["success", "failure"],
    ["success", ""],
  ]) {
    await run(report);
    await run(report, shards, "success", source);
    await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
    const text = await readFile(summary, "utf8");
    expect(text).toContain(`Source result: ${source}.`);
    expect(text).toContain("diagnostic only");
    if (shards === "skipped" || source !== "failure")
      expect(text).toContain("Partial test diagnostics");
  }
  await run(report);
  await expect(
    run({
      ...report,
      files: [{ name: "../outside.test.ts", durationMs: 2 }],
    }),
  ).rejects.toMatchObject({ code: 1 });
  await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
  await run(report);
  await expect(
    run({
      ...report,
      files: [{ name: "tests/invalid.test.ts", durationMs: -1 }],
    }),
  ).rejects.toMatchObject({ code: 1 });
  await expect(readFile(history)).rejects.toMatchObject({ code: "ENOENT" });
});

it("records failed omissions from full reports without treating partial or unhandled outcomes as parity", async () => {
  const root = await createTestTempDirectory("rea-ci-selection-report-");
  await workflowGit(root, ["init"]);
  const paths = [
    "src/sqlite/provider.test.ts",
    "src/evm/provider.test.ts",
    "tests/boundary/mcp/workflow.test.ts",
  ];
  for (const path of paths) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "// fixture\n");
  }
  await workflowGit(root, ["add", "src", "tests"]);
  const timing = {
    version: 1,
    success: false,
    reason: "failed",
    unhandledErrors: 0,
    files: paths.map((name, index) => ({
      name,
      durationMs: 10,
      state: index === 1 ? "failed" : "passed",
    })),
  };
  const run = async (report: unknown, source = "failure") => {
    await writeFile(join(root, "test-timings.json"), JSON.stringify(report));
    await executeTimingReport(root, {
      SHARD_RESULT: "failure",
      SOURCE_REQUIRED: "true",
      SOURCE_RESULT: source,
      MERGE_RESULT: "failure",
      CI_VERIFY_TEST_INVENTORY: "true",
      CI_TEST_SELECTION: JSON.stringify(
        planTestSelection(["src/sqlite/Provider.ts"], "pull_request", "fast"),
      ),
      GITHUB_SHA: "merge-sha",
      CI_PR_HEAD_SHA: "pr-head-sha",
    });
    return JSON.parse(
      await readFile(
        join(root, ".cache/ci-test-selection/report.json"),
        "utf8",
      ),
    ) as unknown;
  };
  expect(await run(timing)).toMatchObject({
    observational: true,
    complete: true,
    selected: [paths[0], paths[2]],
    omitted: [paths[1]],
    missedFailures: [paths[1]],
    executionSha: "merge-sha",
    prHeadSha: "pr-head-sha",
  });
  for (const report of [
    { ...timing, files: timing.files.slice(0, 1) },
    { ...timing, unhandledErrors: 1 },
    { ...timing, reason: "interrupted" },
  ])
    expect(await run(report)).toMatchObject({ complete: false });
  for (const source of ["skipped", "cancelled", ""])
    expect(await run(timing, source)).toMatchObject({ complete: false });
  await expect(run({ ...timing, files: "invalid" })).rejects.toMatchObject({
    code: 1,
  });
  await expect(
    readFile(join(root, ".cache/ci-test-selection/report.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(root, ".cache/ci-test-history/test-results.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
