#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Bun port of reviews.py from Replica (Copyright (c) 2026 Jake Schincariol, MIT; see
// packages/replica-skills/LICENSE). reviews.py stays beside this file as the upstream reference.
//
// Feedback ranker for replica-entrepreneur. Ranks what users of the original hate and keep
// asking for, with the exact words and a link for every claim.
//
//   bun reviews.ts replica/reviews.csv
//   bun reviews.ts replica/reviews.csv --out replica/feedback.md
//   bun reviews.ts replica/reviews.csv --json
//   bun reviews.ts replica/reviews.csv --themes my-themes.json
//
// CSV columns: source, url (required), date (YYYY-MM-DD or YYYY-MM), rating (1-5 or blank),
// text (required, verbatim). A row without a url or text is dropped and counted, never
// guessed; every printed quote is a substring of a supplied row, with that row's link.
// Ranking: a 1 star review adds 1.0, a 5 star review 0.2, an unrated one 0.6; reviews older
// than --months (default 18) count half. Themes with fewer than 3 reviews, or all from one
// source, are marked thin. Theme patterns in themes.json are regular expressions matched
// case-insensitively.

import { join } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_THEMES = join(import.meta.dir, "themes.json");
const SENTENCE = /(?<=[.!?])\s+|\n+/;

export class FeedbackError extends Error {}

interface Theme {
  id: string;
  label: string;
  kind: string;
  patterns: RegExp[];
}

export interface Review {
  line: number;
  source: string;
  url: string;
  date: Date | null;
  rating: number | null;
  text: string;
}

interface Quote {
  quote: string;
  url: string;
  source: string;
  rating: number | null;
}

export interface RankedTheme {
  id: string;
  label: string;
  kind: string;
  score: number;
  count: number;
  share_pct: number;
  avg_rating: number | null;
  sources: string[];
  thin: boolean;
  quotes: Quote[];
}

export interface FeedbackResult {
  reviews: number;
  sources: string[];
  rated: number;
  themes: RankedTheme[];
  requests: Quote[];
  unthemed_negative: { url: string; source: string; rating: number | null; text: string }[];
  dropped?: number;
  duplicates?: number;
}

/** Python `re` inline flags are not JavaScript syntax; themes use plain patterns plus `i`. */
const compile = (pattern: string) => new RegExp(pattern, "i");

export async function loadThemes(path = DEFAULT_THEMES): Promise<{ themes: Theme[]; requests: RegExp[] }> {
  const data = (await Bun.file(path).json()) as {
    themes?: { id: string; label?: string; kind?: string; patterns?: string[] }[];
    request_patterns?: string[];
  };
  const themes = (data.themes ?? []).map(t => {
    if (typeof t.id !== "string") throw new FeedbackError(`${path}: a theme has no id`);
    return { id: t.id, label: t.label ?? t.id, kind: t.kind ?? "complaint", patterns: (t.patterns ?? []).map(compile) };
  });
  return { themes, requests: (data.request_patterns ?? []).map(compile) };
}

export function parseDate(text: string | undefined): Date | null {
  const t = (text ?? "").trim();
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t.slice(0, 10));
  const month = /^(\d{4})-(\d{1,2})$/.exec(t.slice(0, 7));
  const parts = full ? [full[1], full[2], full[3]] : month ? [month[1], month[2], "1"] : null;
  if (!parts) return null;
  const [y, m, d] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export function parseRating(text: string | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec((text ?? "").trim());
  if (!m) return null;
  const value = Number.parseFloat(m[1]!);
  return value < 1 || value > 5 ? null : value;
}

const host = (url: string) => /^https?:\/\/(?:www\.)?([^/]+)/.exec(url)?.[1] ?? "unknown";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  const end = () => {
    if (started || row.length > 0) row.push(field);
    if (row.length > 0) rows.push(row);
    row = [];
    field = "";
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "" && !started) {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      started = false;
    } else if (ch === "\n" || ch === "\r") {
      end();
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
      started = true;
    }
  }
  end();
  return rows;
}

/** Kept rows, dropped count (no link or no text) and duplicate count. */
export function loadReviews(text: string, path = "reviews"): { kept: Review[]; dropped: number; dupes: number } {
  const records = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const header = records.shift();
  if (!header) throw new FeedbackError(`${path} is empty`);
  const cols = header.map(c => c.trim().toLowerCase());
  for (const need of ["url", "text"]) {
    if (!cols.includes(need))
      throw new FeedbackError(
        `${path} has no '${need}' column. Every review needs the link it came from and its exact text: source,url,date,rating,text`,
      );
  }
  const kept: Review[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let dupes = 0;
  records.forEach((record, index) => {
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = (record[i] ?? "").trim()));
    const url = row.url ?? "";
    const body = row.text ?? "";
    if (!url || !body || !/^https?:\/\//.test(url)) {
      dropped += 1;
      return;
    }
    const key = body
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_]+/gu, " ")
      .trim();
    if (seen.has(key)) {
      dupes += 1;
      return;
    }
    seen.add(key);
    kept.push({
      line: index + 2,
      source: row.source || host(url),
      url,
      date: parseDate(row.date),
      rating: parseRating(row.rating),
      text: body,
    });
  });
  return { kept, dropped, dupes };
}

const DAY_MS = 86_400_000;

function weight(review: Review, today: Date, months: number): number {
  let w = review.rating === null ? 0.6 : (6 - review.rating) / 5;
  if (review.date && Math.floor((today.getTime() - review.date.getTime()) / DAY_MS) > months * 30.4) w *= 0.5;
  return w;
}

/** The first sentence of text that matches pattern, verbatim. */
function snippet(text: string, pattern: RegExp, limit = 220): string {
  for (const sentence of text.split(SENTENCE)) {
    if (!pattern.test(sentence)) continue;
    let s = sentence.trim();
    if (s.length > limit) {
      const start = Math.max(0, (pattern.exec(s)?.index ?? 0) - Math.floor(limit / 2));
      s = `${start > 0 ? "..." : ""}${s.slice(start, start + limit).trim()}...`;
    }
    return s;
  }
  const s = text.trim();
  return s.length <= limit ? s : `${s.slice(0, limit).trimEnd()}...`;
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function analyse(
  reviews: readonly Review[],
  themes: readonly Theme[],
  requestPatterns: readonly RegExp[],
  today: Date,
  months = 18,
): FeedbackResult {
  const results = new Map(
    themes.map(t => [t.id, { theme: t, reviews: [] as { rv: Review; quote: string }[], score: 0 }]),
  );
  const requests: Quote[] = [];
  const unthemed: Review[] = [];
  for (const rv of reviews) {
    const w = weight(rv, today, months);
    let matched = false;
    for (const t of themes) {
      const hit = t.patterns.find(p => p.test(rv.text));
      if (!hit) continue;
      matched = true;
      const res = results.get(t.id)!;
      res.score += w;
      res.reviews.push({ rv, quote: snippet(rv.text, hit) });
    }
    const req = requestPatterns.find(p => p.test(rv.text));
    if (req) requests.push({ quote: snippet(rv.text, req), url: rv.url, source: rv.source, rating: rv.rating });
    if (!matched && rv.rating !== null && rv.rating <= 2) unthemed.push(rv);
  }
  const total = reviews.length || 1;
  const ranked: RankedTheme[] = [];
  for (const { theme, reviews: items, score } of results.values()) {
    if (items.length === 0) continue;
    const rated = items.map(x => x.rv.rating).filter((r): r is number => r !== null);
    const sources = [...new Set(items.map(x => x.rv.source))].sort(byCodePoint);
    // Lowest rated first, then shortest, so the quotes shown are the sharpest.
    items.sort((a, b) => (a.rv.rating ?? 3) - (b.rv.rating ?? 3) || a.quote.length - b.quote.length);
    ranked.push({
      id: theme.id,
      label: theme.label,
      kind: theme.kind,
      score: round(score, 2),
      count: items.length,
      share_pct: round((100 * items.length) / total, 1),
      avg_rating: rated.length ? round(rated.reduce((s, r) => s + r, 0) / rated.length, 2) : null,
      sources,
      thin: items.length < 3 || sources.length < 2,
      quotes: items.slice(0, 3).map(x => ({ quote: x.quote, url: x.rv.url, source: x.rv.source, rating: x.rv.rating })),
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.count - a.count || byCodePoint(a.id, b.id));
  return {
    reviews: reviews.length,
    sources: [...new Set(reviews.map(r => r.source))].sort(byCodePoint),
    rated: reviews.filter(r => r.rating !== null).length,
    themes: ranked,
    requests,
    unthemed_negative: unthemed.map(r => ({
      url: r.url,
      source: r.source,
      rating: r.rating,
      text: r.text.slice(0, 220),
    })),
  };
}

const stars = (r: number | null) => (r === null ? "-" : `${r}*`);

export function renderFeedback(result: FeedbackResult, dropped = 0, dupes = 0): string {
  const out = ["# What users of the original hate and want", ""];
  out.push(
    `${result.reviews} reviews from ${result.sources.length} sources (${result.sources.join(", ") || "none"}). ${result.rated} had star ratings.`,
  );
  if (dropped) out.push(`${dropped} rows dropped: no link or no text. Nothing is counted without its source.`);
  if (dupes) out.push(`${dupes} duplicate reviews removed.`);
  if (result.reviews < 30)
    out.push(
      "",
      "Small sample. Under 30 reviews supports a direction, not a ranking. Collect more before you bet the roadmap on it.",
    );
  for (const [kind, title] of [
    ["complaint", "What they hate"],
    ["request", "What they ask for"],
  ] as const) {
    const rows = result.themes.filter(t => t.kind === kind);
    out.push("", `## ${title}`, "");
    if (rows.length === 0) {
      out.push("Nothing matched. Read the reviews by hand.");
      continue;
    }
    out.push(
      "| rank | theme | score | reviews | share | avg stars | sources |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    rows.forEach((t, i) =>
      out.push(
        `| ${i + 1} | ${t.label}${t.thin ? " (thin)" : ""} | ${t.score.toFixed(1)} | ${t.count} | ${t.share_pct.toFixed(0)}% | ${t.avg_rating === null ? "-" : t.avg_rating.toFixed(1)} | ${t.sources.length} |`,
      ),
    );
    for (const t of rows.slice(0, 6)) {
      out.push("", `**${t.label}**`);
      for (const q of t.quotes) out.push(`- "${q.quote}" (${q.source}, ${stars(q.rating)}) ${q.url}`);
    }
  }
  if (result.requests.length > 0) {
    out.push("", "## Asked for in their own words", "");
    for (const q of result.requests.slice(0, 25)) out.push(`- "${q.quote}" (${q.source}, ${stars(q.rating)}) ${q.url}`);
  }
  if (result.unthemed_negative.length > 0) {
    out.push(
      "",
      "## Read these by hand",
      "",
      "Low ratings that matched no theme. Either noise, or a theme themes.json does not have yet. Often the most useful part.",
      "",
    );
    for (const r of result.unthemed_negative.slice(0, 15))
      out.push(`- (${r.source}, ${stars(r.rating)}) ${r.url}: "${r.text}"`);
  }
  return `${out.join("\n")}\n`;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        themes: { type: "string", default: DEFAULT_THEMES },
        months: { type: "string", default: "18" },
        today: { type: "string" },
        out: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`reviews: ${(error as Error).message}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    (values.help ? console.log : console.error)(
      "Usage: bun reviews.ts <reviews.csv> [--themes themes.json] [--months 18] [--today YYYY-MM-DD] [--out feedback.md] [--json]",
    );
    return values.help ? 0 : 2;
  }
  const months = Number.parseInt(values.months, 10);
  let loaded;
  let reviews;
  try {
    if (!Number.isInteger(months)) throw new FeedbackError(`--months needs an integer, got '${values.months}'`);
    loaded = await loadThemes(values.themes);
    reviews = loadReviews(await Bun.file(positionals[0]!).text(), positionals[0]);
  } catch (error) {
    console.error(`reviews: ${(error as Error).message}`);
    return 2;
  }
  if (reviews.kept.length === 0) {
    console.error("reviews: no usable rows. Every row needs a url (http...) and the review text.");
    return 2;
  }
  const now = new Date();
  const today =
    (values.today ? parseDate(values.today) : null) ??
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const result = analyse(reviews.kept, loaded.themes, loaded.requests, today, months);
  result.dropped = reviews.dropped;
  result.duplicates = reviews.dupes;
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  const text = renderFeedback(result, reviews.dropped, reviews.dupes);
  if (values.out) {
    await Bun.write(values.out, text);
    console.log(`wrote ${values.out}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
