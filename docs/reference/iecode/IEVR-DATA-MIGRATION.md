# IEVR data crate extraction

2026-09-29. Source: `aphrody-code/nie` at `94d88bc3993e7dabddf44ce9804d5b41ee5d4c4c`,
`crates/engine/nie-data`. Destination: `crates/ievr-data` in IECODE. All 254
Git-tracked source files moved; before formatting, 252 were byte-identical,
while the package manifest and one opt-in real-fixture test were adapted.
The destination then received the IECODE rustfmt policy, so the final source
diff also contains mechanical formatting. No source copy remains
at the NIE path. The source commit remains the rollback reference.

The package is `iecode-ievr-data`; its library keeps the `nie_data` import name
for existing Rust consumers. NIE's workspace dependency uses the package alias
`nie-data` and points to IECODE. Its only external dependencies inherit
IECODE's `serde` and `serde_json` workspace versions, which match NIE's
declared major versions; no fork-wide GPU or UI dependency was changed by this
leaf extraction. The IECODE and NIE lockfiles are separate until the broader
Aphrody monorepo cutover.

This game-domain code remains private and `publish = false`. The source NIE
repository uses a commercial license boundary; the move does not grant an
Apache-2.0, MIT, GPL or crates.io redistribution right. Game dumps and generated
formations/skill tables were not copied. A release must review the exact
source-rights and fixture permissions before including this crate.

Measured gates: `cargo check -p iecode-ievr-data --locked --offline`,
`cargo test -p iecode-ievr-data --lib --locked --offline` (98 passed),
`cargo test --workspace --locked --offline` (1,516 passed, 1 ignored across
129 suites; real-data cases may return early when their corpus is absent) and
`cargo clippy -p iecode-ievr-data --all-targets --locked --offline --
-D warnings` pass. NIE `cargo metadata --locked --offline` resolves the new
path. `cargo check -p nie-ocgen --locked --offline` passes as a real NIE
consumer. `cargo check -p nie-core --locked --offline` reaches the new crate but
still fails on three absent game-derived JSON inputs:
`formations-full.json`, `skills-cutin.json` and `skills-cutin-served.json`.
These files must be recovered from an authorized source, not fabricated.

Next extraction order follows `nie/PLAN.md`: formats, VFS/save, rules/Lua,
runtime, forge, and FFI/Wasm. Each step must move source, redirect consumers,
retain exact provenance, and pass its own gates before the old path is removed.
The new Aphrody monorepo and its Infra workspace own generic capabilities and
orchestration once their source migration is qualified; IECODE owns IEVR rules.
