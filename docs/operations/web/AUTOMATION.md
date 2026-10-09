<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Web: automation, configuration and services

Owner: `crates/web`, `packages/web/agent-browser`. Contract:
[`docs/apis/web/WEB-SERVICE-CONTRACT.md`](../../apis/web/WEB-SERVICE-CONTRACT.md).
Architecture and gaps: [`docs/architecture/web/ARCHITECTURE.md`](../../architecture/web/ARCHITECTURE.md).

## Commands

| Command                                      | What it does                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run web:verify`                         | Stages `config`, `bun`, `build`, `smoke`: config contract, typecheck/lint/test of `@aphrody/agent-browser` and `@aphrody/web-test`, engine build, loopback smoke. Each failing step prints its command and the tail of its output. |
| `bun run web:verify:rust`                    | The same plus `cargo check --all-targets`, `cargo clippy -D warnings` and `cargo test` over the 21 web crates (long; do not run while other builds hold the target lock). |
| `bun run web:smoke`                          | Starts `aphrody-web launch` on an ephemeral port, serves a local fixture site and checks version, subcommands, fetch (Markdown, artifact, V8 script execution), crawl with robots, CDP discovery, DOM, accessibility refs, click/fill, screenshot, PDF and clean shutdown. 11 checks, about 1 s. |
| `bun run web:crawl -- <seed>... [options]`   | Native crawl through `WebService.crawl` with the defaults of `tools/config/web.json`.                                                                       |
| `bun run web:crawlability`                   | UI crawlability gate (see [crawlable UI guide](../../guides/web/CRAWLABLE-UI.md)).                                                                    |
| `bun run desktop:apps:check`                   | Registry of every Tauri project, including the `aphrody-tauri-wrap` debug bridge and the pinned debugger forks.                                                    |

`--stage a,b` limits `web:verify`; `--json` and `--out FILE` write a machine-readable report
(`aphrody-web.verify/1`, `aphrody-web.smoke/1`).

Use a freshly built engine: `cargo build -p aphrody-web-engine --bins`. The Bun client picks the
most recently built of `target/debug`, `target/release` (not in repo) (generated or machine-local artifact; presence depends on the build host) and `~/.local/bin`, or `APHRODY_WEB_BIN`.
A binary without the `crawl` subcommand fails the smoke with the rebuild command.

## Configuration

One file, [`tools/config/web.json`](../../../tools/config/web.json), read by
`@aphrody/agent-browser/config` (`loadWebConfig`). Precedence: defaults, file, environment
(`APHRODY_WEB_PORT`, `OBSCURA_ALLOW_PRIVATE_NETWORK`, `APHRODY_WEB_BIN`, endpoint variables),
explicit options. `validateWebConfig` is part of `web:verify` and rejects: a non-loopback engine
host, `allowPrivateNetwork`/`allowFileAccess` true in the shared file, unbounded crawl limits,
schemes other than `http`/`https`, and any secret-looking string value.

Secrets, cookies and Chromium profiles are never stored here. `OBSCURA_CDP_TOKEN`,
`OBSCURA_MCP_TOKEN` and proxies belong in `~/.config/aphrody/web.env` (read by the unit through
`EnvironmentFile=`) or the existing protected stores listed in
[`tools/config/secrets-contract.json`](../../../tools/config/secrets-contract.json).

## Service unit

The `aphrody-web.service` entry of the yolo unit catalog (`packages/engine/core/src/units/catalog.json`) is a
template for a resident loopback CDP engine on `127.0.0.1:9222` (clients attach with
`APHRODY_BROWSER_CDP_URL=ws://127.0.0.1:9222/devtools/browser`). It was checked with
`systemd-analyze verify` only; it is not installed or started by this repository. To install it:

```bash
bun ~/src/aphrody/packages/engine/core/src/units/cli.ts render --out ~/.config/systemd/user aphrody-web.service
systemctl --user daemon-reload
systemctl --user enable --now aphrody-web.service
```

The engine is also fine as a per-run child (`withEngine`, `ensureTestEngine`); a resident daemon is
only warranted for long-lived agents that share one browser.

## Pipeline

`tools/config/pipeline.json` is generated from the package manifests by
`yolo ops pipeline-catalog --root . [--apply]`. The web stage
(`bun-web`) now includes `lint`, `typecheck` and `test` of `@aphrody/agent-browser` (a `lint` script
was added) next to `@aphrody/web-test` and `@aphrody/x`. Rust gates stay in the `rust-foundation`
stage; the web-only Rust gate is `web:verify:rust`.

## Tests: deterministic versus external

- Default gates run only loopback fixtures (`127.0.0.1` ephemeral ports) with
  `OBSCURA_ALLOW_PRIVATE_NETWORK=1` scoped to the child engine.
- Tests that need the public network or external services must be marked ignored (Rust
  `#[ignore = "network"]`) or gated by an explicit environment variable; none of the new tests
  reaches the network.
- `bun test` does not run `process.on("exit")`: engines are owned by
  `@aphrody/agent-browser/engine`, stopped by the `[test] preload` hook
  (`@aphrody/agent-browser/test-preload`) and by `afterAll`, with a 2 s grace so a slow shutdown ends
  in `SIGKILL` instead of a failed hook.
