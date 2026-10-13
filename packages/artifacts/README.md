# Aphrody / Bun artifacts

Build independent applications from the canonical workspace capability catalog.
Each executable contains its pinned Bun runtime, application server and verified
native engine. Native Cargo builds remain with the existing workspace owner.

```sh
bun packages/artifacts/src/cli.ts list --json
bun packages/artifacts/src/cli.ts verify --build-report .local/builds/report.json --app video
```

`buildAppArtifact` requires explicit runtime and native target receipts. Missing
engine owners remain unavailable. Generated launchers support `--version`,
`--doctor` and the server owner's `--native` delegation. No source checkout,
Git or Cargo is required by the produced application.

Native files are extracted into a SHA-256 bundle directory before execution.
Extraction verifies every file, uses exclusive staging and at most two workers,
and supports cancellation. Shared R2 assets are referenced by one immutable
manifest; startup does not download them.

`verifyAppArtifact(report, {appId})` validates the selected successful build,
executable and manifest digests, native receipt and compiled extraction doctor.
Deployment consumes its structured receipt. `execute: false` verifies metadata
only and cannot qualify service activation.

See [artifact contracts](../../docs/artifacts.md). Source licenses and notices
are embedded. Artifact integrity and compilation do not qualify native media,
providers, signing, installers or other host targets.
