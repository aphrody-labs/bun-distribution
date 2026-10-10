// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cookieLayout, secureCookieStore } from "./secure-cookie-layout.ts";

const work = mkdtempSync(join(tmpdir(), "aphrody-cookie-layout-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("cookie layout", () => {
  test("defaults to the cookies directory of the Aphrody home", () => {
    expect(cookieLayout({}, {})).toEqual({
      home: join(homedir(), ".aphrody"),
      cookies: resolve(homedir(), ".aphrody", "cookies"),
    });
    expect(cookieLayout({}, { APHRODY_HOME: "/srv/h" }).cookies).toBe(resolve("/srv/h/cookies"));
    expect(cookieLayout({ home: "/a" }, { APHRODY_HOME: "/b" }).home).toBe("/a");
  });

  test("an exported BXC_COOKIES_DIR is kept, a conflicting directory is refused", () => {
    expect(cookieLayout({}, { BXC_COOKIES_DIR: "/x/cookies" }).cookies).toBe(resolve("/x/cookies"));
    expect(cookieLayout({ dir: "/x/cookies" }, { BXC_COOKIES_DIR: "/x/cookies/" }).cookies).toBe(
      resolve("/x/cookies"),
    );
    expect(() => cookieLayout({ dir: "/y" }, { BXC_COOKIES_DIR: "/x/cookies" })).toThrow(
      "ambiguïté",
    );
  });

  test("the store is created for the current user only", async () => {
    const layout = { home: work, cookies: join(work, "cookies") };
    const sddl = await secureCookieStore(layout, false);
    if (process.platform === "win32") {
      const { daclSddl } = await import("./infra/win32-user.ts");
      expect(sddl).toMatch(/^D:P\(A;OICI;FA;;;S-1-5-21-[\d-]+\)$/);
      expect(daclSddl(layout.cookies)).toBe(sddl!.replace("D:P(", "D:PAI("));
    } else {
      expect(sddl).toBeNull();
      expect(statSync(layout.cookies).mode & 0o777).toBe(0o700);
    }
    expect(await secureCookieStore(layout, false)).toBe(sddl);
  });
});
