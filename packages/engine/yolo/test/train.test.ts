import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runTrainCommand } from "../src/train";

describe("yolo train delegates to aphrody train", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "yolo-train-"));
  const fake = resolve(dir, "aphrody");
  const log = resolve(dir, "args.log");

  beforeAll(async () => {
    await Bun.write(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\nexit 3\n`);
    await Bun.$`chmod +x ${fake}`.quiet();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("forwards every argument after `train` and returns the exit code of aphrody", async () => {
    const previous = process.env.APHRODY_BIN;
    process.env.APHRODY_BIN = fake;
    try {
      expect(await runTrainCommand(["run", "--kind", "embed"])).toBe(3);
      expect((await Bun.file(log).text()).trim().split("\n")).toEqual([
        "train",
        "run",
        "--kind",
        "embed",
      ]);
    } finally {
      if (previous === undefined) delete process.env.APHRODY_BIN;
      else process.env.APHRODY_BIN = previous;
    }
  });

  it("prints its own help without spawning anything", async () => {
    expect(await runTrainCommand(["--help"])).toBe(0);
  });
});
