<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-web-extract

Canonical Rust owner for Aphrody Web content processing. The source extractor
from clean Aphrody Web commit `bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83`
is now here: main-content selection, HTML-to-Markdown, structural chunks,
SimHash, dates and canonical URLs. The imported source files and tests are
SHA-256 checked against `docs/migration/source-map.json`; see
`docs/migration/aphrody-web-extract-import.json` for provenance and adaptations.

The earlier target-only `normalize_page_url` and `extract_metadata` APIs remain
available in `url_metadata.rs`. They now use the same Obscura DOM and metadata
collector as the full extractor, so this crate has one HTML parser backend.

`obscura-dom` is a vendored Apache-2.0 backend from the source checkout's
Obscura tree. Its manifest version is `0.1.1` in the target workspace to avoid
a Cargo lockfile collision with the still referenced source checkout's `0.1.0`.
Its upstream license and attribution are in `crates/web/obscura-dom`.

The in-progress `aphrody-tools` `web_fetch` Markdown cutover in the current
AI worktree calls this crate in process. It is not part of this crate's clean
clone until the AI workspace import is committed. Existing BXC FFI exports,
CLI/MCP schemas, and Bun consumers still need cutover and parity checks. The
source gold corpus test is pending fixture migration into the target; see the
import record. This crate's unit and portable integration tests do not
establish browser or full BXC parity.
