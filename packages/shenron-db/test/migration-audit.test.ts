// Source: packages/shenron/db/test/migration-audit.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  collectAudit,
  DEFAULT_SNAPSHOT,
  DRIZZLE_CONFIG,
  drizzleHash,
  main,
  MIGRATIONS_DIR,
  parsePgTables,
  parseTablesFilter,
  PUBLIC_SCHEMA,
  touchesBotSchema,
} from "../scripts/migration-audit";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const snapshot = join(repoRoot, DEFAULT_SNAPSHOT);
const tmp = mkdtempSync(join(tmpdir(), "shenron-migration-audit-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Copies the audited inputs into a temp root (the real tree is never edited). */
function tempCopy(): string {
  const root = mkdtempSync(join(tmp, "root-"));
  for (const rel of [MIGRATIONS_DIR, DRIZZLE_CONFIG, PUBLIC_SCHEMA]) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repoRoot, rel), dest, { recursive: true });
  }
  return root;
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const err = spyOn(console, "error").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("migration audit", () => {
  test("current tree matches the documented state", () => {
    const a = collectAudit(repoRoot);
    expect(a.journal.entries).toBe(12);
    expect(a.journal.files).toBe(20);
    expect(a.journal.unjournaled.map(t => t.slice(0, 4))).toEqual([
      "0007",
      "0008",
      "0009",
      "0010",
      "0011",
      "0015",
      "0018",
      "0019",
    ]);
    expect(a.snapshots.at(-1)).toBe("0005_snapshot.json");
    expect([a.tablesFilter.filtered, a.tablesFilter.schemaTables]).toEqual([17, 33]);
    expect(a.botDdl.map(t => t.slice(0, 4))).toEqual(["0011", "0017", "0018", "0019"]);
  });

  test("--check passes on the real tree and on an untouched copy", async () => {
    expect(await quiet(() => main(["--check"]))).toBe(0);
    expect(await quiet(() => main(["--check", "--root", tempCopy(), "--snapshot", snapshot]))).toBe(0);
  });

  test("editing a journal entry in a temp copy makes --check fail", async () => {
    const root = tempCopy();
    const journal = join(root, MIGRATIONS_DIR, "meta", "_journal.json");
    const data = JSON.parse(readFileSync(journal, "utf8")) as { entries: { when: number }[] };
    data.entries[3]!.when += 1;
    writeFileSync(journal, JSON.stringify(data, null, "\t"));
    expect(await quiet(() => main(["--check", "--root", root, "--snapshot", snapshot]))).toBe(1);
  });

  test("editing a migration file changes its hash and fails --check", async () => {
    const root = tempCopy();
    const file = join(root, MIGRATIONS_DIR, "0016_page_banners.sql");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n-- drift\n`);
    expect(await quiet(() => main(["--check", "--root", root, "--snapshot", snapshot]))).toBe(1);
  });

  test("--probe without --operator is refused before any connection", async () => {
    expect(await quiet(() => main(["--probe"]))).toBe(2);
  });

  test("helpers", () => {
    expect(drizzleHash("a\r\nb")).toBe(drizzleHash("a\nb"));
    expect(parseTablesFilter(`x({ tablesFilter: ["A", 'b'], y: [1] })`)).toEqual(["A", "b"]);
    expect(parsePgTables(`pgTable("User", {}); pgTable(\n "x", {})`)).toEqual(["User", "x"]);
    expect(touchesBotSchema(`ALTER TABLE "bot"."db_x" ADD c int;`)).toBe(true);
    expect(touchesBotSchema(`-- bot.db_x only in a comment\nSELECT 1;`)).toBe(false);
  });
});
