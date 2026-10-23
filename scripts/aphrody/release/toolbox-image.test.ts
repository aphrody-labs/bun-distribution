import { expect, test } from "bun:test";
import { parseArgs, toolboxTag } from "./toolbox-image";
const digest = "a".repeat(64);
const base = "aphrody-build@sha256:" + "b".repeat(64);
test("recovery accepts an explicitly pinned existing base", () => {
  expect(parseArgs(["--base", base]).base).toBe(base);
});
test("mutable or injected base names are rejected", () => {
  for (const value of ["ubuntu:latest", "aphrody-build", base + "\nRUN true"])
    expect(() => parseArgs(["--base", value])).toThrow();
});
test("changing the base cannot reuse a binary-only immutable tag", () => {
  expect(toolboxTag(digest)).toBe("toolbox-aaaaaaaaaaaa");
  expect(toolboxTag(digest, base)).not.toBe(toolboxTag(digest));
  expect(toolboxTag(digest, base)).not.toBe(toolboxTag(digest, base.replaceAll("b", "c")));
});
