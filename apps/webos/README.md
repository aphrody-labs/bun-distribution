# Aphrody super-site

This app assembles the WebOS desktop, the canonical App UI under `/workspace/`,
the shared M3 theme, workspace catalog and installable Craft/Engine browser
packages. `packages/app-ui` owns the shared interface consumed by this site and
the native `apps/aphrody-app` host. WebOS-WASM owns the browser filesystem and
its RPC adapter; the native Drive transport keeps its own storage and permissions.

From the repository root on the Linux VPS factory:

```sh
bun src/cli.ts superapp craft
bun src/cli.ts superapp build
bun src/cli.ts superapp serve
```

The product build compiles App UI with `--base /workspace/` into `build/app-ui`,
then assembles this site using that artifact. Set `BUN_OS_APP_UI_DIST` to select
a different intermediate directory. Build WebOS-WASM through its native owner
before assembly; the App UI build reports missing WASM inputs explicitly.
Craft compilation uses the root serialized Cargo owner and four compiler jobs.

`build:shell` assembles the site from an already staged App UI artifact.
`superapp deploy` runs the product build before the existing Cloudflare deploy.
