// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { runXWebRecon } from "./src/tools/web-recon";

describe("X recon native transport", () => {
  test("browser profiles are routed to the Rust renderer", async () => {
    await Promise.all(
      (["fast", "stealth", "max"] as const).map(async (profile) => {
        const report = await runXWebRecon(profile, []);
        expect(report.profile).toBe(profile);
        expect(report.results).toEqual({});
      }),
    );
  });

  test("HTTP recon returns a native validation error for an invalid URL", async () => {
    const report = await runXWebRecon("http", ["invalid-url"]);
    expect(report.profile).toBe("http");
    expect(report.results["invalid-url"]?.error).toContain("url must be absolute");
  });

  test("empty static recon returns an empty report", async () => {
    const report = await runXWebRecon("static", []);
    expect(report.results).toEqual({});
  });
});
