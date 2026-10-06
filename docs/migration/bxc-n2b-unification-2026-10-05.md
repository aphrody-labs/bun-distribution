<!-- SPDX-License-Identifier: Apache-2.0 -->
# bxc and n2b: one binary (2026-10-05)

Owner order (2026-10-05, verbatim): « bxc et n2b ont été absorbés par aphrody et réécrits en Rust :
retire la logique multi-binaire et unifie tout en gardant un alias de compatibilité ; bxc c'est Bun x
Chrome et n2b Node 2 Bun ». No licence question applies (multi-licensed monorepo) and every decision
below was taken by the implementing session without asking.

End state: **one binary, `aphrody`**. No code path clones, builds, installs, spawns or forwards to a
separate `bxc` or `n2b` executable. `bxc`, `bxc-mcp` and `n2b` remain as **compatibility names of that
binary**: multicall invocation names (links created by `aphrody self install-path`) and the
subcommands `aphrody bxc ...` and `aphrody n2b ...`. Exit codes and JSON shapes are those of the unified
Rust commands; the names are the only contract that survives.

## Decisions

| Id | Decision | Why |
| --- | --- | --- |
| D1 | `bxc` and `bxc-mcp` are one multicall tool (`crates/infra/aphrody-command/src/multicall.rs`, entry `bxc_compat::entry`); `n2b` stays a multicall alias of the clap command `aphrody n2b` | The tool table already serves every former standalone binary this way; one table, one link installer. |
| D2 | The first argument of `bxc` is mapped through one table (`bxc_compat::PARITY`, reproduced below); a retired subcommand fails with exit 2 and names its replacement | A silent no-op or a guessed mapping would be the discarding filter the repository forbids. |
| D3 | `bxc-mcp` is `aphrody kernel mcp` (the single MCP server, which already aggregates the BXC tool catalog); the legacy `--stdio` flag is dropped | PLAN section 5: one MCP entry point for plugins. |
| D4 | Process-wide options of the former router: `--json` is forwarded to the unified command, `-q/--quiet` is ignored, `-h/--help` and `-V/--version` are answered by the alias; `--insecure/-k`, `--proxy` and `--timeout` are refused with advice | Disabling TLS verification must never be a silent default of an alias; the other two have no process-wide equivalent. |
| D5 | The state directory of the former application (`~/.bxc`) is never written; cookie jars are still read from `~/.bxc/cookies` after the `~/.aphrody` locations (Google search and Gemini web clients) | The owner keeps existing cookies usable without keeping the old layout alive. |
| D6 | `aphrody package` is a thin group over the single binary: `catalog`, `status`, `doctor`, `install` (= `aphrody self install-path`), `uninstall` (dry run first, `--yes` to apply); `update` is retired. No clone, build or managed-sources checkout of `aphrody`, `bxc` or `n2b` | The package matrix existed because there were four products to build; there is one. |
| D7 | `nie`/`niers` (IECODE) stays outside the unification: `aphrody nie` remains an explicit passthrough, listed by `aphrody package status` as an externally managed tool; `codex` and `agy` forwards are third-party and unchanged | IECODE keeps its repository, store and authority. |
| D8 | The legacy executable bridge (`BxcCli`, `WebBrowserClient`, `resolve::binary`, actors, the `bxc_rust_bridge` library resolver) is deleted; its in-process remainder (page fetch with profiles, the shared browser session) is folded into `aphrody-web-service`; the crate `aphrody-web-bridge` is removed | The remainder is exactly the "canonical web execution contract"; keeping a crate named bridge for something that bridges nothing would hide the end state. The FFI symbol `aphrody_web_bridge_abi_version` (ABI 4) is unchanged: it never depended on the crate. |
| D9 | Site-specific scrapers and managed-service commands of `bxc` are retired, not ported (see the table) | They are out of the product (PLAN section 7) or have their own owner. |

## Parity table: `bxc` 0.9.15

`bxc <subcommand>` runs the unified command on the right (`aphrody <command>`); `retired` rows exit 2
with the replacement and the reason shown here. For the subcommands that have second-level words
(`chrome`, `wiki`, `google`, `gemini`, `x`) those words are matched before the bare subcommand.
`docs` is the former spelling of `recon` and `upgrade` of `self-update`.

| Legacy | Unified | Tranché |
| --- | --- | --- |
| `serve` (`--cdp-port N`) | `aphrody web-engine launch --port N` | CDP server of the Obscura engine; `serve --stdio` is `aphrody kernel mcp` |
| `install` | retired, `aphrody self install-path` | no runtime asset to install: the engines are linked |
| `self-update` / `upgrade` | retired, `aphrody self install-path --bin <new build>` | the binary is replaced as a whole |
| `chrome launch` | `aphrody web-engine launch` | same server |
| `chrome snapshot` / `chrome navigate` | `aphrody web browser snapshot <url>` | navigate and read in one session |
| `chrome` (other, `fetch`) | retired, `aphrody web browser snapshot <url>` | no external Chromium is downloaded; `aphrody web-engine chrome-path` resolves an existing one |
| `recon` / `docs` | `aphrody web recon` | |
| `detect` | `aphrody web detect` | |
| `scrape` | `aphrody web scrape` | |
| `extract` | `aphrody web extract` | |
| `wiki search` | `aphrody web wiki-search` | |
| `wiki md` | `aphrody web wiki-page --markdown` | `--api-url` is required (no auto-detection) |
| `wiki page` / `images` / `infobox` / `tables` / (bare) | `aphrody web wiki-page` | the dossier carries sections, infobox, tables and images |
| `search` | `aphrody web search` | |
| `api` | retired, `aphrody kernel mcp` or `aphrody web-engine launch` | no HTTP JSON facade over the Rust engines |
| `cookies` | retired, `aphrody web search --cookies <file>` | credential extraction stays a library capability (`aphrody-web-chromium`), not a CLI command |
| `har` | retired, `aphrody web recon <url> --json` | only the HAR 1.2 data model (`obscura_net::har`) exists; no record or replay command |
| `mirror` | `aphrody web mirror` | |
| `fut` | retired, `aphrody-labs/fut` | the product has its own repository |
| `voiranime` | retired, `aphrody web media resolve <embed-url>` | streaming-site catalogue out of the product |
| `animesama` | retired, `aphrody web media resolve <embed-url>` | same |
| `archive` | retired, `aphrody web fetch <archive.org url>` | site-specific client |
| `dragonball` | retired, `aphrody-labs/shenron` | Shenron product |
| `frames` | `aphrody web frames` | same subcommands (`vector`, `search`, `stats`, `list`, `quota`, `index`) |
| `assets` | retired, `aphrody web fetch <url>` | provider search out of the product |
| `doctor` | `aphrody doctor` | |
| `capabilities` | `aphrody web capabilities` | |
| `mcp` | `aphrody kernel mcp` | single MCP server |
| `google search` | `aphrody web search` | |
| `google translate` | `aphrody translate` | |
| `google dns` / `suggest` / `status` / `doctor` / `models` / ... (bare) | `aphrody google ...` | passthrough to the native Google client |
| `google audit` / `auto-upgrade` / `book(s)` / `calendar` / `chat` / `conversations` / `delete` / `doc` / `download` / `open` / `resume` / `scrape` / `sheet` / `tts` | retired, `aphrody google --help` and the `aphrody_google_*` MCP tools | web-UI clients of Google properties are not part of the unified client |
| `gemini ask` | `aphrody web gemini` | |
| `gemini status` | `aphrody google status` | |
| `gemini` (other) | retired, `aphrody web gemini`, `aphrody google models`, `aphrody antigravity chat` | split between the two Rust clients |
| `aphrody` | retired, `aphrody <command>` | `bxc aphrody x` is `aphrody x` now |
| `service` | retired, `aphrody infra service`, `aphrody infra ssh` | the bxc daemons no longer exist |
| `xcom` | `aphrody x user` | |
| `x` `profile` / `tweets` / `foryou` | `aphrody x user` / `user-tweets` / `home` | spellings differ; every other `x` subcommand is passed through |
| `x rank` / `purge-tweets` | retired, `@aphrody/x` (Bun binding of `aphrody-x`) | scripted, not a CLI command |
| `grok` | retired, `@aphrody/xai` (Bun) | |
| `actor` | retired, `aphrody web crawl` | no Actor runtime in the Rust engine |
| `crawl` | `aphrody web crawl` | `--daemon` is the continuous crawler |
| `crawl-worker` | retired, `aphrody web crawl --daemon --sqlite <db> <seed...>` | the Redis frontier worker is replaced by the SQLite frontier |
| `export` | retired, `aphrody web crawl --json` or `--sqlite <db>` | dataset export follows the crawl store |

`bxc-mcp [args]` is `aphrody kernel mcp [args]`. `bxc --help` prints this table from the code.

## n2b

`n2b` was already in process: `aphrody n2b` (clap command over the crate `aphrody-n2b`) and the multicall
link `n2b`. Changes of this lot: `-h/--help` of `n2b` and of `aphrody google` now reach the wrapped tool
(clap's own help flag is disabled on those two passthrough commands, so `n2b --help` prints N2B's help
instead of the wrapper's); the `aphrody package` catalog no longer builds or installs it separately.

## Single owner of fetch and session (2026-10-06)

`crates/web/web-bridge` is deleted. `aphrody-web-service` owns `fetch` (profiles, itinerary, size cap, shared
HTTP client), `session` (shared in-process browser) and `error`; its consumers (`aphrody-command`,
`aphrody-mcp`, `aphrody-mcp-client`, `aphrody-agent-tools`, `aphrody-tools`) call it directly. `aphrody
search` uses the SERP client of `aphrody-google`; `aphrody web recon|scrape` parse with `obscura-dom`;
`aphrody web browser snapshot` drives the shared session. The `ffi` and `ui/app` crates never depended on
the bridge crate (only a comment names it).
