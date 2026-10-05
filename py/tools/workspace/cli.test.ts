// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { commands, measure, root } from "./cli.ts";

test("measurement preserves failure and resource evidence", async () => {
  const result = await measure([process.execPath, "tools/workspace/fixture.ts", "7"]);
  expect(result.exitCode).toBe(7);
  expect(result.success).toBe(false);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result).toHaveProperty("resourceUsage");
  expect(() => JSON.stringify(result)).not.toThrow();
});

test("missing executable is a structured failure", async () => {
  const result = await measure(["/nonexistent/aphrody-workspace-command"]);
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(127);
});

test("child output cannot contaminate JSON stdout", async () => {
  const child = Bun.spawn([process.execPath, "tools/workspace/fixture.ts", "measure"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(JSON.parse(stdout).success).toBe(true);
  expect(stderr).toContain("fixture stdout");
  expect(stderr).toContain("fixture stderr");
});

test("plan works from another cwd and unknown commands fail", async () => {
  for (const action of [
    "plan",
    "constructor",
    "lint extra",
    "lint --timeout-ms 0",
    "lint --timeout-ms NaN",
  ]) {
    const child = Bun.spawn(
      [process.execPath, `${root}tools/workspace/cli.ts`, ...action.split(" ")],
      {
        cwd: "/tmp",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, , code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const result = JSON.parse(stdout);
    expect(code).toBe(action === "plan" ? 0 : 2);
    expect(result.success).toBe(action === "plan");
    if (action === "plan") expect(result.root).toBe(root);
  }
});

test("all Python ecosystem entry points use uv and a lock", () => {
  for (const command of Object.values(commands)) {
    expect(command.slice(0, 3)).toEqual(["uv", "run", "--locked"]);
  }
});
