<!-- SPDX-License-Identifier: Apache-2.0 -->
# PLAN — aphrody-compat

## 2026-09-26 — crates.io release set: the `n2b` CLI closure (prepared, not published)

Prepared scope is the eleven-crate non-dev closure of `aphrody-n2b`, including
`aphrody-toolchains`. Historical dry runs passed; no upload is established.
`aphrody-n2b-native` and `aphrody-bun-docs` remain excluded. The unused registry
`match_rules` stub was removed before preparation.

Order: types/AI/GitHub/toolchains → util/registry → reports/rules → scanners →
core → CLI. Use current manifest versions, synchronized N2B packages and the
[publish ladder](../../reference/ai/cargo/PUBLISH-LADDER.md); the closure has no
sibling dependency. AI CLI distribution stays on GitHub Releases.

For a publication task, revalidate packaging and execute the ladder under
[NHITL](../../reference/compat/AGENTS.md), recording actual uploads; no extra maintainer confirmation.
