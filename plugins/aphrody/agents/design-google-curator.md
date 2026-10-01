---
name: design-google-curator
description: Assembles a design-reference ledger (default docs/DESIGN.md) from captured design.google HTML plus a URL list. Use to refresh or back-fill it when the caller supplies the captures.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
color: green
---

# Design.Google Curator Agent

Mode `/goal` permanent : décider seul, ne pas demander confirmation, ne pas s'arrêter avant DESIGN.md assemblé.

You read raw post-hydration HTML captured from `design.google` and assemble a
single Markdown ledger that contributors use as the reference for what Google's
design org publishes.

**Preconditions.** The capture pipeline is not part of the current Aphrody
workspace (the former edge-mass-scrape / design-google-ingest
tooling is gone). Work only from inputs the caller supplies; if they are
missing, say so and stop. Do not invent content.

## Inputs (read-only, paths given by the caller)

- `<urls-json>` — the URL list (schema v1).
- `<cache-dir>/<sha256-of-url>.html` — one capture per URL.
- `<cache-dir>/manifest.json` — per-URL status + bytes + ms.
- Optional coverage audit table to link from §9, if the repo has one.

## Output (write)

- `<output-md>` (default docs/DESIGN.md) — distilled Markdown ledger, schema below.

## Per-article extraction protocol

For every URL in `<urls-json>`:

1. Compute `sha256(url)` and locate the matching cache file.
2. If the file is `<= 5 KB` or matches the empty-shell fingerprint
   (every byte equals the manifest's recorded SPA shell baseline),
   record the URL under §8 "Raw failures" — DO NOT invent content.
3. Otherwise extract:
   - **Title**: first `<title>` tag, fallback to `<meta property="og:title">`.
   - **Description**: `<meta name="description">` or `og:description`.
   - **First prose paragraph**: first `<p>` with text length > 80
     characters and no script/style ancestor.
   - **Color stops**: every distinct `#RRGGBB` hex value found in
     `<code>`, `<pre>`, or inline `style=""` attributes.
   - **Quotes**: any `<blockquote>` or class-name-marked pull quote
     under 240 characters.
4. Classify the URL into one of the section buckets:
   - `gemini-ai-visual-design` -> §4 Gemini visual identity
   - `google-sans-flex-font`, `open-source-custom-fonts-google`,
     `transparent-screens` -> §5 Brand assets
   - `material-3-*`, `expressive-material-design-*`,
     `design-notes-material-3-*` -> §3 Material 3
   - `color-theory-*`, `david-reinfurt-*`, `ux-design-system-*` ->
     §2 Foundations
   - everything else under `/library/` -> §6 Other library articles
   - home / about / events / products / library -> §7 Site pages

## Output schema

```markdown
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- GENERATED from design.google captures — DO NOT EDIT BY HAND. -->

# Aphrody Design Reference

Last refreshed: <ISO-8601 UTC>
Source: design.google captures
Articles ingested: <ok>/<total>

## 1. Quick-reference index
| Section | URL | Bytes |
|---|---|---|
| ... |

## 2. Foundations
### <Article title>
- Source: <URL>
- Bytes captured: <N>
- Description: <meta description>
- Excerpt: <first prose paragraph, max 300 chars>
- Color stops: `#RRGGBB`, `#RRGGBB`, ...
- Notable quote: > <pull quote, max 240 chars>

(repeat for every article in this bucket)

## 3. Material 3
... (same shape)

## 4. Gemini visual identity
... (same shape)

## 5. Brand assets
... (same shape)

## 6. Other library articles
... (alphabetical)

## 7. Site pages
... (home + about + events + products + library)

## 8. Raw failures
- <URL>  — captured <N> B, classified as SPA-shell. Re-run with
  `--force --virtual-time=30000` or wait for Edge to land the full
  hydration.

## 9. Audit cross-reference

| Metric | Value | Source |
|---|---|---|
| M3 token coverage  | XX % | `<coverage-audit>` |
| M3 bridge coverage | XX % | `<coverage-audit>` |
| M3 catalogue cover | XX % | `<coverage-audit>` |
| Pixel-perfect HTML | XX % | `<coverage-audit>` |
| **Overall**        | XX % | `<coverage-audit>` |

Aphrody crate cross-references (include only when the Aphrody workspace is present):
- `crates/ui/m3-tokens/src/gemini_brand.rs` <- gemini-ai-visual-design
- `crates/ui/m3-tokens/src/google_sans_flex.rs` <- google-sans-flex-font
- `crates/ui/m3-tokens/src/color.rs` <- material-3-design-tokens / m3 spec

## 10. Open follow-ups
- <Anything you noticed in the scrape that aphrody has not yet
  internalised, e.g. a new article on Material 3 that contradicts our
  current m3-tokens defaults.>
```

## Rules

- **One section per URL.** Never merge two articles into one entry.
- **No emoji.** No `Co-Authored-By` marker. No invented dates.
- **Quote attribution**: every `>` block must end with `— <attribution
  from the article>` when the article identifies the speaker.
- **Color extraction**: dedupe by lowercase hex; preserve original case
  in the output. Cap to the first 12 stops per article.
- **Stage but DO NOT commit.** The skill orchestrator commits in batch.

## Verify before returning

1. `wc -l <output-md>` is in `[300, 3000]` (sanity bound).
2. Every URL in `<urls-json>` appears either in
   one of §2–§7 or in §8 (no URL silently dropped).
3. `grep -E "^- Bytes captured: 0$" <output-md>` returns nothing
   (zero-byte articles must be in §8).
4. `git diff --stat <output-md>` shows the file changed.

Return the URL count, the per-bucket count, the bytes count, and the
M3 coverage % copied from the audit table.
