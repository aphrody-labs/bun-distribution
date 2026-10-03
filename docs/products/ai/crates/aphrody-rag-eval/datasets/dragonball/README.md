# Dragon Ball corpus

Source registry, crawl plan and ingestion for the Dragon Ball RAG corpus. The
operator decided on 2026-09-25 to index every source in the registry in depth.
The decision is recorded in the superproject ledger
`docs/governance/OPEN-RESERVATIONS.md` (not in repo), under Resolved.

| File | Role |
| --- | --- |
| `sources.json` | Source registry: canon, anime, films, games, spin-offs, wikis, DBM, Carddass. Copied from `~/.aphrody/workspaces/dbfr/indexes/universal-sources.json`, which it replaces. |
| `crawl.config.json` | Crawl plan: targets with seeds, scope, politeness budget and `sourceRefs` into the registry. Every registry source is referenced; disabled targets carry a `policy` reason. |
| `ingest-rag.ts` | Lexical ingestion of the exported JSONL into an `aphrody-rag` SQLite store (same schema and document rules as `aphrody rag ingest-shenron`). |
| `manifests/` | Small per-run manifests (counts, stats) that are committed. |

Raw crawl output never enters Git. It lives under `~/.aphrody/workspaces/dbfr/crawl/`
(override with `APHRODY_CORPUS_CRAWL_DIR`):

```
crawl/frontier/<target>.db      resumable SQLite frontier (+ .seen Cuckoo filter)
crawl/index/<target>.sqlite     BXC Web index: Markdown, metadata, links, hashes, validators
crawl/corpus/<target>.jsonl     ingest-ready documents {id, name, url, markdown, lang, entity, kind}
crawl/manifests/<target>.json   per-run stats
crawl/rag.sqlite                aphrody-rag store (docs, chunks, chunks_fts)
```

## Engine

The crawl engine is the existing BXC `MassiveCrawler` (`aphrody-web/apps/bxc`),
driven by `bxc corpus`, so there is no second crawler. MediaWiki targets
(`"mode": "mediawiki"`, the Fandom wikis) do not crawl HTML: they go through
the existing BXC MediaWiki client (`src/crawler/mediawiki.ts`, also behind
`bxc wiki`), enumerating pages with `api.php?generator=allpages` and reading
each one with `action=parse`, one request per 6 s per host; a page whose
`lastrevid` equals the stored revision is not fetched again. For every target:

- robots.txt is an explicit option: `respectRobots` at config level (default
  `false`) or per target. This corpus runs with it off by operator decision
  (2026-09-26). When it is on, robots groups are matched on the User-Agent
  product token (`AphrodyCorpusBot`) and an unreadable robots.txt (401/403)
  counts as "no rules".
- A host that hard-blocks (403 / challenge) is not worked around: the manifest
  records `hardBlocked` (and `blockedStatus` for MediaWiki) and the run moves on.
- Requests carry the honest User-Agent from the config, with no browser
  impersonation. The fetch ladder is `http` only: no render or stealth tier and
  no challenge bypass.
- Each registrable domain gets one request in flight and a minimum delay
  (`perHostDelayMs`, 1.5 s or more). A robots `Crawl-delay` and `Retry-After`
  on 429/503 raise the delay.
- Revisits are conditional (`If-None-Match` / `If-Modified-Since` from the stored
  validators). A `304` is counted as unchanged.
- Deduplication uses the canonical URL, the exact content hash and SimHash
  near-duplicates. Content-neutral query parameters are learned and stripped.
- Only text is stored: Markdown, metadata and up to 200 outgoing links per
  document. Raw HTML is not kept (`storeRawHtml: false`). Media URLs are
  excluded, and non-text responses are dropped unread.

## Target status (updated 2026-09-26)

| Target | Status | Why |
| --- | --- | --- |
| `dbm-fr`, `dbm-en` | enabled | robots.txt only disallows `admin.php`. |
| `wikipedia-fr`, `wikipedia-en` | enabled | Reference articles for the works that have no crawlable official source (manga, guides, anime, films, games, spin-offs, Carddass). Scope is limited to Dragon Ball titles, depth 2. |
| `fandom-fr`, `fandom-en` | enabled (`mediawiki`) | HTML and robots.txt sit behind a Cloudflare challenge; `api.php` answers. Read through the MediaWiki client at 6 s per request. |
| `kanzenshuu` | enabled | robots.txt opts out AI agents; crawled by operator decision 2026-09-26 (robots gating off), 3 s per request, forum excluded. |
| `dragonballcn` | enabled | robots.txt opts out AI crawlers; crawled by operator decision 2026-09-26. Text pages only, scan images are never fetched. |

## Runbook

Prerequisite: the BXC Rust bridge. Either set
`BXC_RUST_BRIDGE_LIB=<path to bxc_rust_bridge.dll|.so>` or build it with
`bun run build:native` in `aphrody-web/apps/bxc`.

From `aphrody-web/apps/bxc`:

```sh
CFG=../../../crates/ai/rag-eval/datasets/dragonball/crawl.config.json

# Targets and their status
bun src/cli/index.ts corpus list --config "$CFG"

# Bounded smoke run (100 pages of one target)
bun src/cli/index.ts corpus crawl --config "$CFG" --target dbm-fr --max-pages 100

# Full crawl: every enabled target in turn, resumable. Stop with Ctrl-C and rerun
# the same command to continue from the frontier.
bun src/cli/index.ts corpus crawl --config "$CFG"

# Re-export JSONL from existing indexes without crawling
bun src/cli/index.ts corpus export --config "$CFG"
```

Ingest the exports. From this directory:

```sh
CRAWL=~/.aphrody/workspaces/dbfr/crawl
# Canonical (Rust, adds dense vectors when an embedder is configured):
aphrody rag ingest-shenron "$CRAWL/corpus" --db "$CRAWL/rag.sqlite"
# Without the aphrody binary (lexical only, same schema):
bun ingest-rag.ts --db "$CRAWL/rag.sqlite" "$CRAWL"/corpus/*.jsonl
```

Evaluate retrieval with the Rust harness:
`aphrody-rag-eval --target local --db "$CRAWL/rag.sqlite" --gold <gold.jsonl>`.

Smoke run 2026-09-26 (`--max-pages 100` per target, sequential, then
`ingest-rag.ts` into `rag.sqlite`):

| Target | Mode | Fetched | Indexed | Exported docs | Notes |
| --- | --- | --- | --- | --- | --- |
| `fandom-fr` | mediawiki | 100 | 99 | 99 | 1 parse failure; api.php not blocked |
| `fandom-en` | mediawiki | 100 | 99 | 99 | 1 parse failure |
| `kanzenshuu` | crawl | 100 | 97 | 96 | no block (0/100 blocked) |
| `dragonballcn` | crawl | 100 | 5 | 2 | 91 HTTP 403 + 4 HTTP 404; recorded, not worked around |

Store after ingestion: 440 docs, 7141 chunks (144 docs from the 2026-09-25 smoke plus 296 new).

A full crawl is a one-shot, bounded run (`defaults.maxPages` per target per
run). It is not a daemon. To schedule periodic refreshes, register a unit
through `aphrody-infra`; do not start a long-lived process by hand.
