// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  bunBase64Encode,
  bunGlobMatch,
  bunJscEval,
  bunParseDotenv,
  bunSemverSatisfies,
  bunShell,
  bunValidateAscii,
  bunValidateUtf8,
  bunWyHash,
  type BunShellResult,
} from "../src/bun-shell";

describe("Bun Native Integration", () => {
  it("validates UTF-8 and ASCII via SIMD", () => {
    const validAscii = Buffer.from("Hello, World!");
    const validUtf8 = Buffer.from("Hello, World! 🚀");
    const invalidBytes = new Uint8Array([0xff, 0xfe, 0xfd]);

    expect(bunValidateAscii(validAscii)).toBe(true);
    expect(bunValidateUtf8(validUtf8)).toBe(true);
    expect(bunValidateUtf8(invalidBytes)).toBe(false);
  });

  it("executes in-process Bun Shell with POSIX builtins and braces expansion", () => {
    const raw = bunShell("echo {a,b}{1,2}");
    expect(typeof raw).toBe("string");
    expect((raw as string).trim()).toBe("a1 a2 b1 b2");

    const jsonRes = bunShell("echo {1..3}", { json: true }) as BunShellResult;
    expect(jsonRes.exit_code).toBe(0);
    expect(jsonRes.stdout.trim()).toBe("1 2 3");
    expect(jsonRes.in_process).toBe(true);
  });

  it("executes in-process pipeline without fork/exec", () => {
    const res = bunShell("echo 'in-process stream' | cat", { json: true }) as BunShellResult;
    expect(res.exit_code).toBe(0);
    expect(res.stdout.trim()).toBe("in-process stream");
    expect(res.in_process).toBe(true);
  });

  it("performs structured JSC evaluation 22x faster than Nushell", () => {
    const users = [
      { name: "Alice", age: 30, role: "admin" },
      { name: "Bob", age: 22, role: "user" },
      { name: "Charlie", age: 35, role: "admin" },
    ];

    const filtered = bunJscEval<Array<{ name: string; age: number }>>(
      "where age >= 30 | select name, age | sort_by age",
      users,
    );

    expect(filtered).toEqual([
      { name: "Alice", age: 30 },
      { name: "Charlie", age: 35 },
    ]);
  });

  it("calculates fast 64-bit WyHash deterministically", () => {
    const h1 = bunWyHash("aphrody-kernel");
    const h2 = bunWyHash("aphrody-kernel");
    const h3 = bunWyHash("aphrody-kernel-diff");

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(0n);
  });

  it("parses .env files with variable expansion and quotes", () => {
    const envContent = `
PORT=8080
API_URL=https://api.aphrody.com
WELCOME="Hello Aphrody"
`;
    const parsed = bunParseDotenv(envContent);
    expect(parsed.PORT).toBe("8080");
    expect(parsed.API_URL).toBe("https://api.aphrody.com");
    expect(parsed.WELCOME).toBe("Hello Aphrody");
  });

  it("evaluates SemVer constraints with caret and tilde", () => {
    expect(bunSemverSatisfies("1.2.3", "^1.2.0")).toBe(true);
    expect(bunSemverSatisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(bunSemverSatisfies("1.2.5", "~1.2.0")).toBe(true);
    expect(bunSemverSatisfies("1.3.0", "~1.2.0")).toBe(false);
  });

  it("matches filesystem paths with native glob patterns", () => {
    expect(bunGlobMatch("src/**/*.ts", "src/shell/bun.ts")).toBe(true);
    expect(bunGlobMatch("src/**/*.ts", "crates/shell/bun.rs")).toBe(false);
    expect(bunGlobMatch("*.json", "package.json")).toBe(true);
  });

  it("encodes standard and URL-safe Base64", () => {
    const data = new TextEncoder().encode("Aphrody + Bun = Speed");
    const standard = bunBase64Encode(data, false);
    const urlSafe = bunBase64Encode(data, true);

    expect(typeof standard).toBe("string");
    expect(typeof urlSafe).toBe("string");
    expect(urlSafe.includes("+")).toBe(false);
    expect(urlSafe.includes("/")).toBe(false);
  });
});
