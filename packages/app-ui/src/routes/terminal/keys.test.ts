// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { keyToInput } from "./keys";

describe("terminal key input", () => {
  test("maps navigation and editing keys to VT sequences", () => {
    expect(
      keyToInput({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe("\r");
    expect(
      keyToInput({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe("\x1b[A");
    expect(
      keyToInput({
        key: "Delete",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe("\x1b[3~");
  });

  test("maps control shortcuts, preserves alt input and ignores meta shortcuts", () => {
    expect(
      keyToInput({ key: "l", ctrlKey: true, metaKey: false, altKey: false }),
    ).toBe("\x0c");
    expect(
      keyToInput({ key: "x", ctrlKey: false, metaKey: false, altKey: true }),
    ).toBe("\x1bx");
    expect(
      keyToInput({ key: "v", ctrlKey: false, metaKey: true, altKey: false }),
    ).toBeNull();
  });
});
