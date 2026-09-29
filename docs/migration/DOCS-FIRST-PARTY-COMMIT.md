<!-- SPDX-License-Identifier: Apache-2.0 -->

# First-party documentation commit

2026-09-29. Committed the hash-verified documentation targets from source roots
with root LICENSE or NOTICE evidence in
[`source-licenses-import.json`](source-licenses-import.json): `aphrody-ai`,
`aphrody-compat`, `aphrody-contracts`, `aphrody-discord`, `aphrody-infra`,
`aphrody-koharu`, `aphrody-native`, `aphrody-os`, `aphrody-shell`,
`aphrody-web`, `fut`, and `nie`.

The target-side audit compared 1,894 mapped document targets against each
recorded imported SHA-256. It found zero missing files and zero mismatches. One
target was already tracked as source-license evidence, so the commit added 1,893
new documentation files. Source-map entries preserve source provenance and
duplicate aliases.

This commit does not close the full documentation gate. The document index
contains 6,538 entries, the link audit maps 2,272 local links and reports 1,292
unresolved local Markdown links, and documents from other roots still need
license and hash qualification. This audit did not inspect the delegated UI
checkout.

After the Bun documentation commit, a fresh clone of `4eaf8c4` verified the
combined first-party and Bun batches: all 4,169 mapped targets are present and
match their recorded imported SHA-256 values.
