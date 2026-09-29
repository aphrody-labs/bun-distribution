# Google stack packaging contract

`aphrody-infra/config/google-stack-release.json` is the single release
manifest for Google/Gemini integration across the repositories that own it
(`aphrody-ai`, `aphrody-web` and this repository).

Ownership is deliberately one-way:

- `aphrody-google` (Rust, in `aphrody-ai`) owns runtime resolution, provider
  routing and the public CLI contract (`status`, `env`, `doctor`).
- `@aphrody/google` (Bun, `aphrody-ai/packages/google`) delegates to that
  binary and owns no second Google runtime or credential store.
- `aphrody.google` (uv/Python, `aphrody-ai/py`) exposes typed Python clients
  and delegates provider auth to ADC/Secret Manager; it owns no project or key
  material.
- `aphrody-web` owns the BXC Google/Gemini web implementation
  (`apps/bxc/src/google`), reached through the kernel and never linked into the
  AI layer.
- `aphrody-os` owns kernel/MCP and desktop integration, not Google business
  logic.
- `aphrody-infra` owns manifests, installation, update, rollback and probes,
  not provider implementation.

## Install/update

```powershell
pwsh -File scripts/install-google-stack.ps1
pwsh -File scripts/update-google-stack.ps1
```

Both default to the sibling checkouts `../aphrody-ai` and `../aphrody-web`
(`-AphrodyRoot`, `-AphrodyWebRoot`; the former `-AphrodyOsRoot` name is kept as
an alias). The installer builds the canonical Rust facade in `aphrody-ai`,
installs it atomically under `$APHRODY_HOME/bin`, creates the compatibility
`google` alias, sets only non-secret runtime variables and runs
`aphrody-google doctor`.

Updates fetch `origin/main`, refuse tracked changes, rebuild and replace the
binary only after the build succeeds. Credentials, cookies, `.env` files and
API keys are never packaged or synchronized.

## Production gates

```powershell
bun run google:verify
# equivalent to
pwsh -File scripts/verify-google-pipeline.ps1 -AphrodyRoot ..\aphrody-ai -WebRoot ..\aphrody-web
```

The VPS deploy remains the immutable-release workflow in `docs/IMMUTABLE-RELEASES.md`;
the current release is not mutated in place.
