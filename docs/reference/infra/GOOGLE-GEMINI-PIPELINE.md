# Pipeline Google/Gemini Aphrody

> **Historical pipeline manifest.** `tools/config/google-gemini-pipeline.json` still
> describes the former split repositories and contains retired owner paths.
> For current source roots, release artifacts and host-local install policy,
> use [`google-stack-release.json`](../../../tools/config/google-stack-release.json)
> and [`GOOGLE-STACK-PACKAGING.md`](GOOGLE-STACK-PACKAGING.md).

The current implementation is organized in the monorepo and the sibling
`aphrody-py` workspace:

- Rust CLI: `crates/google/google` (`aphrody-google`), the runtime authority.
- Bun facade: `packages/google/google` (`@aphrody/google`).
- Vertex document AI adapter: `packages/ai/doc-ai` (`@aphrody/doc-ai`).
- Python facade: `../aphrody-py/packages/ai/py/aphrody` (`aphrody.google`).
- Kernel/MCP integrations: `crates/os` and the kernel package owners.

The Rust installer deploys only the native `aphrody-google` CLI under
`$APHRODY_HOME/bin`; Bun and Python remain workspace packages. Credentials
remain local to each host and are not packaged or synchronized.

## Current verification command

```powershell
bun scripts/audit/verify-google-pipeline.ts [--static-only]
```

The verifier checks current Rust, Bun, doc-ai and Python owner paths, package
metadata, source key literals and the shared uv pin. Full mode also runs the
Rust, Bun, doc-ai and Python gates. The current blocker is a toolchain pin
mismatch: `tools/config/system-packages.json` requires uv `0.12.21`, while
`aphrody-py/pyproject.toml` pins `0.12.17`. No full pipeline test run is
claimed until these manifests are aligned and the verifier completes.

The old manifest's BXC cookie routing, split-repository ownership and
`crates/google/antigravity` references are retained only as
historical design context. They are not evidence that those providers or
paths are current runtime capabilities.
