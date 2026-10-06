// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { runPythonCommand } from "../src/python";

const repo = join(import.meta.dir, "../../../..");

async function capture(args: string[]): Promise<{ code: number; text: string }> {
  const original = console.log;
  let text = "";
  console.log = (line: string) => {
    text += line;
  };
  try {
    const code = await runPythonCommand(args, repo, { env: { PATH: process.env["PATH"] } });
    return { code, text };
  } finally {
    console.log = original;
  }
}

test("yolo py plan lists the supervised py/ workspace commands without running any", async () => {
  const { code, text } = await capture(["plan", "--no-vu"]);
  const plan = JSON.parse(text);
  expect(code).toBe(0);
  expect(plan.root).toBe(join(repo, "py"));
  expect(Object.keys(plan.commands)).toContain("locks");
  expect(Object.keys(plan.commands)).toContain("format:check");
});

test("yolo py supervised commands reject unknown extra arguments and bad timeouts", async () => {
  const bad = await capture(["check", "extra", "--no-vu"]);
  expect(bad.code).toBe(2);
  const timeout = await capture(["check", "--timeout-ms", "0", "--no-vu"]);
  expect(timeout.code).toBe(2);
  expect(JSON.parse(timeout.text).error).toBe("Invalid timeout");
});
