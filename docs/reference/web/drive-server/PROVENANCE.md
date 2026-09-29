# Drive server provenance

- Imported from `aphrody-ui/drive/apps/server` at Aphrody UI commit
  `c571fce0ffc4fc0a8acc6b6a962a27833dbbbed8`.
- Original project: [spacedriveapp/spacedrive](https://github.com/spacedriveapp/spacedrive).
- `src/main.rs` is copied byte for byte except the `rust-embed` UI path and
  missing-bundle message. Original source SHA-256:
  `8a48776cbc83ea4c908bc5e19f80900366651b7230f2ae95e60b045e49c6bd96`.
- `Cargo.toml` retains the `sd-server` binary, version, features and dependency
  list; the `sd-core` path points to `aphrody-os/drive/core`, and the nested
  workspace mirrors the backend's required crate patches.
- `build.rs` retains the Bun build and UI source watcher with sibling checkout
  paths and an explicit missing-bundle check. The `Cargo.lock` starts from the
  OS Drive migration lock and is resolved for this workspace separately.
- `LICENSE` is copied unchanged from the Drive tree (SHA-256
  `24e941b64ab9f59b5a7ca1bafb27bd25e550d7d9461c5890482443f5b19b50b8`).
- The README, architecture and TrueNAS documents in `upstream/` came from the
  Aphrody UI Drive import. Their old monorepo commands are historical.

The following deployment recipes are archived unchanged from upstream
Spacedrive commit `6dfeccf2113039e35f2ce735f945e70dc3e4ea45`. Their
SHA-256 values identify the exact downloaded bytes:

| Archived file | SHA-256 |
|---|---|
| `upstream/Dockerfile` | `e8665e9fa26491a940aaf89fc24c4231bc95c1cf847f24d0aded662d7df70b29` |
| `upstream/build-for-truenas.sh` | `2ab0a4b5f01ca537b2b62bcb26331539a14d782fc2f974f13f89f6145e42fc72` |
| `upstream/docker-compose.yml` | `bf8f6fb127858fc275ba7151aa5d03b8a489d0492ea3bfbacfd18e720351fb27` |
| `upstream/docker-run.sh` | `f56d1b14e45fb728998ba18b5ce7b1a42664b2e4e88f842913a4e9716f04ca41` |
| `upstream/build-server.sh` | `c96147d590a7d436de23b8e663382dae5a5665eb7557663ce46cc760508ef4bc` |

These recipes have not been adapted or qualified for Aphrody Infra. They are
not an authorization or recommendation to deploy. Preserve their source
notices and the FSL license while migrating.
