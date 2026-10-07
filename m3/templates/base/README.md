# **NAME**

Aphrody stack scaffold (`yolo create`): a Bun server on the Rust-based Bun, the YOLO native runtime SDK
(`runtime:system`, `runtime:process`), `bun:sqlite`, SSE and a supervised dev loop.

```bash
bun install
bun run dev                                 # supervised server on http://127.0.0.1:3000
bun test && bun run typecheck && bun run lint
```

The SDK consumes the producer's precompiled library through `$YOLO_RUNTIME_LIB`,
the embedded provider, or its installed artifact. The project preload selects
the producer at `__YOLO__` when no runtime location was specified. A source
checkout can provide `target/runtime/` as a local development fallback.

| Path                   | Role                                                                                   |
| :--------------------- | :------------------------------------------------------------------------------------- |
| `src/app.ts`           | Routes and database (testable, no side effects)                                        |
| `src/server.ts`        | `Bun.serve` entry point (`startServer`)                                                |
| `src/home.ts`          | The `/` route (replaced by the `web` feature)                                          |
| `scripts/supervise.ts` | Dev supervisor on `runtime:process` (own process group, readiness probe, orderly stop) |
| `test/app.test.ts`     | End-to-end tests of the HTTP surface                                                   |
