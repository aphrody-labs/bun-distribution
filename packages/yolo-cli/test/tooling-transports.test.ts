// SPDX-License-Identifier: MIT
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../core/src/server/http";
import { callTool } from "../../core/src/tools/host";

const root = mkdtempSync(join(tmpdir(), "yolo-tooling-transport-"));
const outside = mkdtempSync(join(tmpdir(), "yolo-tooling-outside-"));
const original = "#!/usr/bin/env node\nconsole.log('kept');\n";
writeFileSync(join(root, "entry.js"), original);
writeFileSync(join(outside, "private.js"), original);
const server = createApiServer({
  port: 0,
  hostname: "127.0.0.1",
  rootDir: root,
});
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
async function post(args: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${server.port}/api/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "yolo_n2b_scan", arguments: args }),
  });
}
test("native migration transport rejects writes and unbounded worker options", async () => {
  const responses = await Promise.all(
    [{ mode: "fix" }, { dry_run: false }, { jobs: 7 }, { jobs: 1.5 }].map(args => post(args)),
  );
  for (const response of responses) expect(response.status).toBe(400);
  expect(readFileSync(join(root, "entry.js"), "utf8")).toBe(original);
});
test("HTTP native scan contains both traversal and symlink roots", async () => {
  expect((await post({ path: outside })).status).toBe(400);
  symlinkSync(outside, join(root, "escape"), "dir");
  expect((await post({ path: "escape" })).status).toBe(400);
});
test.skipIf(!process.env["YOLO_TOOLING_LIB"])(
  "The tool host and HTTP use the same read-only native report",
  async () => {
    const host = await callTool("yolo_n2b_scan", { path: root, jobs: 2 }, root);
    expect(host.isError).not.toBe(true);
    const report = JSON.parse(host.content[0]!.text);
    const response = await post({ jobs: 2 });
    expect(response.status).toBe(200);
    const http = await response.json();
    expect(http).toEqual(report);
    expect(report.findings_total).toBeGreaterThan(0);
    expect(readFileSync(join(root, "entry.js"), "utf8")).toBe(original);
  },
);
