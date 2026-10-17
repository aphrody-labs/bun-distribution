/** bun:sqlite store for crawled Android docs: crawl state plus an FTS5 index. */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function docsHome(): string {
  return Bun.env.ANDROID_DOCS_HOME ?? join(Bun.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "android-docs");
}

export interface DocHit {
  url: string;
  title: string;
  snippet: string;
}

export class DocsStore {
  readonly db: Database;
  readonly home: string;

  constructor(home = docsHome()) {
    this.home = home;
    mkdirSync(home, { recursive: true });
    this.db = new Database(join(home, "docs.db"), { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 30000;
      CREATE TABLE IF NOT EXISTS pages (
        url TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        lastmod TEXT,
        status INTEGER,
        etag TEXT,
        fetched_at INTEGER,
        title TEXT,
        bytes INTEGER
      );
      CREATE INDEX IF NOT EXISTS pages_pending ON pages(status);
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        url UNINDEXED, source UNINDEXED, title, body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  /** Queue a URL; a newer sitemap lastmod resets it to pending. */
  enqueue(url: string, source: string, lastmod: string | null): void {
    this.db
      .query(
        `INSERT INTO pages (url, source, lastmod) VALUES (?1, ?2, ?3)
         ON CONFLICT(url) DO UPDATE SET lastmod = excluded.lastmod,
           status = CASE WHEN excluded.lastmod IS NOT NULL
             AND (pages.lastmod IS NULL OR excluded.lastmod > pages.lastmod)
             THEN NULL ELSE pages.status END`,
      )
      .run(url, source, lastmod);
  }

  /** Queue links found in pages, leaving known URLs untouched. */
  discover(urls: Iterable<string>, source: string): void {
    const insert = this.db.query("INSERT OR IGNORE INTO pages (url, source) VALUES (?1, ?2)");
    this.db.transaction(() => {
      for (const url of urls) insert.run(url, source);
    })();
  }

  pending(source: string | null, limit: number): { url: string; etag: string | null }[] {
    return this.db
      .query<{ url: string; etag: string | null }, [string | null, number]>(
        `SELECT url, etag FROM pages WHERE status IS NULL
         AND (?1 IS NULL OR source = ?1) LIMIT ?2`,
      )
      .all(source, limit);
  }

  save(url: string, source: string, status: number, etag: string | null, title = "", body?: string): void {
    const bytes = body?.length ?? 0;
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE pages SET status = ?2, etag = COALESCE(?3, etag), fetched_at = ?4,
           title = ?5, bytes = CASE WHEN ?7 THEN ?6 ELSE bytes END WHERE url = ?1`,
        )
        .run(url, status, etag, Date.now(), title, bytes, body !== undefined ? 1 : 0);
      if (body !== undefined) {
        this.db.query("DELETE FROM docs WHERE url = ?1").run(url);
        this.db
          .query("INSERT INTO docs (url, source, title, body) VALUES (?1, ?2, ?3, ?4)")
          .run(url, source, title, body);
      }
    })();
  }

  /** Reset failed fetches so the next run retries them. */
  retryFailed(): number {
    return this.db.query("UPDATE pages SET status = NULL WHERE status = -1 OR status >= 500").run().changes;
  }

  search(query: string, limit = 10, source?: string): DocHit[] {
    const match = /["*:()^]|\b(AND|OR|NOT|NEAR)\b/.test(query)
      ? query
      : query
          .split(/\s+/)
          .filter(Boolean)
          .map(term => `"${term.replaceAll('"', "")}"`)
          .join(" ");
    return this.db
      .query<DocHit, [string, string | null, number]>(
        `SELECT url, title, snippet(docs, 3, '[', ']', ' … ', 24) AS snippet
         FROM docs WHERE docs MATCH ?1 AND (?2 IS NULL OR source = ?2)
         ORDER BY bm25(docs, 0, 0, 10, 1) LIMIT ?3`,
      )
      .all(match, source ?? null, limit);
  }

  stats(): { source: string; pages: number; done: number; bytes: number }[] {
    return this.db
      .query<{ source: string; pages: number; done: number; bytes: number }, []>(
        `SELECT source, COUNT(*) AS pages, SUM(status = 200) AS done,
         COALESCE(SUM(bytes), 0) AS bytes FROM pages GROUP BY source ORDER BY source`,
      )
      .all();
  }

  close(): void {
    this.db.close();
  }
}
