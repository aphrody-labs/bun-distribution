<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@nie/plugin` compatibility package

This private package stages IECODE's Bun game-format loaders and
`nie:re/*` reader. It still depends on the older `@aphrody/nie` `nie_*` native
ABI, while the current IECODE Rust FFI exposes a different `iecode.ffi/v1`
contract. The loaders therefore are not enabled by the Aphrody root workspace
and do not claim native-format parity.

The generic happy-dom preload implementation has moved to
`@aphrody/bun-test-dom`; the `@nie/plugin/happydom` export remains a compatibility
facade. Game data and native libraries remain outside Git. Set `IECODE_ROOT`
(or the legacy `NIE_ROOT`) only in a qualified consumer that has the matching
external assets and ABI.

The package stays private until the game-format ABI, data provenance and
license boundary are reconciled and the loader outputs are compared against the
source fixtures.
