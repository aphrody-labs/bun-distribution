import { describe, expect, it } from "bun:test";
import { waitForSelector } from "../../lib/web-cdp-utils";

describe("waitForSelector", () => {
  it("polls the DOM expression without requiring a CDP server", async () => {
    let calls = 0;
    const fakePage = {
      evaluate: async <T>() => (++calls > 1) as T,
    };
    await waitForSelector(fakePage, "main", 500);
    expect(calls).toBe(2);
  });
});
