// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { cleanup, tmp } from "./helpers";

afterAll(cleanup);

test("CLI rejects templates not offered by the canonical scaffolder", async () => {
  await expect(runCli(["create", "spa", "unused", "--dry-run"])).rejects.toThrow(
    /unknown template spa \(web, app, example\)/,
  );
  await expect(runCli(["create", "unknown", "unused", "--dry-run"])).rejects.toThrow(/unknown template unknown/);
});

test("CLI renders canonical web template in dry-run mode without creating output", async () => {
  const directory = join(tmp("m3-cli-create-"), "web");
  const log = console.log;
  const lines: string[] = [];
  console.log = (...values: unknown[]) => {
    lines.push(values.join(" "));
  };
  try {
    expect(await runCli(["create", "web", directory, "--dry-run"])).toBe(0);
    expect(lines.join("\n")).toContain("m3-bun create web web: 6 files (dry run)");
    expect(existsSync(directory)).toBe(false);
  } finally {
    console.log = log;
  }
});
