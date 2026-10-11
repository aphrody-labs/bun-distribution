// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentUserSid,
  daclSddl,
  deleteUserKey,
  deleteUserValues,
  ownerOnlySddl,
  restrictToCurrentUser,
  setUserValues,
  userValue,
} from "./win32-user.ts";

describe("owner-only SDDL", () => {
  test("directories inherit, files do not, malformed SIDs are refused", () => {
    expect(ownerOnlySddl("S-1-5-21-1-2-3-1001", true)).toBe("D:P(A;OICI;FA;;;S-1-5-21-1-2-3-1001)");
    expect(ownerOnlySddl("S-1-5-21-1-2-3-1001", false)).toBe("D:P(A;;FA;;;S-1-5-21-1-2-3-1001)");
    expect(() => ownerOnlySddl("S-1-5;(A;;FA;;;WD)", true)).toThrow("SID");
  });
});

describe.skipIf(process.platform !== "win32")("Win32 user scope", () => {
  const work = mkdtempSync(join(tmpdir(), "aphrody-win32-user-"));
  const subKey = `Software\\Aphrody\\Test\\win32-user-${process.pid}`;
  afterAll(() => {
    deleteUserKey(subKey);
    rmSync(work, { recursive: true, force: true });
  });

  test("the token user is a Windows account SID", () => {
    expect(currentUserSid()).toMatch(/^S-1-5-21-\d+-\d+-\d+-\d+$/);
  });

  test("REG_SZ values round-trip under HKCU and deletion is idempotent", () => {
    expect(userValue(subKey, "A")).toBeNull();
    setUserValues(subKey, { A: "C:\\Users\\é\\.aphrody", B: "" });
    expect(userValue(subKey, "A")).toBe("C:\\Users\\é\\.aphrody");
    expect(userValue(subKey, "B")).toBe("");
    deleteUserValues(subKey, ["A", "A"]);
    expect(userValue(subKey, "A")).toBeNull();
    expect(() => setUserValues(subKey, { "X=Y": "z" })).toThrow("invalide");
  });

  test("a protected DACL leaves the current user as the only grantee", () => {
    const directory = join(work, "cookies");
    const file = join(work, "key.json");
    mkdirSync(directory);
    writeFileSync(file, "{}");
    const sid = currentUserSid();
    expect(restrictToCurrentUser(directory, true)).toBe(`D:P(A;OICI;FA;;;${sid})`);
    expect(daclSddl(directory)).toBe(`D:PAI(A;OICI;FA;;;${sid})`);
    restrictToCurrentUser(file, false);
    expect(daclSddl(file)).toBe(`D:PAI(A;;FA;;;${sid})`);
    writeFileSync(join(directory, "child"), "x");
    expect(daclSddl(join(directory, "child"))).toBe(`D:AI(A;ID;FA;;;${sid})`);
  });
});
