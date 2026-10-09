// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { datasets, parseManifests, prune } from "./shenron-offsite-backup.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const [pg, sqlite] = datasets("/home/ubuntu/", "D:\\backups");

test("remote directories follow the declared DBFR units", () => {
  expect(pg!.remoteDir).toBe("/home/ubuntu/apps/shenron/data/backups/shenron-pg");
  expect(sqlite!.remoteDir).toBe("/home/ubuntu/apps/shenron/data/backups/shenron-sqlite");
  expect(sqlite!.destination).toBe(join("D:\\backups", "sqlite"));
});

test("manifests are parsed strictly", () => {
  const sum = "a".repeat(64);
  expect(parseManifests(`${sum}  /x/shenron_site-20261009-030000.sql.gz\n\n`, pg!)).toEqual([
    { sha256: sum, name: "shenron_site-20261009-030000.sql.gz" },
  ]);
  expect(parseManifests(`${sum} *bot-20261009-030000.db.gz`, sqlite!)[0]!.name).toBe(
    "bot-20261009-030000.db.gz",
  );
  expect(() => parseManifests("nothex  shenron_site-20261009-030000.sql.gz", pg!)).toThrow(
    "malformed",
  );
  expect(() => parseManifests(`${sum}  ../../etc/passwd`, pg!)).toThrow("unexpected");
  expect(() => parseManifests(`${sum}  bot-20261009-030000.db.gz`, pg!)).toThrow("unexpected");
});

test("retention prunes old artifacts with their sidecars only", () => {
  const dir = mkdtempSync(join(tmpdir(), "shenron-offsite-"));
  dirs.push(dir);
  const old = join(dir, "shenron_site-20260901-030000.sql.gz");
  const fresh = join(dir, "shenron_site-20261009-030000.sql.gz");
  for (const path of [old, `${old}.sha256`, fresh, join(dir, "pull-status.log")])
    writeFileSync(path, "x");
  const past = new Date(Date.now() - 20 * 86_400_000);
  utimesSync(old, past, past);
  expect(prune(dir)).toEqual(["shenron_site-20260901-030000.sql.gz"]);
  expect(existsSync(old) || existsSync(`${old}.sha256`)).toBe(false);
  expect(existsSync(fresh) && existsSync(join(dir, "pull-status.log"))).toBe(true);
});
