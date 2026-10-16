// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { filesPrompt, intentsOf, parseLink } from "./open-requests";

describe("parseLink", () => {
  test("navigates to known panes", () => {
    expect(parseLink("aphrody://settings")).toEqual({
      kind: "navigate",
      destination: "settings",
    });
    expect(parseLink("APHRODY://Drive/")).toEqual({
      kind: "navigate",
      destination: "drive",
    });
  });

  test("prefills the composer from ask links", () => {
    expect(parseLink("aphrody://ask?q=hello%20world")).toEqual({
      kind: "ask",
      prompt: "hello world",
    });
    expect(parseLink("aphrody://ask")).toEqual({
      kind: "navigate",
      destination: "agent",
    });
  });

  test("resumes threads", () => {
    expect(parseLink("aphrody://thread/abc-123")).toEqual({
      kind: "thread",
      id: "abc-123",
    });
    expect(parseLink("aphrody://thread")).toBeNull();
  });

  test("ignores foreign schemes, unknown panes and garbage", () => {
    expect(parseLink("https://settings")).toBeNull();
    expect(parseLink("aphrody://format-disk")).toBeNull();
    expect(parseLink("not a url")).toBeNull();
  });
});

describe("intentsOf", () => {
  test("keeps order and groups files per request", () => {
    const intents = intentsOf([
      {
        urls: ["aphrody://models", "aphrody://nope"],
        files: ["/a.md", "/b.txt"],
      },
      { urls: [], files: [] },
    ]);
    expect(intents).toEqual([
      { kind: "navigate", destination: "models" },
      { kind: "files", paths: ["/a.md", "/b.txt"] },
    ]);
  });

  test("builds a file prompt", () => {
    expect(filesPrompt(["/a.md"])).toBe("Open and summarize the file /a.md");
    expect(filesPrompt(["/a.md", "/b.md"])).toContain("- /b.md");
  });
});
