<!-- SPDX-License-Identifier: Apache-2.0 -->

# Running the web smoke and crawling a site

Prerequisites: a built engine (`cargo build -p aphrody-web-engine --bins`) and Bun 1.4.2. See
[automation](../../operations/web/AUTOMATION.md) for configuration and the service unit.

## Smoke

```bash
APHRODY_WEB_BIN=target/web-dev/debug/aphrody-web bun run web:smoke      # or leave it unset to use target/debug
bun scripts/audit/web-smoke.ts --json --out /tmp/web-smoke.json
```

Expected: `web smoke: 11 passed, 0 failed`. A failing check prints its name and reason, for example
a binary built before the `crawl` subcommand: `binary lacks crawl; rebuild with cargo build -p
aphrody-web-engine`.

## Crawl a site

```bash
bun run web:crawl -- https://example.com/ --max-pages 20 --max-depth 2
aphrody-web crawl https://example.com/ --obey-robots --format ndjson --include-links -o /tmp/crawl.ndjson
```

Defaults: seed hosts only, robots honoured, 4 concurrent requests, 300 s deadline. A local dev server
needs `--allow-private-network`. The JSON report is `aphrody-web.crawl/1`; pages have `wordCount`,
`textChars`, `markdownChars`, `links` (with `--include-links`), `html` and `markdown` on request.

## From Bun

```ts
import { WebService } from "@aphrody/agent-browser/service";
const web = new WebService();
const report = await web.crawl(["https://example.com/"], { maxPages: 10 });
const page = await web.session("https://example.com/");
await page.close();
await web.close();
```
