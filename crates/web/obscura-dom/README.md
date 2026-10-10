<!-- SPDX-License-Identifier: Apache-2.0 -->
# obscura-dom

Vendored Obscura DOM backend from Aphrody Web commit
`bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83`. Aphrody Web records its
upstream at `h4ckf0r0day/obscura` commit
`1a3169da276d7720732c7b20535474942917fb83`; see `LICENSE`.

The Rust sources are copied without modification. The Cargo manifest version
is adapted to `0.1.1` to coexist temporarily with version `0.1.0` still used
by checkout dependencies. The canonical Aphrody Web extractor depends on this
local crate. Broader Obscura backend consolidation remains a separate cutover.
