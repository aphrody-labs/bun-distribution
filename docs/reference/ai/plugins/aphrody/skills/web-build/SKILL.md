---
name: web-build
description: "Build the Aphrody OS Web API and native Rust bridge without a separate BXC binary."
metadata:
  short-description: Build the integrated Aphrody Web runtime.
---

Build only the requested targets from the `aphrody-web` repository (the web engine
category repository, sibling of `aphrody-os`). For the native Web bridge:

```sh
cd apps/bxc
bun run typecheck
bun run build:native
```

The Web API runs from `shenron:packages/api/src/server/index.ts` and Aphrody OS releases
deploy it as `aphrody-web-api`. Use the Aphrody OS and infra release workflow
for production artifacts. The local CLI shim runs the source entrypoint;
there is no standalone BXC executable or BXC MCP release to build.

Keep Rust and Bun versions aligned with the workspace manifests. Report the
bridge artifact path and run a local API health probe after a successful build.
