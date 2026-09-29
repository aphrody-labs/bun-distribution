# Aphrody Web Browser

[aphrody-web repository](https://github.com/aphrody-code/aphrody-web) · [License](LICENSE)

Aphrody Web Browser is a Bun-native browser automation, crawling, search, and extraction
toolkit backed by a Rust FFI bridge. One CLI provides static HTML processing,
browser/CDP workflows, Google and Gemini integrations, X/Grok clients, anime
sources, frame indexing, media discovery, local APIs, and an MCP server.

The Bun package is the library entry point. The `aphrody web` CLI and the
single Aphrody MCP server expose the same Web engine to other clients.
Inspect the available capabilities before selecting an equivalent external tool:

```bash
aphrody web capabilities --json
aphrody web <command> --help
```

## Actor library

```ts
import { listActors, runActor } from "@aphrody/bxc/actors";

const names = listActors().map((actor) => actor.name);
const run = await runActor({
  actor: "fut-accelerate",
  input: { heightCm: 190, acceleration: 75, agility: 60, strength: 85 },
});
console.log(names, run.output);
```

`listActors()` discovers the bundled `actor.json` manifests and directories in
`APHRODY_WEB_ACTOR_PATH`. `runActor()` returns `{ actor, storageDir, output? }`
and rejects when an actor exits with an error. The actor runs in its own Bun
process; calling the API does not start another CLI process. For programs that
consume JSON over standard streams, use `aphrody web actor list --json` and
`aphrody web actor run <name> --input-file <path> --json`. The file is read by
the runner and its contents are never placed in a subprocess argument. The
caller owns removal of the input file after the run.

The source package includes `fut-accelerate`, `grok-x-research`, and
`x-search`. Directory Actors remain available from the source package or
`APHRODY_WEB_ACTOR_PATH`.

## Authenticated remote crawls

When the Aphrody site and local BXC service are configured, the site forwards
`POST /api/v1/web/crawl` to BXC. Send a JSON body such as:

```json
{"urls":["https://example.org/news"],"maxDepth":2,"maxRequests":25,"maxConcurrency":4,"profile":"static"}
```

The request requires the site's BXC bearer token and returns HTTP 202 with a
`job.id`. Poll `GET /api/v1/web/crawl/stats?jobId=<id>` for `running`,
`completed`, `partial`, `limit_reached`, or `failed` and queue statistics.
Job status is held in the BXC server process and is lost on restart. Crawled
pages remain in the configured BXC index. The API allows at most 10 HTTP(S)
seed URLs, 5 levels of depth, 250 processed requests, and 8 concurrent workers.
Omitted `allowedDomains` defaults to the seed hostnames; supplied domains must
contain every seed. One remote crawl job runs at a time.

Remote crawls are headless. The local `aphrody-kernel window_open` contract can
open a desktop preview, but it does not perform crawling or remote interaction.

## Native dependencies

The Web engine lives in the Aphrody OS workspace. Install optional native
browser dependencies from that checkout when advanced profiles need them:

```bash
bun apps/bxc/src/cli/index.ts install --full
```

The integrated `aphrody web install --full` command performs the same setup.
The `@aphrody/bxc` package remains a library; it does not distribute a
separate BXC executable.

## Start here

```bash
aphrody web --version
aphrody web doctor
aphrody web capabilities

aphrody web recon https://example.com
aphrody web scrape https://example.com "main" --markdown
aphrody web search "rust async" --json
aphrody web mirror https://example.com ./mirror --recursive --max-pages 50
aphrody web crawl --massive --sqlite ./web.sqlite https://news.ycombinator.com
aphrody web export default --to sqlite --out ./dataset.sqlite
aphrody web extract https://example.com --schema
aphrody web revalidate https://example.com
aphrody web fut player "Kylian Mbappé"
aphrody web fut price "Vini Jr."
aphrody web dragonball --shenron
```

`aphrody web doctor` checks the Rust bridge, media tools, cookie files, and asset
providers. Use `--json` for automation where supported.

## Runtime profiles

The canonical default is the native, in-process `static` path. The Aphrody
MCP/kernel browser surface uses Obscura as its native browser engine; Aphrody Web Browser does
not start a second browser unless a caller explicitly selects another profile.
Optional runtimes are installed/activated through `aphrody web install --full`
or by passing `--profile` / `profile` explicitly.

Native HTTP is exposed by the shared `aphrody-web-ffi` cdylib through
`obscura-net`: plain requests use reqwest, and the opt-in Cargo feature
`aphrody-web-ffi/native-stealth` uses Obscura's Rust `wreq` Chrome emulation.
The default Windows build does not enable that feature because its BoringSSL
toolchain is platform-sensitive; this keeps the base bridge portable.

| Profile | Engine | Best for |
| --- | --- | --- |
| `static` | Rust DOM with TypeScript & curl-impersonate fallback | Fast HTML parsing with proxy & TLS resilience |
| `http` | curl-impersonate FFI | Browser-like TLS and HTTP-only extraction |
| `fast` | Lightpanda | Lightweight JavaScript navigation |
| `stealth` | Browser compatibility pipeline | Sites requiring full browser behavior and stealth patches |
| `max` | Automatic escalation | Selecting the first transport that succeeds |

Native components load lazily. Commands that do not need them remain usable
when an optional runtime is absent.

## Capability map

`aphrody web capabilities --json` is the machine-readable inventory and currently
covers four surfaces:

- CLI commands across 37 subcommands including `crawl`, `export`, `extract`, `revalidate`, `dragonball`,
  `fut`, `recon`, `scrape`, `mirror`, `search`, `google`, `gemini`, `x`, `grok`, `voiranime`, `animesama`,
  `frames`, `assets`, `actor`, `api`, `serve`, `worker`, and `mcp`;
- MCP tools covering browser automation (`browser_*`), continuous crawl (`bxc_crawl_massive`),
  dataset export (`bxc_export_dataset`), structured extraction (`bxc_extract_schema`), semantic & RRF hybrid search
  (`bxc_index_search`, `bxc_semantic_search`), Dragon Ball Shenron canon (`bxc_dragonball_shenron`), FUT market intelligence
  (`bxc_fut_player`, `bxc_fut_price`), Google & Gemini bridges (`bxc_google_*`, `bxc_gemini_*`), and X/Grok integration
  (`bxc_x_*`, `bxc_grok_*`);
- local, serverless, and reserved public API routes;
- the `@aphrody/*` packages integrated by this repository.

The test suite compares this inventory with the CLI router and MCP tool
registrations so capability drift fails verification.

## MCP for Codex and Claude

The single Aphrody MCP server projects Aphrody Web Browser tools under
`aphrody_*` names. `aphrody_actor_list` discovers the bundled Actors and
`aphrody_actor_run` executes them. The internal backend names beginning with
`bxc_` remain compatibility identifiers. MCP uses stdout exclusively for
JSON-RPC; diagnostics are written to stderr.

## Canonical profiles

The public profile names are three stable facades over the existing engines:

- `curl`: fast HTTP/TLS and parsing through curl-impersonate.
- `wget`: recursive mirroring with concurrent HTML/CSS/JS/image/font downloads,
  link rewriting and `manifest.json` indexing (`aphrody web mirror`).
- `browser`: native Obscura DOM first; use `render`, `fast`, `stealth` or `max`
  when JavaScript execution, CDP or escalation is required.

```sh
aphrody web mirror https://example.com ./mirror --profile wget --recursive \
  --discover-hidden --resolve-cdns true --concurrency 32
```

These are aliases, not additional runtimes. Existing `http`, `static`, `render`,
`fast`, `stealth` and `max` profiles remain compatible.

The complete native transport contract and cross-platform deployment matrix are
documented in [`docs/CURL-IMPERSONATE.md`](../../../../reference/web/apps/bxc/docs/CURL-IMPERSONATE.md).

## Library API

```ts
import { Browser } from "@aphrody/bxc";

const page = await Browser.newPage({ profile: "static" });
await page.goto("https://example.com");

console.log(await page.title());
console.log(await page.markdown());

await page.close();
```

Public exports include browser/page primitives, detection, Google helpers,
media utilities, framework adapters, the SDK client, and explicit Rust and
curl-impersonate FFI bindings. See the package `exports` map and
[`docs/web/INDEX.md`](../../../../reference/web/web/INDEX.md) for the complete reference.

## Packages

| Package | Version | Purpose |
| --- | --- | --- |
| [`@aphrody/bxc`](https://www.npmjs.com/package/@aphrody/bxc) | `0.9.15` | Aphrody Web Browser library and compatibility package specifier |
| [`@aphrody/fut`](https://www.npmjs.com/package/@aphrody/fut) | `1.0.0` | EA Sports FC / FUT player database, live market prices, SBC solver, and squad builder |
| [`@aphrody/x`](https://www.npmjs.com/package/@aphrody/x) | `1.2.5` | Headless cookie-authenticated X client, local "For You" algorithm, and GraphQL / REST sync |
| [`@aphrody/bxc-test`](https://www.npmjs.com/package/@aphrody/bxc-test) | `0.2.6` | Playwright-compatible test runner, Next.js `instant()` navigation, and site testing presets backed by native CDP |
| [`@aphrody/frames`](https://www.npmjs.com/package/@aphrody/frames) | `0.2.1` | Video frame indexing and MPEG-7 ColorLayout vector search |
| [`@aphrody/voiranime`](https://www.npmjs.com/package/@aphrody/voiranime) | `0.2.1` | VoirAnime streaming catalog and video source resolution |
| [`@aphrody/animesama`](https://www.npmjs.com/package/@aphrody/animesama) | `0.2.1` | Anime-Sama catalog and episode extraction |

## Development

Requirements: Bun, Git, and Rust for native builds.

```bash
# The native bridge links sibling crates, so clone the siblings next to aphrody-web.
git clone https://github.com/aphrody-code/aphrody-web.git
git clone https://github.com/aphrody-code/aphrody-contracts.git
git clone https://github.com/aphrody-code/aphrody-os.git
git clone https://github.com/aphrody-code/aphrody-compat.git
cd aphrody-web
bun install --frozen-lockfile
cd apps/bxc
bun run verify
bun run build:native
```

`bun run verify` performs TypeScript checking, warning-free linting, scoped
tests, and `aphrody web doctor`. Do not run bare `bun test`: vendored and third-party
trees are intentionally outside the core test scope.

The OS release builds the Web API and native bridge as part of Aphrody OS.

## Configuration and data

Configuration resolves from `BXC_*` environment variables, then user config,
then platform defaults. Common overrides include `BXC_DIR`, `BXC_CONFIG_DIR`,
`BXC_VENDOR_DIR`, `BXC_BIN_DIR`, `BXC_PROXY`, `BXC_TIMEOUT_MS`,
`BXC_RUST_BRIDGE_LIB`, `LIBCURL_IMPERSONATE_PATH`, and
`BXC_LIGHTPANDA_PATH`.

Cookies, credentials, HAR files, crawl output, caches, and machine paths are
runtime data and must not be committed. Release bundles do not include them.

## Deployment boundary

The local CLI, CDP server, APIs, and stdio MCP server are development/runtime
interfaces and must not be exposed directly to the internet.

The only public gateway is `aphrody-site`. It serves allowed Web routes under
`https://aphrody.com/api/v1/web/*` and the shared MCP endpoint at
`https://aphrody.com/mcp`. The browser engine has no dedicated public site.

## Documentation

- [Documentation index](../../../../reference/web/web/INDEX.md)
- [Native installation](../../../../guides/web/web/NATIVE-INSTALL.md)
- [Package manager contract](../../../../reference/web/web/PACKAGE-MANAGER.md)
- [Contributing](../../../../guides/web/apps/bxc/CONTRIBUTING.md)
- [Security policy](../../../../research/web/apps/bxc/SECURITY.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
