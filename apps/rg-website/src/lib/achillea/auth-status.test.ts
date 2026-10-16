import { describe, expect, it } from "bun:test";
import { failedIdentityStatus } from "./auth-status";

describe("failedIdentityStatus", () => {
  it("classifies rejected credentials as anonymous", () => {
    for (const status of [401, 403]) {
      expect(failedIdentityStatus({ ok: false, kind: "http", status, path: "/auth/me", detail: "rejected" })).toBe(
        "anonymous",
      );
    }
  });

  it("keeps upstream failures and malformed responses distinct from anonymous", () => {
    expect(
      failedIdentityStatus({ ok: false, kind: "http", status: 503, path: "/auth/me", detail: "unavailable" }),
    ).toBe("error");
    expect(failedIdentityStatus({ ok: false, kind: "unreachable", path: "/auth/me", detail: "timeout" })).toBe("error");
    expect(failedIdentityStatus({ ok: false, kind: "invalid_response", path: "/auth/me", detail: "invalid" })).toBe(
      "error",
    );
  });
});
