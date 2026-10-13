# App build factory

`scripts/build-apps.ts` plans or builds the configured applications. Planning is
the default and starts no native build. App IDs, source pins, protocols, digests,
native build locks and artifact packaging retain their existing owners.

```sh
bun scripts/build-apps.ts plan --target bun-linux-x64
bun scripts/build-apps.ts build --app video --target bun-linux-x64 \
  --bun /qualified/bun --runtime-pin /qualified/runtime-pin.json \
  --host vps --mode ssh --shared-assets .local/assets/reference.json \
  --output .local/apps --report .local/builds/linux-video.json
```

Use the host's qualified Aphrody Bun executable to run the factory. A runtime pin
contains `version`, `repository` and the full `revision`. `--runtime-receipt`
optionally checks its recorded target, binary digest and observed provenance.
The factory probes and hashes the actual host executable. It never downloads an
upstream runtime or changes the checkout's platform-specific runtime pin.

Each selected engine builds in release mode with its existing locked Cargo
workspace. The native build owner serializes admission on that host. The factory
then discovers the release CLI, observes its version, records its source pin and
SHA-256, and builds a standalone Bun executable through the artifact package.
Native extraction is qualified with `--doctor`; business operations retain
separate qualification. No tests run.

All 14 capabilities appear in plans. Generation has no standalone engine CLI
and reports `OWNER_UNAVAILABLE`. Builds continue across application failures;
the report records each stage and exits unsuccessfully if any selected app fails.
Native hosts build their own targets; cross target engine compilation requires
separate native qualification and supplied artifact receipts.

Builds use fresh output files inside the selected checkout. Results default to
`.local/apps/<target>/<app>/aphrody-<app>`, with native and app manifests beside
the binary. `--report` persists progress after every application. Aphrody Infra
owns activation and replacement of previously qualified deployed artifacts.

`--resources JSON` maps app IDs to explicit native DLLs, libraries, resources or
notices. Each input has an absolute `source`, a portable payload `path` and a
`kind` of `library`, `resource` or `notice`. The artifact owner validates and embeds
them. The factory does not scan provider stores or duplicate shared R2 assets.
Builds require one `--shared-assets` reference, applied to every selected app.

Native deadlines default to 30 minutes; Bun compilation defaults to three
minutes. Set bounded seconds with `--native-timeout` and `--compile-timeout`.
Per-app native process output retains the existing owner policies.
