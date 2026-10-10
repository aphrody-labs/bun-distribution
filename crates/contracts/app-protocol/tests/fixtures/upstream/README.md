<!-- SPDX-License-Identifier: Apache-2.0 -->
# Upstream protocol fixtures

These 13 JSON schemas are retained test inputs from OpenAI Codex app-server,
revision `78245b47af2a7aafcabe025828ceecca69db4df1` as recorded by the original
`FIXTURES_REV`. OpenAI Codex is distributed under Apache-2.0; preserve its
upstream attribution when updating the schemas.

The files were restored byte for byte from commit
`96d1453` of the archived `aphrody-contracts` checkout after a cleanup removed
them. The migration restoration report records the full source commit and each
SHA-256. This restoration establishes historical fixture provenance, not
compatibility with the latest Codex protocol.

Keep these fixtures in source control. Updating them requires an explicit
upstream revision and review of protocol compatibility; generated test inputs
are not disposable build output.
