#!/usr/bin/env bun
// Offline Arch Wiki (arch-wiki-docs) and Omarchy manual mirror indexed with bun:sqlite FTS5.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const docsDir =
  process.env.ARCH_DOCS_DIR ?? join(homedir(), ".local", "share", "arch-docs");
export const dbPath = join(docsDir, "arch-docs.sqlite");
const omarchyDir = join(docsDir, "omarchy");
const omarchyBase = "https://learn.omacom.io";
const omarchyIndex = "/2/the-omarchy-manual";

/** arch-wiki-docs HTML root: env, the installed package, then the local extract. */
export function wikiRoot(): string | undefined {
  const candidates = [
    process.env.ARCH_WIKI_HTML,
    "/usr/share/doc/arch-wiki/html",
    join(docsDir, "wiki", "usr", "share", "doc", "arch-wiki", "html"),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): { title: string; text: string } {
  const title = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/ - ArchWiki$/, "")
    .trim();
  const body =
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<body[\s\S]*<\/body>/i.exec(html)?.[0] ??
    html;
  const text = body
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
          )
        : (entities[e] ?? m),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title, text };
}

/** Mirror every Omarchy manual page into docsDir/omarchy. */
export async function mirrorOmarchy(): Promise<number> {
  mkdirSync(omarchyDir, { recursive: true });
  const index = await (await fetch(omarchyBase + omarchyIndex)).text();
  await Bun.write(join(omarchyDir, "manual.html"), index);
  const links = [
    ...new Set(
      [...index.matchAll(/href="(\/2\/the-omarchy-manual\/[^"#]+)"/g)].map(
        (m) => m[1]!,
      ),
    ),
  ];
  let n = 0;
  for (const link of links) {
    const res = await fetch(omarchyBase + link, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) continue;
    const slug = link.split("/").slice(-2).join("-");
    await Bun.write(join(omarchyDir, `${slug}.html`), await res.text());
    n++;
  }
  return n;
}

export function openDb(readonly = true): Database {
  if (!existsSync(dbPath))
    throw new Error(`no index at ${dbPath}; run: bun-arch-docs index`);
  return new Database(dbPath, { readonly });
}

/** Rebuild the FTS5 index from the wiki HTML and the Omarchy mirror. */
export async function buildIndex(): Promise<Record<string, number>> {
  mkdirSync(docsDir, { recursive: true });
  const tmp = `${dbPath}.tmp`;
  if (existsSync(tmp)) await Bun.file(tmp).delete();
  const db = new Database(tmp, { create: true });
  db.run("PRAGMA journal_mode = OFF");
  db.run(
    "CREATE VIRTUAL TABLE docs USING fts5(source UNINDEXED, path UNINDEXED, title, body, tokenize = 'porter unicode61')",
  );
  const insert = db.prepare(
    "INSERT INTO docs (source, path, title, body) VALUES (?, ?, ?, ?)",
  );
  const counts: Record<string, number> = { wiki: 0, omarchy: 0 };
  const add = async (source: string, dir: string) => {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
    for (const f of files) {
      const { title, text } = htmlToText(await Bun.file(join(dir, f)).text());
      if (!text) continue;
      insert.run(source, join(dir, f), title || f.slice(0, -5), text);
      counts[source]!++;
    }
  };
  const root = wikiRoot();
  db.run("BEGIN");
  if (root) await add("wiki", join(root, "en"));
  await add("omarchy", omarchyDir);
  db.run("COMMIT");
  db.run("INSERT INTO docs(docs) VALUES ('optimize')");
  db.close();
  renameSync(tmp, dbPath);
  return counts;
}

export interface Hit {
  source: string;
  title: string;
  path: string;
  snippet: string;
}

export function search(
  query: string,
  source?: "wiki" | "omarchy",
  limit = 10,
): Hit[] {
  const db = openDb();
  const match = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '""')}"`)
    .join(" ");
  const rows = db
    .query(
      `SELECT source, title, path, snippet(docs, 3, '[', ']', ' … ', 24) AS snippet
       FROM docs WHERE docs MATCH ?1 ${source ? "AND source = ?3" : ""}
       ORDER BY bm25(docs, 0, 0, 8, 1) LIMIT ?2`,
    )
    .all(
      ...((source ? [match, limit, source] : [match, limit]) as [
        string,
        number,
      ]),
    ) as Hit[];
  db.close();
  return rows;
}

export function read(
  titleOrPath: string,
  offset = 0,
  max = 12_000,
): { title: string; path: string; length: number; text: string } {
  const db = openDb();
  const row = db
    .query(
      "SELECT title, path, body FROM docs WHERE path = ?1 OR title = ?1 COLLATE NOCASE LIMIT 1",
    )
    .get(titleOrPath) as { title: string; path: string; body: string } | null;
  db.close();
  if (!row) throw new Error(`page not found: ${titleOrPath}`);
  return {
    title: row.title,
    path: row.path,
    length: row.body.length,
    text: row.body.slice(offset, offset + max),
  };
}

if (import.meta.main) {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  if (cmd === "mirror-omarchy") console.log({ pages: await mirrorOmarchy() });
  else if (cmd === "index") console.log(await buildIndex());
  else if (cmd === "search")
    console.log(JSON.stringify(search(rest.join(" ")), null, 2));
  else
    console.log(
      "bun-arch-docs mirror-omarchy | index | search <terms>   (ARCH_DOCS_DIR, ARCH_WIKI_HTML)",
    );
}
