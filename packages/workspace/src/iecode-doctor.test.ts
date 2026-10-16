import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBunMembers } from "./iecode-doctor";

test("doctor resolves overlapping Bun globs and rejects missing literal members", () => {
  const root = mkdtempSync(join(tmpdir(), "iecode-doctor-"));
  try {
    for (const member of ["packages/a", "packages/b"]) {
      mkdirSync(join(root, member), { recursive: true });
      writeFileSync(join(root, member, "package.json"), "{}");
    }
    const failures: string[] = [];
    expect(resolveBunMembers(root, ["packages/*", "packages/a"], failures)).toEqual([
      "packages/a",
      "packages/b",
    ]);
    expect(failures).toEqual([]);
    expect(resolveBunMembers(root, ["packages/missing"], failures)).toEqual([]);
    expect(failures).toEqual(["missing Bun workspace member: packages/missing/package.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
