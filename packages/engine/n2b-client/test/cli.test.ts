// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// End-to-end tests that invoke the Rust binary `n2b` via the TS façade.
// Runs against `crates/compat/n2b/tests/baselines/rpb-dashboard-baseline/scan.json` baseline (bypassing
// subprocess cost) for the shape-level assertions, and against a real
// subprocess call on `test/fixture/` for the live integration check.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { scan, binaryVersion } from "../src/cli";
import type { N2BReport } from "@aphrody/n2b-types";

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aphrody-n2b-test-"));
  await writeFile(
    join(root, "server.ts"),
    [
      'import express from "express";',
      "const app = express();",
      'app.get("/health", (_request, response) => response.send("ok"));',
      "app.listen(3000);",
    ].join("\n"),
  );
  return root;
}

describe("@n2b/core CLI wrapper", () => {
  test("binaryVersion returns a semver-ish string", async () => {
    const v = await binaryVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("scan on test/fixture returns a valid N2BReport", async () => {
    const root = await createFixture();
    try {
      const report = await scan(root, { quiet: true });
      expect(report.schema_version).toBe(2);
      expect(report.tool).toBe("node2bun");
      expect(report.mode).toBe("check");
      expect(report.files.length).toBeGreaterThan(0);
      for (const file of report.files) {
        expect(file).toHaveProperty("path");
        expect(file).toHaveProperty("changed");
        expect(file).toHaveProperty("findings");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("subprocess scan is deterministic for an unchanged tree", async () => {
    const root = await createFixture();
    try {
      const [first, second] = await Promise.all([
        scan(root, { quiet: true }),
        scan(root, { quiet: true }),
      ]);
      const normalize = (report: N2BReport) => ({
        ...report,
        root: "<root>",
        version: "<version>",
      });
      expect(normalize(first)).toEqual(normalize(second));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
