# **NAME**

Aphrody stack scaffold (`yolo create`): a Bun server on the Rust-based Bun, the YOLO native runtime SDK
(`runtime:system`, `runtime:process`), `bun:sqlite`, SSE and a supervised dev loop.

```bash
bun install
just -f __YOLO__/justfile runtime-build     # once: builds the light runtime library (no engines)
bun run dev                                 # supervised server on http://127.0.0.1:3000
bun test && bun run typecheck && bun run lint
```

The SDK finds the library through `$YOLO_RUNTIME_LIB`, the installed artifact
(`just runtime-install` in the yolo repository), or, by the project preload `scripts/preload.ts`,
the `target/runtime/` build of the yolo checkout this project was scaffolded from.

| Path                   | Role                                                                                   |
| :--------------------- | :------------------------------------------------------------------------------------- |
| `src/app.ts`           | Routes and database (testable, no side effects)                                        |
| `src/server.ts`        | `Bun.serve` entry point (`startServer`)                                                |
| `src/home.ts`          | The `/` route (replaced by the `web` feature)                                          |
| `scripts/supervise.ts` | Dev supervisor on `runtime:process` (own process group, readiness probe, orderly stop) |
| `test/app.test.ts`     | End-to-end tests of the HTTP surface                                                   |
