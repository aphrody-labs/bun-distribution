// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import cases from "../fixtures/policy-cases.json";
import {
  decide,
  matchesPattern,
  originOf,
  parsePattern,
} from "../src/policy.ts";
import type { WrapOrigins } from "../src/types.ts";

describe("navigation policy", () => {
  for (const suite of cases.suites) {
    describe(suite.name, () => {
      for (const entry of suite.cases) {
        it(`${entry.kind} ${entry.url} -> ${entry.expect}`, () => {
          expect(
            decide(
              suite.origins as WrapOrigins,
              entry.url,
              entry.kind as "navigation",
              suite.extraAllowed,
            ),
          ).toBe(entry.expect as "allow");
        });
      }
    });
  }

  it("parses patterns and rejects anything that is not scheme://host", () => {
    expect(parsePattern("https://*.example.com:8443/app/*")).toEqual({
      scheme: "https",
      host: "example.com",
      subdomains: true,
      port: "8443",
      path: "/app/",
    });
    expect(parsePattern("example.com")).toBeNull();
    expect(parsePattern("ftp://example.com")).toBeNull();
    expect(
      matchesPattern("not a pattern", new URL("https://example.com")),
    ).toBe(false);
  });

  it("matches the default port of the scheme", () => {
    expect(
      matchesPattern(
        "https://example.com",
        new URL("https://example.com:443/"),
      ),
    ).toBe(true);
    expect(
      matchesPattern("http://example.com", new URL("http://example.com:80/")),
    ).toBe(true);
    expect(
      matchesPattern(
        "https://example.com",
        new URL("https://example.com:444/"),
      ),
    ).toBe(false);
  });

  it("reduces a URL to its origin", () => {
    expect(originOf("https://example.com:8443/a?b#c")).toBe(
      "https://example.com:8443",
    );
    expect(originOf("mailto:a@b.test")).toBeNull();
    expect(originOf("nope")).toBeNull();
  });
});
