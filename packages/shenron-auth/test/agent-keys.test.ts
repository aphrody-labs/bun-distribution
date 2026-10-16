// Source: packages/shenron/auth/test/agent-keys.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  AGENT_TOKEN_PREFIX,
  decideWriteQuota,
  generateAgentToken,
  hashAgentToken,
  hasScope,
  parseScopes,
} from "../src/agent-keys";

const VOCABULARY = ["read", "contribute", "comment", "write:articles", "publish:articles", "moderate"] as const;

describe("agent tokens", () => {
  test("format: dbfr_agent_ + 32 random bytes base64url", () => {
    const { token, hash, displayPrefix } = generateAgentToken();
    expect(AGENT_TOKEN_PREFIX).toBe("dbfr_agent_");
    expect(token).toMatch(/^dbfr_agent_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(AGENT_TOKEN_PREFIX.length), "base64url")).toHaveLength(32);
    expect(displayPrefix).toBe(token.slice(0, AGENT_TOKEN_PREFIX.length + 6));
    expect(hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(generateAgentToken().token).not.toBe(token);
  });

  test("hash is SHA-256 hex", () => {
    expect(hashAgentToken("dbfr_agent_x")).toBe(createHash("sha256").update("dbfr_agent_x").digest("hex"));
    expect(hashAgentToken("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("scopes", () => {
  test("parseScopes: vocabulary-checked, deduped, order kept; non-array → null", () => {
    expect(parseScopes(VOCABULARY, ["read", "admin", "read", 3, "moderate"])).toEqual(["read", "moderate"]);
    expect(parseScopes(VOCABULARY, [])).toEqual([]);
    expect(parseScopes(VOCABULARY, "read")).toBeNull();
    expect(parseScopes(VOCABULARY, null)).toBeNull();
  });

  test("hasScope", () => {
    expect(hasScope(["read"], "read")).toBe(true);
    expect(hasScope(["read"], "moderate")).toBe(false);
  });
});

describe("decideWriteQuota", () => {
  test("reads are never limited; writes stop at the limit", () => {
    expect(decideWriteQuota({ method: "GET", writesLastHour: 999, limit: 1 })).toEqual({
      allowed: true,
    });
    expect(decideWriteQuota({ method: "head", writesLastHour: 999, limit: 1 })).toEqual({
      allowed: true,
    });
    expect(decideWriteQuota({ method: "POST", writesLastHour: 119, limit: 120 })).toEqual({
      allowed: true,
    });
    expect(decideWriteQuota({ method: "POST", writesLastHour: 120, limit: 120 })).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
  });
});
