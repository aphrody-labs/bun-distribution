import { describe, expect, test } from "bun:test";
import { packageManagerInvocation } from "../src/package-manager";

describe("bep package manager", () => {
  test("delegates Bun package-manager commands without rewriting arguments", () => {
    expect(packageManagerInvocation(["add", "react", "--exact"])).toEqual(["add", "react", "--exact"]);
    expect(packageManagerInvocation(["install", "--frozen-lockfile"])).toEqual(["install", "--frozen-lockfile"]);
    expect(packageManagerInvocation(["pm", "ls"])).toEqual(["pm", "ls"]);
  });

  test("rejects non-package-manager commands", () => {
    expect(() => packageManagerInvocation(["run", "postinstall"])).toThrow("usage: bep");
  });
});
