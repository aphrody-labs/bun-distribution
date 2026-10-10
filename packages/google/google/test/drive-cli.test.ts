// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { runDriveCli } from "../src/drive-cli";

test("Drive sync help returns before option validation or credential access", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await runDriveCli(["sync", "--help", "--seed-reviewed"]);
    await runDriveCli(["sync", "-h", "--legacy-bidirectional"]);
  } finally {
    console.log = original;
  }
  expect(lines).toEqual([
    expect.stringContaining("Usage: yolo google drive "),
    expect.stringContaining("Usage: yolo google drive "),
  ]);
});
