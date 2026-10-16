// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ctx } from "../src/context.ts";
import { install, stateOf } from "../src/systemd.ts";

const temporary: string[] = [];
afterEach(async () => {
  delete process.env.APHRODY_SYSTEMD_USER_DIR;
  delete process.env.APHRODY_YOLO_ROOT;
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("install plans only the named repo units and refuses unknown names", async () => {
  const root = await mkdtemp(join(tmpdir(), "update-systemd-"));
  temporary.push(root);
  const yolo = join(root, "yolo/packages/engine/core/src/units");
  await mkdir(yolo, { recursive: true });
  await writeFile(
    join(yolo, "index.ts"),
    `export const renderAll = () => ["aphrody-a.service", "aphrody-b.service"].map((file) => ({ file, text: "[Service]\\n" }));\n`,
  );
  process.env.APHRODY_YOLO_ROOT = join(root, "yolo");
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
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "aphrody-missing.service",
    );
    const dir = join(root, "installed");
    await writeFile(join(dir, "aphrody-a.service"), "[Service]\n");
    await writeFile(join(dir, "aphrody-b.service"), "stale\n");
    expect(stateOf(plan, "aphrody-a.service")).toBe("current");
    expect(stateOf(plan, "aphrody-b.service")).toBe("stale-copy");
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
