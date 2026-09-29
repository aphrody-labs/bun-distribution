---
description: Autonomous deep research, crawling and indexing via BXC (no human in the loop)
argument-hint: <goal | url | query>
---
Run autonomously to completion on: $ARGUMENTS

1. `bxc capabilities --json`, then pick matching BXC commands/MCP tools (`bxc <cmd> --help`).
2. Plan sub-queries/seed URLs; fan out parallel `bxc-web-researcher` agents (one per independent sub-topic).
3. Use BXC search/recon/detect/scrape/mirror/crawl with multiple workers and async batching for many URLs; escalate failing targets via `bxc-scrape-debugger`.
4. Persist raw outputs and an index (JSON/JSONL) under `data/research/<slug>/`.
5. Do not ask for confirmation; recover from errors and continue. Finish with a sourced synthesis and the index path.
