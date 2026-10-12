# Aphrody Material

Canonical Material 3 monorepo, independent of Aphrody, Bun and Chromium.

All first-party packages live directly below `packages/*` and are consumed by
the three hosts through this repository as a Git submodule. Host integrations
must remain adapters; Material 3 source does not import host APIs.

## Layout

```text
packages/*  independent M3 packages
scripts/    workspace-level checks
```

## Development

```powershell
bun install
bun run list
bun test
```
