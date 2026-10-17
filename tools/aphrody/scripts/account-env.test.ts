import { expect, test } from "bun:test";
import { describe, googleAccount, neonOrgId } from "./account-env";

test("reads the Google account and the Neon organization", () => {
  const env = { GOOGLE_ACCOUNT_EMAIL: " a@b.c ", GOOGLE_ACCOUNT_PASSWORD: "s3cret", NEON_ORG_ID: "org-1" };
  expect(googleAccount(env)).toEqual({ email: "a@b.c", password: "s3cret" });
  expect(neonOrgId(env)).toBe("org-1");
});

test("errors and the presence report never contain values", () => {
  expect(() => googleAccount({ GOOGLE_ACCOUNT_PASSWORD: "s3cret" })).toThrow("GOOGLE_ACCOUNT_EMAIL is required");
  expect(() => neonOrgId({})).toThrow("NEON_ORG_ID is required");
  const report = JSON.stringify(describe({ GOOGLE_ACCOUNT_PASSWORD: "s3cret", MULLVAD_ACCOUNT: "1234567890123456" }));
  expect(report).not.toContain("s3cret");
  expect(report).not.toContain("1234567890123456");
  expect(JSON.parse(report)).toEqual({
    GOOGLE_ACCOUNT_EMAIL: false,
    GOOGLE_ACCOUNT_PASSWORD: true,
    NEON_ORG_ID: false,
    MULLVAD_ACCOUNT: true,
  });
});
