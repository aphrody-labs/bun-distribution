// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

for (const [flag, guardedOption] of [
  ["--help", "--seed-reviewed"],
  ["-h", "--legacy-bidirectional"],
] as const) {
  test(`Drive sync ${flag} returns help before validating or invoking sync`, async () => {
    const source = new URL("../src/drive-cli.ts", import.meta.url).pathname;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { runDriveCli } from ${JSON.stringify(source)}; await runDriveCli(${JSON.stringify(["sync", flag, guardedOption])});`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(0);
    expect(stdout).toStartWith("Usage: yolo google drive ");
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });
}
