#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// Bun port of listing.py from Replica (Copyright (c) 2026 Jake Schincariol, MIT; see
// packages/replica-skills/LICENSE). listing.py stays beside this file as the upstream reference.
//
// Store listing linter for replica-launch. Checks an App Store and Google Play listing
// against the stores' field limits and the mistakes that get a clone rejected: the original
// app's name in the metadata, ranking claims in the title, wasted keyword characters.
//
//   bun listing.ts replica/launch/listing.json
//   bun listing.ts listing.json --avoid "Calendly,Acuity Scheduling"
//   bun listing.ts listing.json --json
//
// listing.json (see listing.example.json): {"avoid": [...], "app_store": {name, subtitle,
// promotional_text, description, keywords, whats_new}, "google_play": {title,
// short_description, full_description}}. Leave out a store you are not shipping to.
// Exit code 1 on any error, 0 when there are only warnings, 2 on unreadable input.

import { parseArgs } from "node:util";

const LIMITS: Record<string, Record<string, number>> = {
  app_store: { name: 30, subtitle: 30, promotional_text: 170, description: 4000, keywords: 100, whats_new: 4000 },
  google_play: { title: 30, short_description: 80, full_description: 4000 },
};
const SHORT_FIELDS = new Set(["name", "subtitle", "title", "short_description"]);
const REQUIRED_FIELDS = new Set(["name", "title", "description", "full_description"]);
const CLAIMS =
  /(#\s?1\b|\bnumber one\b|\bno\.? ?1\b|\bbest\b|\btop[- ]rated\b|\b(app|game) of the year\b|\bfree\b|\bdiscount\b|\bsale\b|\b\d+% off\b|\bnew!?$)/i;
const STOP = new Set(["a", "an", "and", "app", "for", "the", "to", "of", "with", "your", "you", "in", "on", "&"]);
const ZWJ = 0x200d;
const VARIATION_SELECTORS = new Set([0xfe0e, 0xfe0f]);
const COMBINING = /^[\p{Mn}\p{Me}]$/u;
const SYMBOL = /^\p{So}$/u;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Store = "app_store" | "google_play";
export interface Listing {
  avoid?: string[];
  app_store?: Record<string, string>;
  google_play?: Record<string, string>;
}
export interface ListingIssue {
  level: "error" | "warn";
  store: string;
  field: string;
  message: string;
}

/** Characters as a person counts them (an emoji built from parts is one). */
export function visibleLength(text: string | undefined): number {
  let count = 0;
  let prevJoiner = false;
  for (const ch of (text ?? "").normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === ZWJ) {
      prevJoiner = true;
      continue;
    }
    if (COMBINING.test(ch) || VARIATION_SELECTORS.has(cp) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue;
    if (prevJoiner) {
      prevJoiner = false;
      continue;
    }
    count += 1;
  }
  return count;
}

const hasEmoji = (text: string) => [...text].some(ch => SYMBOL.test(ch) || ch.codePointAt(0)! >= 0x1f000);
const words = (text: string | undefined) =>
  ((text ?? "").toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(w => !STOP.has(w));

export function lintListing(listing: Listing, avoidOverride?: readonly string[]): ListingIssue[] {
  const issues: ListingIssue[] = [];
  const avoid = (avoidOverride ?? listing.avoid ?? []).map(a => a.trim()).filter(Boolean);
  const add = (level: ListingIssue["level"], store: string, field: string, message: string) =>
    issues.push({ level, store, field, message });
  let foundStore = false;
  for (const [store, limits] of Object.entries(LIMITS)) {
    const data = listing[store as Store];
    if (!data || Object.keys(data).length === 0) continue;
    foundStore = true;
    for (const [field, limit] of Object.entries(limits)) {
      const value = data[field] ?? "";
      const n = visibleLength(value);
      if (!value) {
        add(REQUIRED_FIELDS.has(field) ? "error" : "warn", store, field, "empty");
        continue;
      }
      if (n > limit) add("error", store, field, `${n} characters, limit is ${limit} (${n - limit} over)`);
      for (const name of avoid) {
        if (new RegExp(`(?<!\\w)${escape(name)}(?!\\w)`, "i").test(value))
          add(
            "error",
            store,
            field,
            `mentions '${name}'. Another app's name or trademark in your metadata gets the listing rejected and invites a takedown. Describe what yours does instead.`,
          );
      }
      if (SHORT_FIELDS.has(field)) {
        const claim = CLAIMS.exec(value);
        if (claim)
          add(
            "warn",
            store,
            field,
            `'${claim[0].trim()}' reads as a ranking or price claim. Google Play bans these in the title and short description, and Apple rejects claims you cannot back up.`,
          );
        if (hasEmoji(value))
          add(
            "warn",
            store,
            field,
            "emoji in a short field. Play rejects them in titles; App Store reviewers often do too.",
          );
        const caps = value.match(/\b[A-Z]{4,}\b/g);
        if (caps) add("warn", store, field, `all-caps word(s): ${caps.join(", ")}`);
      }
    }
    if (store === "app_store" && data.keywords) {
      const raw = data.keywords;
      const parts = raw.split(",").map(k => k.trim().toLowerCase());
      if (/,\s/.test(raw))
        add("warn", store, "keywords", "spaces after commas waste characters. Use word1,word2,word3");
      const dupes = [...new Set(parts.filter(k => k && parts.filter(p => p === k).length > 1))].sort();
      if (dupes.length > 0) add("warn", store, "keywords", `repeated: ${dupes.join(", ")}`);
      const inName = new Set([...words(data.name), ...words(data.subtitle)]);
      const wasted = [...new Set(parts.flatMap(k => words(k)).filter(w => inName.has(w)))].sort();
      if (wasted.length > 0)
        add(
          "warn",
          store,
          "keywords",
          `already in the name or subtitle, so these characters are wasted: ${wasted.join(", ")}`,
        );
      if (parts.some(k => !k)) add("warn", store, "keywords", "empty entry (double comma or trailing comma)");
    }
  }
  if (!foundStore) add("error", "-", "-", "no app_store or google_play section found");
  return issues;
}

const title = (store: string) => store.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());

export function renderListing(listing: Listing, issues: readonly ListingIssue[]): string {
  const out: string[] = [];
  for (const [store, limits] of Object.entries(LIMITS)) {
    const data = listing[store as Store];
    if (!data || Object.keys(data).length === 0) continue;
    out.push(title(store));
    for (const [field, limit] of Object.entries(limits)) {
      const n = visibleLength(data[field]);
      const mark = n > limit ? "OVER" : n ? "ok" : "--";
      out.push(`  ${field.padEnd(18)} ${String(n).padStart(5)} / ${String(limit).padEnd(5)} ${mark}`);
    }
    out.push("");
  }
  if (issues.length === 0) out.push("No issues.");
  for (const i of issues) out.push(`${i.level.toUpperCase().padEnd(5)} ${i.store}.${i.field}: ${i.message}`);
  const errors = issues.filter(i => i.level === "error").length;
  out.push("", `${errors} errors, ${issues.length - errors} warnings`);
  return out.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        avoid: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`listing: ${(error as Error).message}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    (values.help ? console.log : console.error)("Usage: bun listing.ts <listing.json> [--avoid <names>] [--json]");
    return values.help ? 0 : 2;
  }
  let listing: Listing;
  try {
    listing = (await Bun.file(positionals[0]!).json()) as Listing;
  } catch (error) {
    console.error(`listing: ${(error as Error).message}`);
    return 2;
  }
  const issues = lintListing(listing, values.avoid ? values.avoid.split(",") : undefined);
  console.log(values.json ? JSON.stringify(issues, null, 2) : renderListing(listing, issues));
  return issues.some(i => i.level === "error") ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
