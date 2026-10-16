// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { runPythonCommand } from "../src/python";

const repo = join(import.meta.dir, "../../../docs/aphrody");

async function capture(
  args: string[],
): Promise<{ code: number; text: string }> {
  const original = console.log;
  let text = "";
  console.log = (line: string) => {
    text += line;
  };
  try {
    const code = await runPythonCommand(args, repo, {
      env: { PATH: process.env["PATH"] },
    });
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

// The vu verbs are delegated to the installed artifact's binary (plan D18); yolo never links vu.
test.skipIf(process.platform !== "linux")(
  "yolo py delegates vu verbs to the artifact's bin/vu and strips the yolo-only flags",
  async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "yolo-vu-delegate-"));
    try {
      mkdirSync(join(dir, "bin"), { recursive: true });
      mkdirSync(join(dir, "share/vu"), { recursive: true });
      const files: Record<string, { sha256: string; bytes: number }> = {};
      for (const name of ["vu", "uv", "ruff"]) {
        const text = `#!/bin/sh\necho ${name}\n`;
        writeFileSync(join(dir, "bin", name), text);
        chmodSync(join(dir, "bin", name), 0o755);
        files[`bin/${name}`] = {
          sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
          bytes: Buffer.byteLength(text),
        };
      }
      const { hostTarget } = await import("../src/vu");
      writeFileSync(
        join(dir, "share/vu/manifest.json"),
        JSON.stringify({
          schema: 1,
          name: "vu-runtime",
          version: "0.1.0",
          target: hostTarget(),
          toolchain: "t",
          revision: "a".repeat(40),
          pins: {},
          compatibility: { cliMajor: 0 },
          capabilities: ["uv", "ruff", "python"],
          files,
          links: {},
        }),
      );
      const calls: string[][] = [];
      const run = async (command: string[]) => {
        calls.push(command);
        return 0;
      };
      const code = await runPythonCommand(
        ["python", "install", "3.14", "--vu", dir],
        repo,
        {
          env: { PATH: process.env["PATH"] },
          run,
        },
      );
      expect(code).toBe(0);
      expect(calls).toEqual([
        [join(dir, "bin/vu"), "python", "install", "3.14"],
      ]);
      await runPythonCommand(
        ["vu", "hf", "status", "--vu", dir, "--vu-full"],
        repo,
        {
          env: { PATH: process.env["PATH"] },
          run,
        },
      );
      expect(calls[1]).toEqual([join(dir, "bin/vu"), "hf", "status"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("yolo py refuses a vu verb when no runtime is installed", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (line: string) => errors.push(String(line));
  try {
    const code = await runPythonCommand(["add", "httpx", "--no-vu"], repo, {
      env: { PATH: process.env["PATH"] },
      run: async () => 0,
    });
    expect(code).toBe(3);
    expect(errors.join("\n")).toContain("the vu runtime is not installed");
  } finally {
    console.error = original;
  }
});
