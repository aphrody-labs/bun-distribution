// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { fixturePages, isPdfBase64, isPngBase64, summarize, type Check } from "./web-smoke.ts";

describe("web smoke pure logic", () => {
  test("summarize fails on any failed check and on an empty run", () => {
    const ok: Check = { name: "a", ok: true, ms: 1, detail: "" };
    const bad: Check = { name: "b", ok: false, ms: 1, detail: "boom" };
    expect(summarize("bin", "v", [ok, ok]).ok).toBe(true);
    expect(summarize("bin", "v", [ok, bad])).toMatchObject({ ok: false, passed: 1, failed: 1 });
    expect(summarize("bin", "v", []).ok).toBe(false);
  });

  test("binary signatures are recognised from base64", () => {
    expect(
      isPngBase64(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
      ),
    ).toBe(true);
    expect(isPngBase64(Buffer.from("not a png").toString("base64"))).toBe(false);
    expect(isPdfBase64(Buffer.from("%PDF-1.7").toString("base64"))).toBe(true);
    expect(isPdfBase64("")).toBe(false);
  });

  test("fixture site has the robots-blocked page, a script page and linked pages", () => {
    const pages = fixturePages();
    expect(pages["/robots.txt"]?.body).toContain("Disallow: /private");
    expect(pages["/"]?.body).toContain('href="/about"');
    expect(pages["/"]?.body).toContain('href="/private/secret"');
    expect(pages["/js"]?.body).toContain("<script>");
    expect(pages["/js"]?.body).not.toContain("rendered-by-v8-42");
  });
});
