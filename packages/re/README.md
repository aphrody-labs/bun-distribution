# Bun OS RE facade

The canonical REA implementation and Bun OS RE commands live in [vendor/rea](../../vendor/rea/BUN-OS.md), pinned to the aphrody-labs/rea Git submodule. This package retains the `re` executable and `@bun-os/re/pipeline` export without another implementation.

Run `bun scripts/rea.mjs --help` for the toolkit and `bun scripts/rea.mjs replica skills` for the existing Bun Engine workflow. Build the canonical owner with `bun run build`; native type checking uses `bun check -p tsconfig.json --noEmit`.

Provider authentication, private evidence and game assets remain in their isolated stores. WASM recompilation supports the documented console cores, not a Windows PE x64 game engine.
