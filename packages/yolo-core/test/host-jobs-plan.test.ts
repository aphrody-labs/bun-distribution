// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { hostPlan, applyPlan, type Runner } from "../src/host/plan.ts";

test("A binary without native worker capability never provisions or starts the worker", async () => {
  const plan = hostPlan(["aphrody-jobs-worker-dbfr"], { target: "dbfr" });
  const commands: string[] = [];
  const run: Runner = async (_target, command) => {
    commands.push(command);
    return {
      code: command.includes("job run --help") ? 1 : 0,
      stdout: "",
      stderr: "",
    };
  };
  expect(await applyPlan(plan, run, () => {})).toEqual([
    "aphrody-jobs-worker-dbfr/jobs-capability",
  ]);
  expect(
    commands.some(
      (command) =>
        command.includes("install -d") || command.includes("systemctl enable"),
    ),
  ).toBe(false);
});

test("Pinned worker upgrades qualify the candidate before any installation", () => {
  const from = "/private/qualified/aphrody";
  const plan = hostPlan(["aphrody-jobs-worker-dbfr"], {
    target: "dbfr",
    binary: { from, sha256: "a".repeat(64) },
  });
  const candidate = plan.steps.find((step) =>
    step.id.endsWith("/binary-artifact"),
  );
  const capability = plan.steps.find((step) =>
    step.id.endsWith("/jobs-capability"),
  );
  const installation = plan.steps.find((step) =>
    step.id.endsWith("/install-binary"),
  );
  expect(candidate?.run).toContain(from);
  expect(capability?.phase).toBe("preflight");
  expect(capability?.run).toContain(`'${from}' job run --help`);
  expect(capability?.run).toContain("--host");
  expect(capability?.run).toContain("--concurrency");
  expect(installation?.run).toContain(".prev");
  expect(plan.steps.indexOf(capability!)).toBeLessThan(
    plan.steps.indexOf(installation!),
  );
  expect(() =>
    hostPlan(["aphrody-jobs-worker-dbfr"], {
      binary: { from, sha256: "wrong" },
    }),
  ).toThrow("SHA-256");
});
