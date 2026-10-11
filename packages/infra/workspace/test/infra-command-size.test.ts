// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { prepareInfraCommand, windowsCommandBound } from "../src/runtime.ts";

const invocation = (script: string) => [
  "aphrody.exe",
  "infra",
  "--root",
  "C:/aphrody",
  "ssh",
  "exec",
  "--host",
  "vps",
  "--cmd",
  script,
];

test("Windows Infra compresses large SSH scripts losslessly including trailing newlines", () => {
  const script = "printf '%s' \"quote ' and \\\" and $() and 🐈\"\n".repeat(2500) + "\n\n";
  const before = invocation(script);
  const prepared = prepareInfraCommand(before, "win32");
  expect(prepared.slice(0, -1)).toEqual(before.slice(0, -1));
  expect(before.at(-1)).toBe(script);
  expect(windowsCommandBound(prepared)).toBeLessThan(30000);
  const compact = prepared.at(-1)!.replaceAll("'\\''", "'");
  const payload = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(compact)![1]!;
  expect(Buffer.from(Bun.gunzipSync(Buffer.from(payload, "base64"))).toString("utf8")).toBe(script);
  expect(compact).toContain('exec bash -c "${payload%.}"');
  expect(compact).toContain("set -o pipefail");
});
test("Infra preserves short commands and non-Windows transports exactly", () => {
  const command = invocation("exit 17\n");
  expect(prepareInfraCommand(command, "win32")).toEqual(command);
  expect(prepareInfraCommand(invocation("x".repeat(50000)), "linux")).toEqual(
    invocation("x".repeat(50000)),
  );
});
test("Infra refuses oversized unsupported and incompressible invocations before spawning", () => {
  expect(() => prepareInfraCommand(["aphrody.exe", "x".repeat(40000)], "win32")).toThrow("budget");
  expect(() =>
    prepareInfraCommand(invocation(randomBytes(100000).toString("hex")), "win32"),
  ).toThrow("nothing dispatched");
  expect(() => prepareInfraCommand(invocation("x\0y"), "win32")).toThrow("NUL");
});
