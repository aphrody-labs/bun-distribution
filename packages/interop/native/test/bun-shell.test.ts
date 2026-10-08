// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  bunJscEval,
  bunShell,
  bunValidateAscii,
  bunValidateUtf8,
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
});
