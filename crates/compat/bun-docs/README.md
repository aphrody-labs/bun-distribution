<!-- SPDX-License-Identifier: Apache-2.0 -->
# Offline Bun documentation

`aphrody-bun-docs` indexes upstream Bun Markdown and MDX pages on the first tool
call. It provides `bun_docs_search`, `bun_docs_read`, `bun_docs_list` and the N2B
registry's `bun_node_equivalent`. No network request or generated index is needed.

Corpus resolution, in order:

1. `APHRODY_BUN_DOCS`: an explicit upstream docs directory. An invalid override
   returns an error instead of silently selecting a different corpus.
2. A portable bundle at `<executable-directory>/bun-docs`.
3. An installation bundle at `<installation-prefix>/share/aphrody/bun/docs`
   (for example, `/usr/local/share/aphrody/bun/docs` with a binary in `/usr/local/bin`).
4. The user data bundle at `$XDG_DATA_HOME/aphrody/bun/docs`, with
   `$HOME/.local/share` as the default data directory. On Windows the data
   directory is `%APPDATA%`.
5. An optional `third_party/bun/docs` or consolidated
   `docs/reference/upstream-bun` corpus in an ancestor of the launch directory,
   then an ancestor of the crate's build directory.

Install a complete upstream `docs/` tree, preserving its relative paths. Retain
the upstream license alongside the installed corpus and record its source
revision when packaging a release. The installed locations work from any launch
directory and after removing the original build checkout. Developer sibling
checkouts are used only through `APHRODY_BUN_DOCS` or an explicitly installed
bundle; their paths are never guessed.

The index is cached per subsystem instance. Restart the host after replacing its
corpus. `bun_docs_list` includes the selected root, so callers can verify which
installed version they are consulting.

Validation: `cargo test -p aphrody-bun-docs`, `cargo check -p aphrody-bun-docs
--all-targets`, and `cargo clippy -p aphrody-bun-docs --all-targets -- -D warnings`.
