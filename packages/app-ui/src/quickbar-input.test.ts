// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { buildInput, imageDataUrl } from "./quickbar-input";

describe("quick ask input", () => {
  test("plain question is a single text input", () => {
    expect(buildInput("bonjour", [])).toEqual([{ type: "text", text: "bonjour" }]);
  });

  test("files are referenced in the text, captures become image inputs", () => {
    const input = buildInput("explique", [
      { kind: "file", path: "C:/a.rs" },
      { kind: "image", label: "cap", url: "data:image/png;base64,AAAA" },
    ]);
    expect(input).toEqual([
      { type: "text", text: "explique\n\nAttached files:\n- C:/a.rs" },
      { type: "image", url: "data:image/png;base64,AAAA" },
    ]);
  });

  test("capture result yields the first image block as a data URL", () => {
    const result = {
      content: [
        { type: "text", text: "1920x1080" },
        { type: "image", data: "QUJD", mimeType: "image/png" },
      ],
    };
    expect(imageDataUrl(result)).toBe("data:image/png;base64,QUJD");
  });

  test("capture without image is rejected, never faked", () => {
    expect(imageDataUrl({ content: [{ type: "text", text: "denied" }] })).toBeNull();
    expect(imageDataUrl(null)).toBeNull();
    expect(imageDataUrl({ content: [{ type: "image", data: "" }] })).toBeNull();
  });
});
