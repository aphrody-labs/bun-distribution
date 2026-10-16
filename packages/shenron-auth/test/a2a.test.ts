// Source: packages/shenron/auth/test/a2a.test.ts at 8172f535ce (preserved Git history).
import { beforeEach, describe, expect, test } from "bun:test";
import {
  A2A_ENFORCE_ENV,
  A2A_OPEN_WARNING,
  A2A_TOKEN_ENV,
  a2aDeniedBody,
  a2aEnforced,
  decideA2AWrite,
  resetA2AOpenWarning,
} from "../src/a2a";

const TOKEN = "a2a-test-token-0123456789abcdef";

function bearer(value: string): Headers {
  return new Headers({ authorization: value });
}

let warnings: string[] = [];
const warn = (message: string) => {
  warnings.push(message);
};

beforeEach(() => {
  warnings = [];
  resetA2AOpenWarning();
});

describe("a2aEnforced", () => {
  test("only 1 and true enable the guard", () => {
    expect(a2aEnforced({})).toBe(false);
    expect(a2aEnforced({ [A2A_ENFORCE_ENV]: "1" })).toBe(true);
    expect(a2aEnforced({ [A2A_ENFORCE_ENV]: "true" })).toBe(true);
    expect(a2aEnforced({ [A2A_ENFORCE_ENV]: " TRUE " })).toBe(true);
    for (const value of ["", "0", "false", "yes", "on", "enforce", undefined]) {
      expect(a2aEnforced({ [A2A_ENFORCE_ENV]: value })).toBe(false);
    }
  });
});

describe("decideA2AWrite — enforce off (default)", () => {
  test("allows anonymous writes and warns exactly once per process", () => {
    for (let i = 0; i < 5; i++) {
      expect(decideA2AWrite(new Headers(), { token: undefined, enforce: false, warn })).toEqual({
        ok: true,
        authenticated: false,
      });
    }
    expect(warnings).toEqual([A2A_OPEN_WARNING]);
  });

  test("the warning names the variables and never a value", () => {
    decideA2AWrite(bearer(`Bearer ${TOKEN}`), { token: TOKEN, enforce: false, warn });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(A2A_ENFORCE_ENV);
    expect(warnings[0]).toContain(A2A_TOKEN_ENV);
    expect(warnings[0]).not.toContain(TOKEN);
  });

  test("reports authentication when the right Bearer is sent", () => {
    expect(decideA2AWrite(bearer(`Bearer ${TOKEN}`), { token: TOKEN, enforce: false, warn })).toEqual({
      ok: true,
      authenticated: true,
    });
    expect(decideA2AWrite(bearer("Bearer nope"), { token: TOKEN, enforce: false, warn })).toEqual({
      ok: true,
      authenticated: false,
    });
  });

  test("defaults to console.warn", () => {
    const original = console.warn;
    const seen: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      seen.push(...args);
    };
    try {
      decideA2AWrite(new Headers(), { token: undefined, enforce: false });
      decideA2AWrite(new Headers(), { token: undefined, enforce: false });
    } finally {
      console.warn = original;
    }
    expect(seen).toEqual([A2A_OPEN_WARNING]);
  });
});

describe("decideA2AWrite — enforce on", () => {
  test("unset or blank token -> 503 a2a_not_configured", () => {
    for (const token of [undefined, "", "   "]) {
      const decision = decideA2AWrite(bearer(`Bearer ${TOKEN}`), { token, enforce: true, warn });
      expect(decision).toEqual({ ok: false, status: 503, code: "a2a_not_configured" });
    }
    expect(warnings).toEqual([]);
  });

  test("missing or wrong Bearer -> 401 a2a_unauthorized", () => {
    const cases = [
      new Headers(),
      bearer(""),
      bearer("Bearer"),
      bearer("Bearer "),
      bearer(`Basic ${TOKEN}`),
      bearer(`Bearer ${TOKEN}x`),
      bearer(`Bearer ${TOKEN.slice(0, -1)}`),
      bearer(TOKEN),
    ];
    for (const headers of cases) {
      expect(decideA2AWrite(headers, { token: TOKEN, enforce: true, warn })).toEqual({
        ok: false,
        status: 401,
        code: "a2a_unauthorized",
      });
    }
  });

  test("the right Bearer passes (scheme case-insensitive, surrounding spaces ignored)", () => {
    for (const value of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `  Bearer   ${TOKEN}  `]) {
      expect(decideA2AWrite(bearer(value), { token: TOKEN, enforce: true, warn })).toEqual({
        ok: true,
        authenticated: true,
      });
    }
    expect(warnings).toEqual([]);
  });

  test("denied body carries only the code", () => {
    const decision = decideA2AWrite(new Headers(), { token: TOKEN, enforce: true });
    if (decision.ok) throw new Error("expected a refusal");
    expect(a2aDeniedBody(decision)).toEqual({ error: "a2a_unauthorized" });
    expect(JSON.stringify(a2aDeniedBody(decision))).not.toContain(TOKEN);
  });
});
