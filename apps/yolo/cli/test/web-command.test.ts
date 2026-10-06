// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const fixture = mkdtempSync(join(tmpdir(), "yolo-web-exit-"));
mkdirSync(join(fixture, "m3/packages/app-ui"), { recursive: true });
writeFileSync(
  join(fixture, "m3/packages/app-ui/package.json"),
  JSON.stringify({
    scripts: { build: "bun -e 'process.exit(23)'", dev: "bun -e 'process.exit(24)'" },
  }),
);
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
const cli = resolve(import.meta.dir, "../../../../bin/yolo");
for (const [command, action, code] of [
  ["web", "build", 23],
  ["desktop", "build", 23],
  ["tauri", "build", 23],
  ["web", "dev", 24],
] as const) {
  test(`${command} ${action} preserves the app's failure code`, async () => {
    const proc = Bun.spawn([cli, command, action], {
      cwd: fixture,
      env: { ...process.env, YOLO_HOME: fixture },
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).toBe(code);
  });
}
