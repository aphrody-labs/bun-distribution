# Single-file executable

`bun-engine compile` bundles the TypeScript CLI, the Bun runtime, the web application and the public workspace configuration into one executable.

```powershell
bun run compile
bun run ./packages/bun-engine/src/cli.ts compile bun-windows-x64 build/bin/bun-engine.exe
```

The optional arguments are the Bun target, output path and bytecode-order profile:

```powershell
bun run ./packages/bun-engine/src/cli.ts compile bun-linux-arm64 build/bin/bun-engine-linux-arm64 startup.order
```

Several profiles can be passed through the programmatic API in priority order. Profiles are syntax-hash based, reusable after unchanged functions move, and portable across compilation targets; they change layout only, not behavior or reproducibility.

Supported targets are Windows, Linux glibc, Linux musl and macOS on x64 or ARM64. Builds use bytecode, minification, linked source maps and deterministic runtime configuration: `.env`, `bunfig.toml`, `package.json` and `tsconfig.json` are not loaded by the generated executable.

Record a profile with the executable, then pass it to the next build:

```powershell
$env:BUN_BYTECODE_ORDER_OUT = "startup.order"
build/bin/bun-engine.exe probe
bun run ./packages/bun-engine/src/cli.ts compile bun-windows-x64 build/bin/bun-engine.exe startup.order
```

Use a `%p` placeholder in `BUN_BYTECODE_ORDER_OUT` to collect one profile per process, including workers. `bytecodeOrderStats()` from `bun:jsc` reports covered (`hot`) and missed (`cold`) functions so stale profiles can be replaced.

The embedded `web/app` and `config` trees remain available to the `web` command without an external installation.
