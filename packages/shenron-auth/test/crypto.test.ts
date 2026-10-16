// Source: packages/shenron/auth/test/crypto.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { hmacSha256Hex, parseBearer, randomTokenBase64Url, sha256Hex, timingSafeEqualString } from "../src/crypto";

const h = (value: string | null) => {
  const headers = new Headers();
  if (value !== null) headers.set("authorization", value);
  return headers;
};

describe("timingSafeEqualString", () => {
  test("equal, different, different length, empty", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);
    expect(timingSafeEqualString("", "")).toBe(true);
    expect(timingSafeEqualString("", "a")).toBe(false);
  });
});

describe("parseBearer", () => {
  test("default: case-insensitive scheme, trimmed, empty is null", () => {
    expect(parseBearer(h("Bearer abc"))).toBe("abc");
    expect(parseBearer(h("bearer   abc  "))).toBe("abc");
    expect(parseBearer(h("BEARER\tabc"))).toBe("abc");
    expect(parseBearer(h("Bearer "))).toBeNull();
    expect(parseBearer(h("Basic abc"))).toBeNull();
    expect(parseBearer(h(null))).toBeNull();
  });

  test('caseSensitive reproduces the bot `startsWith("Bearer ")` then slice(7).trim()', () => {
    expect(parseBearer(h("Bearer abc "), { caseSensitive: true })).toBe("abc");
    expect(parseBearer(h("bearer abc"), { caseSensitive: true })).toBeNull();
    // Headers strip trailing blanks: "Bearer  " becomes "Bearer", no prefix (bot identical).
    expect(parseBearer(h("Bearer  "), { caseSensitive: true })).toBeNull();
    expect(parseBearer(h("Bearer 	 x"), { caseSensitive: true })).toBe("x");
    expect(parseBearer(h(null), { caseSensitive: true })).toBeNull();
  });
});

describe("hashes", () => {
  test("sha256Hex and hmacSha256Hex match node:crypto", () => {
    expect(sha256Hex("dbfr")).toBe(createHash("sha256").update("dbfr").digest("hex"));
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hmacSha256Hex("k", "m")).toBe(createHmac("sha256", "k").update("m").digest("hex"));
  });

  test("randomTokenBase64Url: 32 bytes → 43 base64url chars, unique", () => {
    const a = randomTokenBase64Url();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomTokenBase64Url()).not.toBe(a);
    expect(randomTokenBase64Url(16)).toHaveLength(22);
  });
});
