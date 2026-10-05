<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Web live audit qualification — 2026-10-02

`scripts/audit/live-audit.ts` now calls the installed `aphrody-web crawl` binary with
bounded depth and request counts, and consumes its `aphrody-web.crawl/1` JSON
report with captured HTML. It uses the monorepo `@aphrody/web-test` `TestPage`
for browser page checks. The retired BXC checkout and BXC SQLite database are
no longer runtime dependencies. Sites and routes marked `retired` in their
catalogs are excluded. `--skip-crawl` reads a native report no older than 24
hours from `~/.local/state/aphrody/live-audit/` (or `XDG_STATE_HOME`), written
with mode `0600`.

Qualification on this WSL host: a local two-page HTTP fixture was crawled with
the installed native binary using `--include-html --include-links --format json`;
both pages returned status 200 and HTML under the expected schema. The report
parser test passed, as did scoped TypeScript, Oxfmt, Oxlint and diff checks. An
invalid `--site` request exited before network access. A production crawl and
the Obscura CDP page checks were not run; their availability and live site
results remain open deployment gates.
