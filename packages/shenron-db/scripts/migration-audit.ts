#!/usr/bin/env bun
// Source: packages/shenron/db/scripts/migration-audit.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Offline audit of the site's Drizzle migrations (apps/shenron/site/src/db/migrations).
 *
 * Reports, without touching any file nor any database:
 * - journal vs SQL files (journaled / unjournaled / journal entries without file);
 * - snapshots present in `meta/`;
 * - `tablesFilter` coverage of `apps/shenron/site/drizzle.config.ts` against the
 *   `pgTable("…")` declarations of `packages/shenron/db/src/schema.ts`;
 * - `bot` schema DDL found inside public migrations;
 * - the Drizzle hash of each file (sha256 of the text, as `readMigrationFiles`
 *   computes it; CRLF is normalised to LF so a Windows checkout hashes like the
 *   Linux release).
 *
 * Usage:
 *   bun packages/shenron/db/scripts/migration-audit.ts            # print the audit (JSON)
 *   bun packages/shenron/db/scripts/migration-audit.ts --check    # compare with the committed snapshot (exit 1 on drift)
 *   bun packages/shenron/db/scripts/migration-audit.ts --write    # rewrite the snapshot (human decision only)
 *   bun packages/shenron/db/scripts/migration-audit.ts --probe --operator
 *       # OPERATOR ONLY: READ ONLY transaction reading drizzle.__drizzle_migrations,
 *       # pg_extension and information_schema.tables. Never run by agents.
 *   --root <dir>       repository root (default: two levels above this file)
 *   --snapshot <file>  snapshot path (default: packages/shenron/db/migration-audit.snapshot.json)
 *
 * No migration file is moved, renamed or journaled by this script.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const MIGRATIONS_DIR = "apps/shenron/site/src/db/migrations";
export const DRIZZLE_CONFIG = "apps/shenron/site/drizzle.config.ts";
export const PUBLIC_SCHEMA = "packages/shenron-db/src/schema.ts";
export const DEFAULT_SNAPSHOT = "packages/shenron-db/migration-audit.snapshot.json";

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

export interface MigrationAudit {
  journal: {
    entries: number;
    files: number;
    journaled: string[];
    unjournaled: string[];
    missingFiles: string[];
    list: JournalEntry[];
  };
  snapshots: string[];
  tablesFilter: {
    filtered: number;
    schemaTables: number;
    uncovered: string[];
    unknown: string[];
  };
  botDdl: string[];
  hashes: Record<string, string>;
}

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/** sha256 of the migration text, as drizzle-orm's `readMigrationFiles`. */
export function drizzleHash(sqlText: string): string {
  return createHash("sha256").update(sqlText.replace(/\r\n/g, "\n")).digest("hex");
}

/** `tablesFilter: [...]` entries of a drizzle config, parsed as text (never executed). */
export function parseTablesFilter(configText: string): string[] {
  const m = /tablesFilter\s*:\s*\[([\s\S]*?)\]/.exec(configText);
  if (!m) return [];
  return [...m[1]!.matchAll(/["'`]([^"'`]+)["'`]/g)].map(x => x[1]!);
}

/** Table names declared with `pgTable("name", …)`. */
export function parsePgTables(schemaText: string): string[] {
  return [...schemaText.matchAll(/pgTable\(\s*["'`]([^"'`]+)["'`]/g)].map(x => x[1]!);
}

/** True when the SQL text contains DDL/DML addressed to the `bot` schema. */
export function touchesBotSchema(sqlText: string): boolean {
  const code = sqlText
    .split("\n")
    .filter(line => !line.trim().startsWith("--"))
    .join("\n");
  return /(?:"bot"|\bbot)\s*\.\s*"?[A-Za-z_]/.test(code) || /\bSCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?bot\b/i.test(code);
}

export function collectAudit(root: string): MigrationAudit {
  const dir = join(root, MIGRATIONS_DIR);
  const journalRaw = JSON.parse(readText(join(dir, "meta", "_journal.json"))) as {
    entries: JournalEntry[];
  };
  const list = journalRaw.entries.map(e => ({
    idx: e.idx,
    tag: e.tag,
    when: e.when,
    breakpoints: e.breakpoints,
  }));
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .toSorted();
  const tags = files.map(f => f.slice(0, -4));
  const journaledSet = new Set(list.map(e => e.tag));
  const fileSet = new Set(tags);

  const hashes: Record<string, string> = {};
  const botDdl: string[] = [];
  for (const tag of tags) {
    const text = readText(join(dir, `${tag}.sql`));
    hashes[tag] = drizzleHash(text);
    if (touchesBotSchema(text)) botDdl.push(tag);
  }

  const snapshots = readdirSync(join(dir, "meta"))
    .filter(f => f.endsWith("_snapshot.json"))
    .toSorted();

  const filter = parseTablesFilter(readText(join(root, DRIZZLE_CONFIG)));
  const tables = parsePgTables(readText(join(root, PUBLIC_SCHEMA)));
  const filterSet = new Set(filter);
  const tableSet = new Set(tables);

  return {
    journal: {
      entries: list.length,
      files: tags.length,
      journaled: tags.filter(t => journaledSet.has(t)),
      unjournaled: tags.filter(t => !journaledSet.has(t)),
      missingFiles: list.map(e => e.tag).filter(t => !fileSet.has(t)),
      list,
    },
    snapshots,
    tablesFilter: {
      filtered: filter.length,
      schemaTables: tables.length,
      uncovered: tables.filter(t => !filterSet.has(t)),
      unknown: filter.filter(t => !tableSet.has(t)),
    },
    botDdl,
    hashes,
  };
}

export function serializeAudit(audit: MigrationAudit): string {
  return `${JSON.stringify(audit, null, "\t")}\n`;
}

/** Human-readable differences between two audits (empty when identical). */
export function diffAudits(expected: unknown, actual: unknown, path = "$"): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (
    expected &&
    actual &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const out: string[] = [];
    for (const k of keys) {
      out.push(
        ...diffAudits((expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k], `${path}.${k}`),
      );
    }
    return out;
  }
  return [`${path}: attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`];
}

async function probe(root: string, audit: MigrationAudit): Promise<number> {
  const { loadDatabaseUrl } = await import("../src/env");
  const { createSql } = await import("../src/sql");
  const loaded = loadDatabaseUrl({ fallbackFiles: [{ path: join(root, "apps/shenron/site/.env") }] });
  if (!loaded.ok) {
    console.error(`✗ ${loaded.reason}`);
    return 2;
  }
  const sql = createSql({ url: loaded.url, applicationName: "shenron-migration-audit", max: 1 });
  try {
    const result = await sql.begin("read only", async tx => {
      const applied = await tx<{ id: number; hash: string; created_at: string }[]>`
				select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id`;
      const extensions = await tx<{ extname: string; extversion: string }[]>`
				select extname, extversion from pg_extension order by extname`;
      const tables = await tx<{ table_schema: string; table_name: string }[]>`
				select table_schema, table_name from information_schema.tables
				where table_schema in ('public', 'bot', 'drizzle') order by 1, 2`;
      return { applied, extensions, tables };
    });
    const byHash = new Map(Object.entries(audit.hashes).map(([tag, h]) => [h, tag]));
    console.log(
      JSON.stringify(
        {
          applied: result.applied.map(r => ({
            id: r.id,
            created_at: r.created_at,
            tag: byHash.get(r.hash) ?? null,
          })),
          extensions: result.extensions,
          tables: result.tables.length,
          tablesBySchema: result.tables.reduce<Record<string, number>>((acc, t) => {
            acc[t.table_schema] = (acc[t.table_schema] ?? 0) + 1;
            return acc;
          }, {}),
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      check: { type: "boolean", default: false },
      write: { type: "boolean", default: false },
      probe: { type: "boolean", default: false },
      operator: { type: "boolean", default: false },
      root: { type: "string" },
      snapshot: { type: "string" },
    },
    strict: true,
  });
  const root = resolve(values.root ?? join(import.meta.dir, "..", "..", ".."));
  const snapshotPath = resolve(values.snapshot ?? join(root, DEFAULT_SNAPSHOT));
  const audit = collectAudit(root);

  if (values.probe) {
    if (!values.operator) {
      console.error("✗ --probe exige --operator : sonde en lecture seule réservée à l'opérateur.");
      return 2;
    }
    return probe(root, audit);
  }
  if (values.write) {
    writeFileSync(snapshotPath, serializeAudit(audit));
    console.log(`✓ instantané écrit : ${snapshotPath}`);
    return 0;
  }
  if (values.check) {
    if (!existsSync(snapshotPath)) {
      console.error(`✗ instantané absent : ${snapshotPath}`);
      return 1;
    }
    const expected = JSON.parse(readText(snapshotPath)) as unknown;
    const diffs = diffAudits(expected, JSON.parse(serializeAudit(audit)));
    if (diffs.length) {
      console.error(`✗ dérive des migrations (${diffs.length}) :`);
      for (const d of diffs) console.error(`  ${d}`);
      return 1;
    }
    console.log(
      `✓ migrations conformes : journal ${audit.journal.entries}/${audit.journal.files}, ` +
        `non journalisées ${audit.journal.unjournaled.length}, snapshots ${audit.snapshots.length}, ` +
        `tablesFilter ${audit.tablesFilter.filtered}/${audit.tablesFilter.schemaTables}, DDL bot ${audit.botDdl.length}`,
    );
    return 0;
  }
  process.stdout.write(serializeAudit(audit));
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
