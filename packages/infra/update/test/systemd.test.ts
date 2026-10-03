// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ctx } from "../src/context.ts";
import { install } from "../src/systemd.ts";

const temporary: string[] = [];
afterEach(async () => {
  delete process.env.APHRODY_SYSTEMD_USER_DIR;
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

test("install plans only the named repo units and refuses unknown names", async () => {
  const root = await mkdtemp(join(tmpdir(), "update-systemd-"));
  temporary.push(root);
  await mkdir(join(root, "config/systemd/user"), { recursive: true });
  for (const unit of ["aphrody-a.service", "aphrody-b.service"])
    await writeFile(join(root, "config/systemd/user", unit), "[Service]\n");
  process.env.APHRODY_SYSTEMD_USER_DIR = join(root, "installed");
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const plan = new Ctx(root, false, false);
    expect(install(plan, ["aphrody-b.service"])).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
      "would  aphrody-b.service (missing)",
    ]);
    log.mockClear();
    expect(install(plan)).toBe(0);
    expect(log.mock.calls).toHaveLength(2);
    expect(install(plan, ["aphrody-missing.service"])).toBe(2);
    expect(String(error.mock.calls[0]?.[0])).toContain("aphrody-missing.service");
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
