# NIE Bun Plugin Audit

Audit date: 2026-09-29
Inspected source: `/home/aphro/src/nie` at `34c55fa1da54f715bb78ac336167fe18b13f9cca`
(`docs: point site integration to workspace architecture`, 2026-09-26).

This is a source audit of the tracked files at that revision. It does not claim
that an executable was run or that ignored game data was available.

## Scope and exact location

The current plugin is the private Bun workspace package
`/home/aphro/src/nie/packages/nie-plugin`. Its tracked files are:

```text
README.md
package.json
tsconfig.json
src/happydom.ts
src/index.ts
src/plugin.test.ts
src/register.ts
```

The root `package.json` lists `packages/nie-plugin` as a workspace member and
`bun.lock` contains `@nie/plugin@workspace:packages/nie-plugin`. No
`plugins/nie` directory exists in this checkout. The discovered agent-plugin
manifests belong to `.agents/skills/*`, not to this package.

## Manifest, exports, and scripts

`package.json` declares the private, unpublished ESM package `@nie/plugin`,
version `1.0.0`. It has these exports:

| Export | Target | Role |
| --- | --- | --- |
| `@nie/plugin` | `src/index.ts` | Programmatic API: re-exports the native binding plus two data readers. |
| `@nie/plugin/register` | `src/register.ts` | Bun plugin registration and bundler plugin export. |
| `@nie/plugin/happydom` | `src/happydom.ts` | Test DOM-global registration. |

Its package scripts are `bun test src/` and `bunx tsc --noEmit`. The package
extends `../../tsconfig.base.json` and includes `src`.

Runtime dependencies are `@aphrody/nie` (`workspace:*`) and
`@happy-dom/global-registrator` (the root Bun catalog). Development dependencies
are `@types/bun` and `typescript` from that catalog. No direct MCP dependency is
declared.

## Registration and execution architecture

Root `bunfig.toml` preloads `packages/nie-plugin/src/register.ts` for `bun run`
and both `register.ts` and `happydom.ts` for `bun test`. The nie-web application
also configures those two preloads in `apps/nie-web/bunfig.toml`; its test script
passes both explicitly as well.

`register.ts` immediately calls `Bun.plugin` with the name
`nie-game-formats`. Its `onLoad` handlers read a file with `Bun.file` and:

- convert `.g4tx` to PNG bytes through `@aphrody/nie.decodeToPng`;
- decode `.cfg.bin`, `.objbin`, `.g4pkm`, `.lip`, `.p3lip`, `.mev`, `.mevbin`,
  and `.g4md` to a JSON object through `@aphrody/nie.decode`;
- resolve `nie:re/*` to a `nie-re` namespace, then load JSON from `data/re` or
  raw bytes from `data/lua_scripts` when the specifier begins with `lua/`.

The default export is the same `BunPlugin` object, for explicit use in
`Bun.build({ plugins: [...] })`.

The native import is lazy: `register.ts` imports `@aphrody/nie` only when a
game-format loader runs. `@aphrody/nie` opens its `iecode` shared library only
on its first native call. The binding searches `NIE_FFI_PATH`, then the relevant
`target/{debug,release}` and target-triple profile locations. Consequently,
registration alone does not require the library; decoding a game format without
it raises the binding's `NativeLibraryError`.

`index.ts` re-exports the binding's decoding, VFS, random, CRC, native-library,
and type APIs. It additionally exposes `loadRe(name)` and `loadLuaScript(name)`,
which read `${NIE_ROOT}/data/re/<name>.json` and
`${NIE_ROOT}/data/lua_scripts/<name>` respectively. Without `NIE_ROOT`, both
modules derive the NIE checkout root from their own directory.

`happydom.ts` registers happy-dom globals, then restores Bun-native `fetch`,
`Headers`, `Request`, `Response`, `AbortController`, and `AbortSignal`. It
exports the restoration function for tests that register happy-dom again.

## API and entry points

| Entry point | Consumer boundary | Observable contract |
| --- | --- | --- |
| Root and test Bun preloads | Every configured Bun command/test | Global game-format loaders; test DOM globals. |
| `@nie/plugin/register` default export | A Bun bundler caller | The `nie-game-formats` `BunPlugin`. |
| `@nie/plugin` | TypeScript caller | Re-exported `@aphrody/nie` API plus `loadRe`, `loadLuaScript`, and `RE_PATHS`. |
| `nie:re/<name>` / `nie:re/lua/<name>` | Bundler only | JSON RE artefact or raw Lua-script bytes from the configured NIE data root. |

The package itself is not an MCP server and does not register MCP tools. The
separate Rust package `/home/aphro/src/nie/crates/tools/nie-mcp` is the
`nie-mcp` stdio binary. Its application dependency is `nie-cli` (alongside
`anyhow`), and its `main` calls `nie_cli::main_entry_with(["nie", "mcp"])`. NIE's `.mcp.json`
instead declares the external `aphrody-mcp` stdio command. The source documents
the product boundary as Aphrody UI reaching game capabilities through `nie.*`
tools of Aphrody AI's `aphrody-mcp`; that MCP relationship is not implemented
by `@nie/plugin`.

## Tests

`src/plugin.test.ts` contains four unconditional tests:

1. the main module exports `loadRe` and `nativeAvailable`;
2. importing `register.ts` twice is idempotent through module caching;
3. the default export has name `nie-game-formats` and a `setup` function;
4. with `NIE_FFI_PATH` set to a nonexistent path, registration succeeds and a
   `.cfg.bin` import fails with `NativeLibraryError` containing the FFI build
   hint.

One additional test runs only when `nativeAvailable()` is true. It imports a
synthetic unknown-magic `.cfg.bin` and asserts that the loader reached the Rust
decoder and reported its rejection. Tests create and remove a process-specific
temporary directory; they do not require a tracked game file.

## Data and non-migrable material

The plugin has no game data in its tracked package. `data/re` and
`data/lua_scripts` are runtime input locations and are ignored by NIE's
`.gitignore`; their contents must not be copied into IECODE or Aphrody. The
plugin's game-format extensions and raw Lua/RE readers are coupled to IEVR
formats and data layout. Native decode behavior comes from the `nie-ffi` Rust
library exposed as `@aphrody/nie`; it is not implemented by the plugin itself.

## Classification for the existing consolidation plan

The classification below applies the ownership rules in
[`nie/PLAN.md`](../../../plans/nie/PLAN.md), which assigns `packages/nie-plugin`
to the Aphrody MCP/plugin owner while retaining IEVR adapters, schemas, and
fixtures in IECODE.

| Surface | Classification | Rationale from inspected source |
| --- | --- | --- |
| Bun plugin registration API, preload wiring pattern, bundler integration, and test-environment bootstrap | Aphrody MCP/plugin owner | These mechanisms are generic host/plugin infrastructure and contain no required game asset or format definition. |
| happy-dom registration and restoration of Bun network primitives | Aphrody UI/plugin owner | This is a generic Bun UI-test runtime concern; the source contains no IEVR format or asset access. |
| Lazy native-library loading/error boundary | Aphrody plugin owner, with an IECODE-provided IEVR process/IPC contract | The lazy-loading policy is generic, while the current library name, target layout, and decoder API are IEVR binding details. |
| `.g4tx`, `.cfg.bin`, `.objbin`, `.g4pkm`, `.lip`, `.p3lip`, `.mev`, `.mevbin`, and `.g4md` loaders | IECODE IEVR adapter | The extension list delegates directly to IEVR native decoding and must follow the IEVR format library/API. |
| `nie:re/*` namespace, `data/re`, `data/lua_scripts`, `NIE_ROOT`, and game-format/Lua fixtures | IECODE IEVR adapter and local fixtures | These are NIE checkout and game-data conventions; ignored data remains outside all destination repositories. |
| Current `@aphrody/nie` re-exports | IECODE IEVR TypeScript binding | They expose the IEVR FFI/VFS/format surface and should be consumed through the migration's stable library or process boundary, not copied into Aphrody. |
| `nie-mcp` tool transport and policy | Aphrody MCP/plugin owner | It is a separate Rust MCP surface identified by the plan; Aphrody invokes IECODE's IEVR command/service rather than linking game code into its host. |

Before extraction, split the registration mechanism from every IEVR-specific
filter, path, export, fixture, and native call. Preserve the conditional native
decoder test with the IECODE adapter, and add host-level tests for the extracted
generic plugin runtime. Do not transfer ignored `data/` contents, game assets,
or a sibling path dependency to the Aphrody owner.
