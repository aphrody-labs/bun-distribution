<!-- SPDX-License-Identifier: Apache-2.0 -->
# Offline Bun documentation

`aphrody-bun-docs` indexes the Markdown and MDX pages of `docs/` in the Bun fork
`aphrody-labs/bun` on the first tool call. It provides `bun_docs_search`, `bun_docs_read`,
`bun_docs_list` and the N2B registry's `bun_node_equivalent`. No network request or generated
index is needed, and there is no private copy of the docs.

Corpus resolution, in order:

1. `APHRODY_BUN_DOCS`: an explicit docs directory. An invalid override returns an error instead
   of silently selecting a different corpus.
2. `docs/` of the fork checkout: `APHRODY_BUN_CHECKOUT`, else `C:/bun` on Windows (used when it
   holds `docs.json`).
3. A portable bundle at `<executable-directory>/bun-docs`.
4. An installation bundle at `<installation-prefix>/share/aphrody/bun/docs`.
5. The user data bundle at `$XDG_DATA_HOME/aphrody/bun/docs` (`$HOME/.local/share` by default;
   `%APPDATA%` on Windows).
6. The monorepo mirror `docs/reference/upstream-bun` (refreshed from the fork by
   `bun run docs:bun:update`) in an ancestor of the launch directory, then of the crate's build
   directory.

The index is cached per subsystem instance. Restart the host after replacing its
corpus. `bun_docs_list` includes the selected root, so callers can verify which
installed version they are consulting.

Validation: `cargo test -p aphrody-bun-docs`, `cargo check -p aphrody-bun-docs
--all-targets`, and `cargo clippy -p aphrody-bun-docs --all-targets -- -D warnings`.
