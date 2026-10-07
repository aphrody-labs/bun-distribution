// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { RedisClient } from "bun";
import type { Snapshot } from "./model.ts";

export const DDL = `CREATE TABLE IF NOT EXISTS shenron_timeline (
  generation TEXT NOT NULL, entry_key TEXT NOT NULL, kind TEXT NOT NULL,
  source_id INTEGER NOT NULL, editorial_rank INTEGER, age_year INTEGER,
  title TEXT NOT NULL, era TEXT NOT NULL, source_url TEXT NOT NULL,
  source_ref TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (generation, entry_key)
);
CREATE INDEX IF NOT EXISTS shenron_timeline_rank ON shenron_timeline(generation, editorial_rank);
CREATE INDEX IF NOT EXISTS shenron_timeline_age ON shenron_timeline(generation, age_year);
CREATE TABLE IF NOT EXISTS shenron_timeline_generation (
  generation TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, media_total INTEGER NOT NULL, age_total INTEGER NOT NULL
);`;

const literal = (value: string | number | null) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${value.replaceAll("'", "''")}'`;
export function sqlExport(snapshot: Snapshot): string {
  const rows = snapshot.entries.map(
    (e) =>
      `INSERT INTO shenron_timeline VALUES (${[snapshot.generation, e.key, e.kind, e.id, e.rank, e.ageYear, e.title, e.era, e.href, e.sourceRef, JSON.stringify(e)].map(literal).join(",")}) ON CONFLICT (generation, entry_key) DO NOTHING;`,
  );
  return `BEGIN;\n${DDL}\n${rows.join("\n")}\nINSERT INTO shenron_timeline_generation VALUES (${[snapshot.generation, snapshot.fetchedAt, snapshot.mediaTotal, snapshot.ageTotal].map(literal).join(",")}) ON CONFLICT (generation) DO NOTHING;\nCOMMIT;\n`;
}
export function sqliteExport(snapshot: Snapshot, path: string): void {
  const db = new Database(path, { create: true });
  try {
    db.exec(sqlExport(snapshot));
  } finally {
    db.close();
  }
}

/** One immutable Redis hash + sorted sets; publish only after cardinality checks. */
export async function redisIndex(snapshot: Snapshot, url: string): Promise<void> {
  const client = new RedisClient(url, { connectionTimeout: 10_000 });
  const base = `shenron:timeline:${snapshot.generation}`;
  try {
    const pairs = snapshot.entries.flatMap((e) => [e.key, JSON.stringify(e)]);
    await client.send("HSET", [`${base}:entries`, ...pairs]);
    await client.send("ZADD", [
      `${base}:media`,
      ...snapshot.entries.flatMap((e) => (e.rank === null ? [] : [String(e.rank), e.key])),
    ]);
    await client.send("ZADD", [
      `${base}:ages`,
      ...snapshot.entries.flatMap((e) => (e.kind === "age" ? [String(e.ageYear), e.key] : [])),
    ]);
    const counts = await Promise.all([
      client.send("HLEN", [`${base}:entries`]),
      client.send("ZCARD", [`${base}:media`]),
      client.send("ZCARD", [`${base}:ages`]),
    ]);
    if (
      Number(counts[0]) !== snapshot.entries.length ||
      Number(counts[1]) !== snapshot.mediaTotal ||
      Number(counts[2]) !== snapshot.ageTotal
    )
      throw new Error("Redis cardinality mismatch");
    await client.send("SET", [
      `${base}:manifest`,
      JSON.stringify({
        generation: snapshot.generation,
        mediaTotal: snapshot.mediaTotal,
        ageTotal: snapshot.ageTotal,
        fetchedAt: snapshot.fetchedAt,
      }),
    ]);
    // Refresh renews the current generation; abandoned projections expire in seven days.
    await Promise.all(
      ["entries", "media", "ages", "manifest"].map((suffix) =>
        client.send("EXPIRE", [`${base}:${suffix}`, "604800"]),
      ),
    );
    await client.send("SET", ["shenron:timeline:current", snapshot.generation]);
  } finally {
    client.close();
  }
}
