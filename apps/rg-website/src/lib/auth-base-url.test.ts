import { describe, expect, it } from "bun:test";
import { resolveAuthBaseURL } from "./auth-base-url";

describe("resolveAuthBaseURL", () => {
  it("uses the configured canonical RG deployment origin in production", () => {
    expect(resolveAuthBaseURL({ configured: "https://rg.aphrody.com/api/auth", production: true })).toBe(
      "https://rg.aphrody.com",
    );
    expect(resolveAuthBaseURL({ configured: "http://rg.aphrody.com", production: true })).toBe(
      "https://rosegriffon.fr",
    );
    expect(resolveAuthBaseURL({ configured: "https://user:password@rg.aphrody.com", production: true })).toBe(
      "https://rosegriffon.fr",
    );
  });
  it("keeps production OAuth on the canonical site even when served from localhost", () => {
    expect(
      resolveAuthBaseURL({
        origin: "https://localhost:3004",
        configured: "https://localhost:3004",
        production: true,
      }),
    ).toBe("https://rosegriffon.fr");
  });

  it("uses the canonical origin from Rose Griffon subdomains", () => {
    expect(resolveAuthBaseURL({ origin: "https://www.rosegriffon.fr", production: true })).toBe(
      "https://rosegriffon.fr",
    );
  });

  it("allows a local OAuth origin during local development", () => {
    expect(resolveAuthBaseURL({ origin: "http://localhost:3004", production: false })).toBe("http://localhost:3004");
  });

  it("falls back to the public site for malformed or unsafe origins", () => {
    expect(
      resolveAuthBaseURL({
        origin: "not an origin",
        configured: "javascript:alert(1)",
        production: true,
      }),
    ).toBe("https://rosegriffon.fr");
  });
});
