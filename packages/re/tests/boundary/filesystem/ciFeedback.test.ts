import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { expect, it } from "../../support/bunTest.js";
import { parse } from "yaml";
import { z } from "zod";

import {
  parseStaticTaskContext,
  recordStaticTaskContext,
} from "../../../scripts/ci/static-task-context.mjs";
import { createGhApiRequest } from "../../../scripts/ci/github-api.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const scopeFlags = async () =>
  z
    .object({ CI_FLAGS: z.array(z.string()) })
    .parse(
      await import(
        new URL("../../../scripts/ci/scopes.mjs", import.meta.url).href
      ),
    ).CI_FLAGS;
const workflow = async () =>
  z
    .object({
      jobs: z.record(
        z.string(),
        z
          .object({
            needs: z.union([z.string(), z.array(z.string())]).optional(),
            if: z.string().optional(),
            steps: z
              .array(
                z
                  .object({
                    run: z.string().optional(),
                    if: z.string().optional(),
                    uses: z.string().optional(),
                    with: z.record(z.string(), z.unknown()).optional(),
                    env: z.record(z.string(), z.string()).optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      ),
    })
    .parse(
      parse(
        await readFile(
          new URL("../../../.github/workflows/ci.yml", import.meta.url),
          "utf8",
        ),
      ),
    ).jobs;

const evaluateCondition = (
  condition: string,
  context: Record<string, unknown>,
): boolean =>
  z
    .boolean()
    .parse(
      runInNewContext(
        condition.startsWith("${{") ? condition.slice(3, -2) : condition,
        context,
        { timeout: 1_000 },
      ),
    );

it("records the actual static task graph with explicit source identity and no ambient environment", async () => {
  const directory = await createTestTempDirectory("rea-ci-context-");
  const context = await recordStaticTaskContext({ outputDirectory: directory });
  const head = await execute("git", ["rev-parse", "HEAD"]);
  expect(context.sourceSha).toBe(head.stdout.trim());
  expect(context.taskHashes["lint:built"]).toMatch(/^[a-f0-9]{16}$/u);
  expect(context.taskHashes.jscpd).toMatch(/^[a-f0-9]{16}$/u);
  expect(context).not.toHaveProperty("environmentVariables");
  expect(context).not.toHaveProperty("env");
  expect(
    JSON.parse(await readFile(`${directory}/static-task-context.json`, "utf8")),
  ).toEqual(context);
  for (const invalid of [
    undefined,
    {},
    { ...context, sourceSha: "bad" },
    { ...context, prHeadSha: "bad" },
    { ...context, taskHashes: { jscpd: "stale" } },
  ])
    expect(() => parseStaticTaskContext(invalid)).toThrow();
});

it("rejects mutation methods at the shared GitHub transport before invoking the CLI", async () => {
  const request = createGhApiRequest({ env: { PATH: "" } });
  await expect(
    request("POST", "repos/owner/repo/actions/runs/1/rerun", {
      requests: 0,
      startedAt: Date.now(),
      limitMs: 1000,
    }),
  ).rejects.toThrow("read-only GET");
});
