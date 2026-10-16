// Source: packages/shenron/db/test/env.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDatabaseConfigured } from "../src/config";
import { lastAssignment, loadDatabaseUrl } from "../src/env";

const dir = mkdtempSync(join(tmpdir(), "shenron-db-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const LIVE = "postgres://live:livesecret@127.0.0.1:5432/shenron_test";
const OLD = "postgresql://old:oldsecret@decommissioned.invalid/neondb";

let counter = 0;
function file(content: string): string {
  const path = join(dir, `f${counter++}.env`);
  writeFileSync(path, content);
  return path;
}

describe("loadDatabaseUrl", () => {
  test("environment wins over files", () => {
    const path = file(`DATABASE_URL=${OLD}\n`);
    const r = loadDatabaseUrl({ env: { DATABASE_URL: LIVE }, fallbackFiles: [{ path }] });
    expect(r).toEqual({ ok: true, url: LIVE, source: { kind: "env", name: "DATABASE_URL" } });
  });

  test("the last active line of a file wins (decommissioned URL above the live one)", () => {
    const path = file(
      [
        "# old",
        `DATABASE_URL="${OLD}"`,
        "OTHER=1",
        "# DATABASE_URL=postgres://commented/out",
        `export DATABASE_URL='${LIVE}'`,
        "",
      ].join("\n"),
    );
    const r = loadDatabaseUrl({ env: {}, fallbackFiles: [{ path }] });
    expect(r).toEqual({
      ok: true,
      url: LIVE,
      source: { kind: "file", path, varName: "DATABASE_URL" },
    });
  });

  test("custom varNames and per-file varName", () => {
    const path = file(`PG_URL=${LIVE}\n`);
    expect(loadDatabaseUrl({ env: {}, fallbackFiles: [{ path, varName: "PG_URL" }] })).toMatchObject({
      ok: true,
      url: LIVE,
    });
    expect(loadDatabaseUrl({ env: { SHENRON_PG: LIVE }, varNames: ["SHENRON_PG"] })).toMatchObject({
      ok: true,
      source: { kind: "env", name: "SHENRON_PG" },
    });
  });

  for (const bad of ["eyJ2IjoiZW5jcnlwdGVk", "undefined", "null", "mysql://x@127.0.0.1/db", "not a url"]) {
    test(`rejects ${bad}`, () => {
      const path = file(`DATABASE_URL=${bad}\n`);
      expect(loadDatabaseUrl({ env: { DATABASE_URL: bad } }).ok).toBe(false);
      expect(loadDatabaseUrl({ env: {}, fallbackFiles: [{ path }] }).ok).toBe(false);
    });
  }

  test("missing files are ignored", () => {
    const path = file(`DATABASE_URL=${LIVE}\n`);
    const absent = join(dir, "absent.env");
    const r = loadDatabaseUrl({ env: {}, fallbackFiles: [{ path: absent }, { path }] });
    expect(r).toMatchObject({ ok: true, url: LIVE });
    expect(loadDatabaseUrl({ env: {}, fallbackFiles: [{ path: absent }] }).ok).toBe(false);
  });

  test("the URL never reaches any log nor a failure reason", () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map(m =>
      spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const leaky = "postgres-bad://leak:topsecret@127.0.0.1/x";
      const path = file(`DATABASE_URL=${OLD}\nDATABASE_URL=${LIVE}\n`);
      const badPath = file(`DATABASE_URL=${leaky}\n`);
      const ok = loadDatabaseUrl({ env: {}, fallbackFiles: [{ path }] });
      const ko = loadDatabaseUrl({
        env: { DATABASE_URL: leaky },
        fallbackFiles: [{ path: badPath }],
      });
      expect(ok.ok).toBe(true);
      expect(ko.ok).toBe(false);
      if (!ko.ok) {
        expect(ko.reason).not.toContain("topsecret");
        expect(ko.reason).not.toContain("leak");
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("lastAssignment strips quotes and inline comments", () => {
    expect(lastAssignment("A=1\nA = '2' \nB=3", "A")).toBe("2");
    expect(lastAssignment("A=x # note", "A")).toBe("x");
    expect(lastAssignment("AA=1", "A")).toBeUndefined();
    expect(lastAssignment("A=1\r\nA=2\r\n", "A")).toBe("2");
  });
});

describe("isDatabaseConfigured", () => {
  test("true only for a usable URL", () => {
    expect(isDatabaseConfigured({ DATABASE_URL: LIVE })).toBe(true);
    expect(isDatabaseConfigured({})).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: "undefined" })).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: "eyJ2Ijoabc" })).toBe(false);
  });
});
