#!/usr/bin/env bun
/**
 * @file apply-inagle-schema.ts
 * @description Cross-platform schema migration runner and verifier for Inagle / Azalée / NIE.
 * Supports SQLite (var/mirror.sqlite or :memory:) and Inagle/NIE PostgreSQL (Neon / local pg).
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.env.NIE_REPO_ROOT ?? join(import.meta.dir, "../../.."));
const sqliteSchemaPath = join(root, "packages/inagle/src/sql/schema.sqlite.sql");
const pgMigrationsDir = join(root, "packages/inagle/supabase/migrations");

const args = Bun.argv.slice(2);

function printHelp(): void {
  console.log(`
Usage: bun scripts/iecode/migration/apply-inagle-schema.ts [options]

Options:
  --sqlite [path]    Apply canonical SQLite schema to local mirror (default: var/mirror.sqlite)
  --postgres [url]   Apply Inagle/NIE migrations to Neon or an explicit local PostgreSQL database
  --verify           Verify SQLite schema against an in-memory database and check PG manifests
  --help, -h         Show this help message
`);
}

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  return undefined;
}

export function applySqlite(dbPath: string): { tables: string[]; count: number } {
  console.log(`📦 Applying SQLite schema to: ${dbPath}`);
  if (!existsSync(sqliteSchemaPath)) {
    throw new Error(`SQLite schema not found at: ${sqliteSchemaPath}`);
  }

  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  const sql = readFileSync(sqliteSchemaPath, "utf-8");
  db.run(sql);

  const rows = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'inagle_%' ORDER BY name",
    )
    .all();

  const tables = rows.map(r => r.name);
  db.close();

  console.log(`✅ SQLite schema applied successfully: ${tables.length} tables verified.`);
  return { tables, count: tables.length };
}

export function resolveInaglePostgresUrl(connectionUrl?: string): string | undefined {
  const url = connectionUrl?.trim() || process.env.INAGLE_DATABASE_URL?.trim() || process.env.NIE_PG_URL?.trim();

  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Inagle/NIE migrations require a valid PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length <= 1)
    throw new Error("Inagle/NIE migrations require a valid PostgreSQL connection URL");

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "supabase.co" || hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com"))
    throw new Error("Inagle/NIE migrations cannot target Supabase; use the Neon gameplay database");

  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  const isNeon = hostname.endsWith(".neon.tech");
  if (!isLoopback && !isNeon)
    throw new Error("Inagle/NIE migrations require the dedicated Neon project or a loopback PostgreSQL target");

  if (isNeon && hostname.includes("-pooler."))
    throw new Error("Neon schema migrations require a direct, non-pooler endpoint");

  if (isNeon && parsed.pathname !== "/inagle") throw new Error("Neon gameplay migrations require the inagle database");

  return url;
}

export async function applyPostgres(connectionUrl?: string): Promise<{ count: number }> {
  const url = resolveInaglePostgresUrl(connectionUrl);

  if (!url) {
    console.warn("⚠️  No Inagle PostgreSQL URL provided via INAGLE_DATABASE_URL/NIE_PG_URL.");
    console.warn("   Skipping PostgreSQL migration.");
    return { count: 0 };
  }

  console.log(`🐘 Applying PostgreSQL migrations from: ${pgMigrationsDir}`);
  if (!existsSync(pgMigrationsDir)) {
    throw new Error(`Postgres migrations dir not found at: ${pgMigrationsDir}`);
  }

  const { Client } = (await import("pg" as string)) as unknown as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>;
      query<T = unknown>(sql: string): Promise<{ rows: T[] }>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const files = readdirSync(pgMigrationsDir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      console.log(`   Applying migration: ${file}...`);
      const filePath = join(pgMigrationsDir, file);
      const sql = readFileSync(filePath, "utf-8");
      await client.query(sql);
    }

    const res = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'inagle_%' ORDER BY tablename",
    );

    console.log(`✅ PostgreSQL migrations applied: ${res.rows.length} inagle_* tables found.`);
    return { count: res.rows.length };
  } finally {
    await client.end();
  }
}

export function verifySchemas(): boolean {
  console.log("🔍 Verifying schemas...");

  // 1. Verify SQLite schema in memory
  const { count } = applySqlite(":memory:");
  if (count < 30) {
    console.error(`❌ Expected at least 30 inagle_* tables in SQLite, found ${count}`);
    return false;
  }
  console.log(`   SQLite verified: ${count} inagle_* tables in memory.`);

  // 2. Verify PostgreSQL migration files exist and are non-empty
  if (!existsSync(pgMigrationsDir)) {
    console.error(`❌ PostgreSQL migrations dir not found: ${pgMigrationsDir}`);
    return false;
  }
  const pgFiles = readdirSync(pgMigrationsDir).filter(f => f.endsWith(".sql"));
  if (pgFiles.length === 0) {
    console.error("❌ No PostgreSQL migration files found.");
    return false;
  }

  for (const f of pgFiles) {
    const content = readFileSync(join(pgMigrationsDir, f), "utf-8").trim();
    if (content.length === 0) {
      console.error(`❌ Empty migration file: ${f}`);
      return false;
    }
  }
  console.log(`   PostgreSQL verified: ${pgFiles.length} migration files present and non-empty.`);

  console.log("✅ Schema verification passed.");
  return true;
}

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  let ranSomething = false;

  if (args.includes("--verify")) {
    const ok = verifySchemas();
    if (!ok) process.exit(1);
    ranSomething = true;
  }

  if (args.includes("--sqlite")) {
    const targetPath =
      getArgValue("--sqlite") ||
      process.env.SQLITE_DB_PATH ||
      process.env.NIE_MIRROR_DB ||
      join(root, "var/mirror.sqlite");
    applySqlite(targetPath);
    ranSomething = true;
  }

  if (args.includes("--postgres")) {
    const targetUrl = getArgValue("--postgres");
    await applyPostgres(targetUrl);
    ranSomething = true;
  }

  if (!ranSomething) {
    // Default action: verify schemas in memory
    const ok = verifySchemas();
    if (!ok) process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(err => {
    console.error("❌ Migration error:", err);
    process.exit(1);
  });
}
