// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { replaceInBlock } from "../src/sources/drift.ts";

const manifest = `{
  "sources": [
    { "id": "alpha", "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sparse": ["x"] },
    { "id": "beta", "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "version": "0.7.0" }
  ]
}`;

describe("replaceInBlock", () => {
  test("rewrites only the target block and keeps formatting", () => {
    const out = replaceInBlock(manifest, "beta", "version", "0.7.0", "0.8.0");
    expect(out).toContain('"version": "0.8.0"');
    expect(out).toContain(
      '"commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sparse": ["x"]',
    );
    expect(out.replace("0.8.0", "0.7.0")).toBe(manifest);
  });
  test("does not leak into the next block", () => {
    const out = replaceInBlock(
      manifest,
      "alpha",
      "commit",
      "a".repeat(40),
      "c".repeat(40),
    );
    expect(out).toContain(`"commit": "${"c".repeat(40)}"`);
    expect(out).toContain(`"commit": "${"b".repeat(40)}"`);
  });
  test("throws when the pin is not in the block", () => {
    expect(() =>
      replaceInBlock(manifest, "alpha", "version", "1.0.0", "2.0.0"),
    ).toThrow();
    expect(() =>
      replaceInBlock(manifest, "nope", "commit", "x", "y"),
    ).toThrow();
  });
});
